const {
  SignClient
} = require('@walletconnect/sign-client');
const {
  getSdkError
} = require('@walletconnect/utils');
const QRCode = require('qrcode');
const {
  v4: uuidv4
} = require('uuid');
const config = require('./config');
const crypto = require('crypto');
const EventEmitter = require('events');

class WalletService extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map(); // session_id -> session_data
    this.userSessions = new Map(); // telegram_user_id -> session_id
    this.pendingTransactions = new Map(); // session_id -> pending_tx_data
    this.signClient = null;
    this.initializeSignClient();
  }

  async initializeSignClient() {
    try {
      this.signClient = await SignClient.init({
        projectId: process.env.WALLETCONNECT_PROJECT_ID || 'your_project_id',
        metadata: {
          name: 'Crypto Membership NFT',
          description: 'NFT Membership System',
          url: 'https://chainsx.info',
          icons: ['https://chainsx.info/icon.png']
        }
      });

      console.log('✅ WalletConnect SignClient initialized');
    } catch (error) {
      console.warn('⚠️ WalletConnect SignClient failed to initialize:', error.message);
      console.log('🔧 Falling back to manual URI generation');
    }
  }

  async createWalletConnectSession(telegramUserId) {
    try {
      const sessionId = uuidv4();
      let uri = null;
      let connector = null;

      if (this.userSessions.has(telegramUserId)) {
        await this.disconnectWallet(telegramUserId);
      }

      try {
        if (this.signClient && process.env.WALLETCONNECT_PROJECT_ID) {
          const {
            uri: wcUri,
            approval
          } = await this.signClient.connect({
            requiredNamespaces: {
              eip155: {
                methods: [
                  'eth_sendTransaction',
                  'eth_signTransaction',
                  'eth_sign',
                  'personal_sign',
                  'eth_signTypedData',
                  'eth_chainId' // เพิ่ม method นี้
                ],
                chains: [`eip155:${config.chainId}`],
                events: ['chainChanged', 'accountsChanged']
              }
            }
          });

          uri = wcUri;

          connector = {
            uri: uri,
            connected: false,
            accounts: [],
            chainId: null,
            approval: approval,
            signClient: this.signClient,
            topic: null,

            _eventEmitter: new EventEmitter(),
            on: function (event, callback) {
              this._eventEmitter.on(event, callback);
            },
            off: function (event, callback) {
              this._eventEmitter.off(event, callback);
            },
            emit: function (event, ...args) {
              this._eventEmitter.emit(event, ...args);
            }
          };

          approval().then(async (session) => {
            console.log('✅ WalletConnect v2 session approved:', session);
            connector.connected = true;
            connector.topic = session.topic;
            connector.accounts = session.namespaces.eip155?.accounts || [];

            // แก้การดึง chainId ให้ถูกต้อง
            let chainId = null;
            if (session.namespaces.eip155?.chains) {
              const chainString = session.namespaces.eip155.chains[0];
              chainId = parseInt(chainString.split(':')[1]);
            }

            // หาก chainId ยังไม่ถูกต้อง ให้ request จาก wallet
            if (!chainId || chainId !== config.chainId) {
              try {
                const currentChain = await this.signClient.request({
                  topic: session.topic,
                  request: {
                    method: 'eth_chainId',
                    params: []
                  }
                });
                chainId = parseInt(currentChain, 16);
                console.log('🔗 Retrieved chainId from wallet:', chainId);
              } catch (error) {
                console.warn('Failed to get chainId from wallet:', error);
                chainId = config.chainId; // fallback
              }
            }

            connector.chainId = chainId;

            const address = connector.accounts[0]?.split(':')[2];

            if (address) {
              const sessionData = this.sessions.get(sessionId);
              if (sessionData) {
                sessionData.connected = true;
                sessionData.address = address;
                sessionData.chainId = chainId; // ใช้ chainId ที่ได้มาจาก wallet
                sessionData.lastActivity = Date.now();

                // Log debug info
                console.log('🔍 Session data:', {
                  address,
                  chainId,
                  configChainId: config.chainId,
                  match: chainId === config.chainId
                });

                // Emit event for listeners
                this.emit('walletConnected', {
                  telegramUserId: sessionData.telegramUserId,
                  address: address,
                  chainId: chainId,
                  sessionId: sessionId
                });
              }

              connector.emit('connect', null, {
                params: [{
                  accounts: [address],
                  chainId: chainId
                }]
              });

              console.log(`🟢 WalletConnect v2 connected: ${address} on chain ${chainId}`);
              console.log(`📤 Emitted walletConnected event for user: ${sessionData?.telegramUserId}`);
            }
          }).catch((error) => {
            console.error('❌ WalletConnect v2 approval failed:', error);
            connector.emit('disconnect', error);
          });

          console.log('✅ WalletConnect v2 URI generated');
        } else {
          throw new Error('WalletConnect v2 not available - missing project ID');
        }

      } catch (wcError) {
        console.warn('⚠️ WalletConnect v2 failed, using manual generation:', wcError.message);

        const manualSession = this.generateWalletConnectURI();
        uri = manualSession.uri;

        connector = {
          uri: uri,
          connected: false,
          accounts: [],
          chainId: config.chainId, // ใช้ค่า default
          peerId: manualSession.sessionId,

          _eventEmitter: new EventEmitter(),
          on: function (event, callback) {
            this._eventEmitter.on(event, callback);
          },
          off: function (event, callback) {
            this._eventEmitter.off(event, callback);
          },
          emit: function (event, ...args) {
            this._eventEmitter.emit(event, ...args);
          },

          killSession: () => Promise.resolve(),
          sendTransaction: (tx) => Promise.reject(new Error('Please use your wallet app to sign transactions')),
          signPersonalMessage: (msg) => Promise.reject(new Error('Please use your wallet app for signing'))
        };

        console.log('🔧 Using manual URI generation');
      }

      const sessionData = {
        id: sessionId,
        telegramUserId,
        connector,
        connected: false,
        address: null,
        chainId: config.chainId, // เริ่มต้นด้วยค่า config ก่อน
        createdAt: Date.now(),
        lastActivity: Date.now(),
        uri: uri,
        isManual: !this.signClient || !process.env.WALLETCONNECT_PROJECT_ID
      };

      this.sessions.set(sessionId, sessionData);
      this.userSessions.set(telegramUserId, sessionId);

      console.log(`🔗 Created WalletConnect session: ${sessionId}`);
      console.log(`📋 URI: ${uri}`);
      console.log(`🔍 URI validation: ${this.validateWalletConnectURI(uri) ? 'PASS' : 'FAIL'}`);
      console.log(`🔧 Session type: ${sessionData.isManual ? 'Manual' : 'WalletConnect v2'}`);

      return {
        sessionId,
        uri,
        connector
      };

    } catch (error) {
      console.error('Error creating WalletConnect session:', error);
      throw new Error(`Failed to create wallet session: ${error.message}`);
    }
  }

  generateWalletConnectURI() {
    try {
      const sessionId = uuidv4();
      const key = crypto.randomBytes(32).toString('hex');
      const bridge = 'https://bridge.walletconnect.org';
      const version = '1';

      const uri = `wc:${sessionId}@${version}?bridge=${encodeURIComponent(bridge)}&key=${key}`;

      console.log(`🔧 Generated manual URI:`, {
        sessionId: sessionId,
        keyLength: key.length,
        uriLength: uri.length
      });

      return {
        uri,
        sessionId,
        key,
        bridge
      };
    } catch (error) {
      console.error('Error generating manual URI:', error);
      throw error;
    }
  }

  validateWalletConnectURI(uri) {
    try {
      if (!uri || !uri.startsWith('wc:')) {
        return false;
      }

      const parts = uri.split('?');
      if (parts.length !== 2) {
        return false;
      }

      const [base, params] = parts;
      const baseParts = base.split('@');
      if (baseParts.length !== 2) {
        return false;
      }

      const sessionId = baseParts[0].replace('wc:', '');
      const version = baseParts[1];

      if (!sessionId || sessionId.length < 10) {
        return false;
      }

      if (!version || (version !== '1' && version !== '2')) {
        return false;
      }

      const urlParams = new URLSearchParams(params);
      const bridge = urlParams.get('bridge');
      const key = urlParams.get('key');

      if (version === '1') {
        if (!bridge || !bridge.includes('bridge.walletconnect.org')) {
          return false;
        }
        if (!key || key.length < 20) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error validating URI:', error);
      return false;
    }
  }

  async generateQRCode(uri) {
    try {
      const qrCodeBuffer = await QRCode.toBuffer(uri, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      return qrCodeBuffer;
    } catch (error) {
      throw new Error(`Failed to generate QR code: ${error.message}`);
    }
  }

  async checkConnection(telegramUserId) {
    const sessionId = this.userSessions.get(telegramUserId);
    if (!sessionId) {
      return {
        connected: false,
        reason: 'No session found'
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.userSessions.delete(telegramUserId);
      return {
        connected: false,
        reason: 'Session expired'
      };
    }

    if (Date.now() - session.lastActivity > 30 * 60 * 1000) {
      await this.cleanupSession(sessionId);
      return {
        connected: false,
        reason: 'Session timeout'
      };
    }

    return {
      connected: session.connected,
      address: session.address,
      chainId: session.chainId,
      sessionId: session.id
    };
  }

  async sendTransaction(telegramUserId, transactionData, description = 'Transaction') {
    try {
      const connection = await this.checkConnection(telegramUserId);
      if (!connection.connected) {
        throw new Error('Wallet not connected');
      }

      const sessionId = this.userSessions.get(telegramUserId);
      const session = this.sessions.get(sessionId);

      if (!session.connector.signClient || !session.connector.topic) {
        throw new Error('WalletConnect session not properly established. Please reconnect your wallet.');
      }

      const requiredChainId = config.chainId;

      const txRequest = {
        from: session.address,
        to: transactionData.to,
        data: transactionData.data || '0x',
        value: transactionData.value || '0x0',
        gas: transactionData.gasLimit || config.gasLimit,
        gasPrice: transactionData.gasPrice || config.gasPrice,
        chainId: `0x${requiredChainId.toString(16)}`
      };

      console.log('📝 Sending transaction request to WalletConnect...');

      const txId = uuidv4();
      this.pendingTransactions.set(sessionId, {
        id: txId,
        description,
        txRequest,
        timestamp: Date.now(),
        status: 'pending'
      });

      // ส่ง request แล้วพยายาม redirect ไป wallet
      const requestPromise = session.connector.signClient.request({
        topic: session.connector.topic,
        chainId: `eip155:${requiredChainId}`,
        request: {
          method: 'eth_sendTransaction',
          params: [txRequest]
        }
      });

      // พยายาม redirect ไป wallet app
      this.attemptWalletRedirect(session);

      console.log('⏳ Waiting for user approval in wallet app...');

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Transaction request timeout (60s)')), 60000);
      });

      const result = await Promise.race([requestPromise, timeoutPromise]);

      console.log('✅ Transaction approved! Hash:', result);

      const pendingTx = this.pendingTransactions.get(sessionId);
      if (pendingTx) {
        pendingTx.status = 'sent';
        pendingTx.txHash = result;
      }

      session.lastActivity = Date.now();

      return {
        success: true,
        txHash: result,
        txId,
        address: session.address
      };

    } catch (error) {
      console.error('❌ Transaction error:', error);

      if (error.message.includes('User rejected')) {
        throw new Error('Transaction was rejected by user');
      } else if (error.message.includes('timeout')) {
        throw new Error('Transaction request timed out. Please try again.');
      } else if (error.message.includes('Missing or invalid')) {
        throw new Error('WalletConnect configuration error. Please reconnect your wallet.');
      }

      const sessionId = this.userSessions.get(telegramUserId);
      if (sessionId) {
        const pendingTx = this.pendingTransactions.get(sessionId);
        if (pendingTx) {
          pendingTx.status = 'failed';
          pendingTx.error = error.message;
        }
      }

      throw new Error(`Transaction failed: ${error.message}`);
    }
  }
  attemptWalletRedirect(session) {
    try {
      // สร้าง deep links สำหรับ wallets ต่างๆ
      const deepLinks = [
        'metamask://wc', // MetaMask
        'trust://wc', // Trust Wallet
        'rainbow://wc', // Rainbow
        'imtoken://wc', // imToken
        'argent://wc' // Argent
      ];

      // ลอง redirect ไป MetaMask ก่อน (เป็น default)
      if (session.connector.uri) {
        const encodedURI = encodeURIComponent(session.connector.uri);
        const metamaskDeepLink = `metamask://wc?uri=${encodedURI}`;

        console.log('🔗 Attempting wallet redirect:', metamaskDeepLink.substring(0, 50) + '...');

        // Note: ใน Node.js environment ไม่สามารถ redirect ได้โดยตรง
        // ต้องส่ง deep link กลับไปให้ Telegram bot แทน
        return metamaskDeepLink;
      }
    } catch (error) {
      console.warn('Failed to create wallet redirect:', error);
    }
    return null;
  }

  getWalletDeepLinks(session) {
  if (!session || !session.connector.uri) return null;
  
  const encodedURI = encodeURIComponent(session.connector.uri);
  
  return {
    metamask: `metamask://wc?uri=${encodedURI}`,
    trust: `trust://wc?uri=${encodedURI}`,
    rainbow: `rainbow://wc?uri=${encodedURI}`,
    coinbase: `cbwallet://wc?uri=${encodedURI}`,
    imtoken: `imtoken://wc?uri=${encodedURI}`,
    // Fallback universal link
    universal: `https://metamask.app.link/wc?uri=${encodedURI}`
  };
}

  async refreshChainId(telegramUserId) {
    try {
      const sessionId = this.userSessions.get(telegramUserId);
      if (!sessionId) return null;

      const session = this.sessions.get(sessionId);
      if (!session || !session.connected) return null;

      if (session.connector.signClient && session.connector.topic) {
        const chainIdHex = await session.connector.signClient.request({
          topic: session.connector.topic,
          request: {
            method: 'eth_chainId',
            params: []
          }
        });

        const chainId = parseInt(chainIdHex, 16);
        session.chainId = chainId;
        session.lastActivity = Date.now();

        console.log('🔄 Refreshed chainId:', chainId);
        return chainId;
      }

      return session.chainId;
    } catch (error) {
      console.error('Error refreshing chainId:', error);
      return null;
    }
  }

  async disconnectWallet(telegramUserId) {
    try {
      const sessionId = this.userSessions.get(telegramUserId);
      if (!sessionId) return true;

      const session = this.sessions.get(sessionId);
      if (session && session.connector) {
        try {
          if (session.connector.signClient && session.connector.topic) {
            await session.connector.signClient.disconnect({
              topic: session.connector.topic,
              reason: getSdkError('USER_DISCONNECTED')
            });
          } else if (session.connector.killSession) {
            await session.connector.killSession();
          }
        } catch (disconnectError) {
          console.warn('Disconnect error:', disconnectError.message);
        }
      }

      await this.cleanupSession(sessionId);
      return true;
    } catch (error) {
      console.error('Disconnect error:', error);
      const sessionId = this.userSessions.get(telegramUserId);
      if (sessionId) {
        await this.cleanupSession(sessionId);
      }
      return true;
    }
  }

  async cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.userSessions.delete(session.telegramUserId);
      this.sessions.delete(sessionId);
      this.pendingTransactions.delete(sessionId);
    }
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    const expireTime = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > expireTime) {
        console.log(`🧹 Cleaning up expired session: ${sessionId}`);
        this.cleanupSession(sessionId);
      }
    }
  }

  detectPlatform(msg) {
    const isMobile = msg.chat.type === 'private';

    return {
      isMobile,
      isDesktop: !isMobile,
      chatType: msg.chat.type
    };
  }

  getStats() {
    const totalSessions = this.sessions.size;
    const connectedSessions = Array.from(this.sessions.values()).filter(s => s.connected).length;
    const pendingTxCount = this.pendingTransactions.size;

    return {
      totalSessions,
      connectedSessions,
      pendingTransactions: pendingTxCount,
      activeSessions: this.userSessions.size
    };
  }

  getPendingTransaction(telegramUserId) {
    const sessionId = this.userSessions.get(telegramUserId);
    if (!sessionId) return null;
    return this.pendingTransactions.get(sessionId);
  }

  clearPendingTransaction(telegramUserId) {
    const sessionId = this.userSessions.get(telegramUserId);
    if (sessionId) {
      this.pendingTransactions.delete(sessionId);
    }
  }

  setWalletConnectedCallback(callback) {
    this.onWalletConnected = callback;
  }
}

module.exports = WalletService;