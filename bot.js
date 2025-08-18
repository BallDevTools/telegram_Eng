const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const ContractService = require('./contractService');
const WalletService = require('./walletService');
const SimpleServer = require('./simpleServer');

class TelegramMembershipBot {
  constructor() {
    this.bot = new TelegramBot(config.telegramBotToken, { polling: true });
    this.contractService = new ContractService();
    this.walletService = new WalletService();
    this.me = { username: 'ChainsxCo_bot' };
    
    // Start simple API server for connection status
    this.apiServer = new SimpleServer(this.walletService, 3001);
    
    // Listen for wallet connection events
    this.walletService.on('walletConnected', (data) => {
      this.handleWalletConnectedEvent(data);
    });
    
    this.setupCommands();
    this.setupErrorHandling();
    this.startCleanupTimer();
    this.initializeBot();
  }

  async initializeBot() {
    try {
      // Start API server
      await this.apiServer.start();
      
      this.me = await this.bot.getMe();
      console.log(`🤖 Bot username loaded: @${this.me.username}`);
    } catch (err) {
      console.warn('⚠️ Initialization error:', err.message);
      this.me = { username: 'ChainsxCo_bot' };
    }
  }

  async handleWalletConnectedEvent(data) {
    try {
      console.log(`📨 Received walletConnected event:`, data);
      await this.handleWalletConnected(data.telegramUserId, data.address, data.chainId);
    } catch (error) {
      console.error('Error handling wallet connected event:', error);
    }
  }

  setupCommands() {
    // Basic Commands
    this.bot.onText(/\/start(?:\s+ref_(0x[a-fA-F0-9]{40}))?/, (msg, match) => this.handleStart(msg, match));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));

    // Wallet Commands
    this.bot.onText(/\/connect/, (msg) => this.handleConnect(msg));
    this.bot.onText(/\/disconnect/, (msg) => this.handleDisconnect(msg));
    this.bot.onText(/\/wallet/, (msg) => this.handleWalletStatus(msg));

    // Member Commands  
    this.bot.onText(/\/register\s+(\d+)(?:\s+(0x[a-fA-F0-9]{40}))?/, (msg, match) => this.handleRegister(msg, match));
    this.bot.onText(/\/upgrade (.+)/, (msg, match) => this.handleUpgrade(msg, match));
    this.bot.onText(/\/myinfo/, (msg) => this.handleMyInfo(msg));

    // Plan Information Commands
    this.bot.onText(/\/planinfo (.+)/, (msg, match) => this.handlePlanInfo(msg, match));
    this.bot.onText(/\/totalplans/, (msg) => this.handleTotalPlans(msg));
    this.bot.onText(/\/allplans/, (msg) => this.handleAllPlans(msg));

    // Contract Status Commands
    this.bot.onText(/\/contractstatus/, (msg) => this.handleContractStatus(msg));
    this.bot.onText(/\/usdtbalance/, (msg) => this.handleUSDTBalance(msg));

    // Validation Commands
    this.bot.onText(/\/validate (.+) (.+)/, (msg, match) => this.handleValidateRegistration(msg, match));
    this.bot.onText(/\/validateupgrade (.+)/, (msg, match) => this.handleValidateUpgrade(msg, match));
    this.bot.onText(/\/approve (.+)/, (msg, match) => this.handleApproveUSDT(msg, match));

    // Transaction Status
    this.bot.onText(/\/txstatus (.+)/, (msg, match) => this.handleTransactionStatus(msg, match));

    // Referral Commands
    this.bot.onText(/\/getreferrallink/, (msg) => this.handleReferralLink(msg));

    // Callback query handlers for inline buttons
    this.bot.on('callback_query', (callbackQuery) => this.handleCallbackQuery(callbackQuery));
  }

  setupErrorHandling() {
    this.bot.on('polling_error', (error) => {
      console.error('User Bot Polling error:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('User Bot Unhandled Rejection at:', promise, 'reason:', reason);
    });
  }

  startCleanupTimer() {
    setInterval(() => {
      this.walletService.cleanupExpiredSessions();
    }, 10 * 60 * 1000);
  }

  async sendMessage(chatId, text, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...options
      });
    } catch (error) {
      console.error('Error sending message:', error);
      return await this.bot.sendMessage(chatId, text.replace(/[*_`]/g, ''));
    }
  }

  async sendPhoto(chatId, photo, options = {}) {
    try {
      return await this.bot.sendPhoto(chatId, photo, {
        parse_mode: 'Markdown',
        ...options
      });
    } catch (error) {
      console.error('Error sending photo:', error);
      throw error;
    }
  }

  // === WALLET CONNECTION HANDLERS ===

  async handleConnect(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const existingConnection = await this.walletService.checkConnection(userId);
      if (existingConnection.connected) {
        await this.sendMessage(chatId, `
✅ *Wallet Already Connected*

🔗 Address: \`${existingConnection.address}\`
🌐 Network: ${config.networkName}

💡 *Commands:*
• \`/wallet\` - View wallet info
• \`/disconnect\` - Disconnect wallet
• \`/myinfo\` - View membership info
        `);
        return;
      }

      await this.sendMessage(chatId, '⏳ Creating wallet connection...');

      const session = await this.walletService.createWalletConnectSession(userId);
      
      console.log(`🔗 Session created for user ${userId}:`);
      console.log(`   Session ID: ${session.sessionId}`);
      console.log(`   URI length: ${session.uri.length}`);
      console.log(`   URI preview: ${session.uri.substring(0, 50)}...`);
      
      const platform = this.walletService.detectPlatform(msg);

      if (platform.isMobile) {
        await this.sendMobileWalletOptions(chatId, session.uri, userId, session.sessionId);
      } else {
        await this.sendDesktopWalletOptions(chatId, session.uri, userId, session.sessionId);
      }

      // Start polling for connection status
      this.startConnectionPolling(chatId, userId);

      setTimeout(async () => {
        const connection = await this.walletService.checkConnection(userId);
        if (!connection.connected) {
          await this.sendMessage(chatId, `
⏰ *Connection Timeout*

Connection request expired. Please try again with \`/connect\`

💡 *Tips for successful connection:*
• Make sure your wallet app is updated
• Check your internet connection  
• Try using the web interface
• Use QR code scanning when available
• Allow the page to auto-close after connection

🔧 *Troubleshooting:*
• Ensure you're on ${config.networkName}
• Clear browser cache if needed
• Try different wallet apps
• Check if popup blocker is disabled
          `);
        }
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('Connect error:', error);
      await this.sendMessage(chatId, `❌ Error creating wallet connection: ${error.message}

💡 Please try again with \`/connect\`

🔧 If the issue persists:
• Check your internet connection
• Try using a different device
• Contact support if needed`);
    }
  }

  // Modified connection polling - reduce frequency since we have events
  startConnectionPolling(chatId, userId) {
    const maxPolls = 36; // Poll for 36 * 10 = 360 seconds (6 minutes)
    let pollCount = 0;
    
    const pollInterval = setInterval(async () => {
      pollCount++;
      
      try {
        const connection = await this.walletService.checkConnection(userId);
        
        if (connection.connected) {
          clearInterval(pollInterval);
          
          // Send success message if not already sent by event
          await this.handleWalletConnected(userId, connection.address, connection.chainId);
          
          console.log(`✅ Wallet connection detected via polling for user ${userId} after ${pollCount * 10} seconds`);
        } else if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          console.log(`⏰ Connection polling timeout for user ${userId}`);
        }
        
      } catch (error) {
        console.error('Error during connection polling:', error);
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
        }
      }
    }, 10000); // Poll every 10 seconds (less frequent since we have events)
  }

  async sendMobileWalletOptions(chatId, uri, userId, sessionId) {
    // For production, use domain. For development, send URI directly
    const isProduction = process.env.NODE_ENV === 'production';
    const serverUrl = process.env.SERVER_URL || 'https://chainsx.info';
    
    if (isProduction && serverUrl.startsWith('https://')) {
      // Production: use HTTPS URL
      const connectUrl = `${serverUrl}/connect.html?uri=${encodeURIComponent(uri)}&userId=${userId}&sessionId=${sessionId}`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🚀 Connect Wallet (One-Click)', url: connectUrl }
          ],
          [
            { text: '📋 Copy URI', callback_data: 'copy_uri' },
            { text: '❓ Help', callback_data: 'connection_help' }
          ]
        ]
      };

      await this.sendMessage(chatId, `
🔗 *Connect Your Wallet*

**Click the button below to connect:**

⚠️ *Important:*
• Make sure you're on ${config.networkName}
• Connection expires in 5 minutes
• Page will auto-close after connection

💡 *Tip:* You'll automatically return to this chat!
      `, { reply_markup: keyboard });
    } else {
      // Development: send URI directly without button
      await this.sendMessage(chatId, `
🔗 *Connect Your Wallet*

**Development Mode - Manual Connection:**

1️⃣ **Copy this URI:**
\`${uri}\`

2️⃣ **Open your wallet app**
3️⃣ **Find "WalletConnect" or "Connect to DApp"**
4️⃣ **Paste the URI**
5️⃣ **Approve the connection**

**Or visit connection page:**
${process.env.SERVER_URL || 'http://localhost:3001'}/connect.html?userId=${userId}&sessionId=${sessionId}

⚠️ *Important:*
• Make sure you're on ${config.networkName}
• Connection expires in 5 minutes

💡 *For production, set SERVER_URL to HTTPS domain in .env*
      `, { 
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 Copy URI', callback_data: 'copy_uri' },
              { text: '❓ Help', callback_data: 'connection_help' }
            ]
          ]
        }
      });
    }
  }

  async sendDesktopWalletOptions(chatId, uri, userId, sessionId) {
    const isProduction = process.env.NODE_ENV === 'production';
    const serverUrl = process.env.SERVER_URL || 'https://chainsx.info';
    
    try {
      const qrCodeBuffer = await this.walletService.generateQRCode(uri);
      
      if (isProduction && serverUrl.startsWith('https://')) {
        // Production: use HTTPS URL with button
        const connectUrl = `${serverUrl}/connect.html?uri=${encodeURIComponent(uri)}&userId=${userId}&sessionId=${sessionId}`;

        const keyboard = {
          inline_keyboard: [
            [
              { text: '🚀 Open Connection Page', url: connectUrl }
            ],
            [
              { text: '📋 Copy URI', callback_data: 'copy_uri' },
              { text: '❓ Help', callback_data: 'connection_help' }
            ]
          ]
        };

        await this.sendPhoto(chatId, qrCodeBuffer, {
          caption: `
🔗 *Connect Your Wallet*

**Option 1: Connection Page (Recommended)**
🚀 Click "Open Connection Page" for full interface

**Option 2: QR Code**
📱 Scan QR code with your mobile wallet

⚠️ *Network:* ${config.networkName}
⏰ *Timeout:* 5 minutes
          `,
          reply_markup: keyboard
        });
      } else {
        // Development: show QR and manual instructions
        await this.sendPhoto(chatId, qrCodeBuffer, {
          caption: `
🔗 *Connect Your Wallet*

**Option 1: QR Code**
📱 Scan QR code with your mobile wallet

**Option 2: Manual Connection**
Visit: ${process.env.SERVER_URL || 'http://localhost:3001'}/connect.html?userId=${userId}&sessionId=${sessionId}

**Option 3: Copy URI**
Use the "Copy URI" button below

⚠️ *Network:* ${config.networkName}
⏰ *Timeout:* 5 minutes

💡 *Note:* For Telegram buttons, set SERVER_URL to HTTPS domain
          `,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📋 Copy URI', callback_data: 'copy_uri' },
                { text: '❓ Help', callback_data: 'connection_help' }
              ]
            ]
          }
        });
      }

    } catch (error) {
      console.error('Error sending QR code:', error);
      
      // Fallback without QR
      await this.sendMessage(chatId, `
🔗 *Connect Your Wallet*

**Manual Connection:**

**WalletConnect URI:**
\`${uri}\`

**Connection Page:**
${process.env.SERVER_URL || 'http://localhost:3001'}/connect.html?userId=${userId}&sessionId=${sessionId}

**Instructions:**
1. Copy the URI above
2. Open your wallet app
3. Find "WalletConnect" or "Connect to DApp"
4. Paste the URI
5. Approve the connection

⚠️ *Network:* ${config.networkName}
⏰ *Timeout:* 5 minutes
      `, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 Copy URI', callback_data: 'copy_uri' }
            ]
          ]
        }
      });
    }
  }

  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    try {
      await this.bot.answerCallbackQuery(callbackQuery.id);

      switch (data) {
        case 'copy_uri':
          const sessionId = this.walletService.userSessions.get(userId);
          if (sessionId) {
            const session = this.walletService.sessions.get(sessionId);
            if (session) {
              await this.sendMessage(chatId, `
📋 *WalletConnect URI*

\`${session.connector.uri}\`

**How to use:**
1. Copy the URI above
2. Open your wallet app
3. Find "WalletConnect" or "Connect to DApp"
4. Paste the URI
5. Approve the connection

⏰ *Expires in:* 5 minutes

💡 *Tip:* Use the web interface for easier connection!
              `);
            }
          }
          break;

        case 'connection_help':
          await this.sendMessage(chatId, `
❓ *Connection Help*

**Recommended Method:**
🚀 Use the "Connect Wallet (One-Click)" button - it opens a web interface that:
• Auto-detects your device
• Provides one-click wallet connections
• Shows QR codes for mobile wallets
• Guides you through each step

**Manual Method:**
📋 Copy the WalletConnect URI and paste it in your wallet app

**Troubleshooting:**
• Make sure your wallet app is updated
• Check you're on the correct network (${config.networkName})
• Try refreshing if connection fails
• Use QR code scanning when available

**Supported Wallets:**
🦊 MetaMask • 🛡️ Trust Wallet • 🌈 Rainbow
🔷 Argent • 💙 imToken • And many more!
          `);
          break;

        default:
          if (data.startsWith('upgrade_')) {
            const planId = data.split('_')[1];
            await this.handleUpgrade({ chat: { id: chatId }, from: { id: userId } }, [null, planId]);
          } else if (data.startsWith('validate_upgrade_')) {
            const planId = data.split('_')[2];
            await this.handleValidateUpgrade({ chat: { id: chatId }, from: { id: userId } }, [null, planId]);
          }
          break;
      }
    } catch (error) {
      console.error('Callback query error:', error);
      await this.sendMessage(chatId, '❌ Error processing request. Please try again.');
    }
  }

  async handleWalletConnected(userId, address, chainId) {
    try {
      // Prevent duplicate messages
      const sessionId = this.walletService.userSessions.get(userId);
      if (sessionId) {
        const session = this.walletService.sessions.get(sessionId);
        if (session && session.notificationSent) {
          console.log(`📨 Skipping duplicate notification for user ${userId}`);
          return;
        }
        if (session) {
          session.notificationSent = true;
        }
      }

      await this.sendMessage(userId, `
✅ *Wallet Connected Successfully!*

🔗 *Address:* \`${address}\`
🌐 *Network:* ${chainId === config.chainId ? config.networkName : `Chain ID: ${chainId}`}

${chainId !== config.chainId ? 
  `⚠️ *Warning:* Please switch to ${config.networkName} (Chain ID: ${config.chainId})` : 
  '🟢 *Ready to use!* You can now register or upgrade your membership.'
}

💡 *Available commands:*
• \`/myinfo\` - View membership status
• \`/allplans\` - Browse membership plans
• \`/wallet\` - View wallet details
      `);

      // Update session to mark as connected
      if (sessionId) {
        const session = this.walletService.sessions.get(sessionId);
        if (session) {
          session.connected = true;
          session.address = address;
          session.chainId = chainId;
          session.lastActivity = Date.now();
          console.log(`✅ Session ${sessionId} marked as connected for user ${userId}`);
        }
      }
      
    } catch (error) {
      console.error('Error notifying wallet connection:', error);
    }
  }

  async handleDisconnect(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const result = await this.walletService.disconnectWallet(userId);
      
      if (result) {
        await this.sendMessage(chatId, `
✅ *Wallet Disconnected*

Your wallet has been disconnected successfully.

💡 Use \`/connect\` to connect again
        `);
      } else {
        await this.sendMessage(chatId, '❌ No active wallet connection found');
      }
    } catch (error) {
      console.error('Disconnect error:', error);
      await this.sendMessage(chatId, `❌ Error disconnecting wallet: ${error.message}`);
    }
  }

  async handleWalletStatus(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const connection = await this.walletService.checkConnection(userId);
      
      if (!connection.connected) {
        await this.sendMessage(chatId, `
❌ *No Wallet Connected*

${connection.reason || 'Please connect your wallet first'}

💡 Use \`/connect\` to connect your wallet
        `);
        return;
      }

      const balanceInfo = await this.contractService.getUSDTBalance(connection.address);
      const allowanceInfo = await this.contractService.getUSDTAllowance(connection.address);

      await this.sendMessage(chatId, `
✅ *Wallet Connected*

🔗 *Address:* \`${connection.address}\`
🌐 *Network:* ${config.networkName} (Chain ID: ${connection.chainId})

💰 *USDT Balance:* ${balanceInfo.formatted} USDT
🔓 *USDT Allowance:* ${allowanceInfo.formatted} USDT

💡 *Commands:*
• \`/myinfo\` - View membership info
• \`/allplans\` - View available plans
• \`/disconnect\` - Disconnect wallet
      `);

    } catch (error) {
      console.error('Wallet status error:', error);
      await this.sendMessage(chatId, `❌ Error checking wallet status: ${error.message}`);
    }
  }

  // === MEMBER TRANSACTION HANDLERS ===

  async handleRegister(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const planId = parseInt(match[1]);
    let uplineAddress = match[2];

    try {
      const connection = await this.walletService.checkConnection(userId);
      if (!connection.connected) {
        await this.sendMessage(chatId, `
❌ *Wallet Not Connected*

Please connect your wallet first:
\`/connect\`
        `);
        return;
      }

      if (!uplineAddress) {
        await this.sendMessage(chatId, '❌ Please specify upline address or use a valid invitation link');
        return;
      }

      await this.sendMessage(chatId, '⏳ Validating registration conditions...');
      
      try {
        await this.contractService.validateRegistration(connection.address, planId, uplineAddress);
      } catch (validationError) {
        await this.sendMessage(chatId, `❌ Validation failed: ${validationError.message}

💡 *Suggestions:*
• Check if you're already a member with \`/myinfo\`
• Ensure upline is a valid member
• Check USDT balance with \`/wallet\`
• Use \`/approve <amount>\` to approve USDT`);
        return;
      }

      const planInfo = await this.contractService.getPlanInfo(planId);
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const { ethers } = require('ethers');
      const priceFormatted = ethers.formatUnits(planInfo.price, usdtDecimals);

      const txData = this.contractService.buildRegisterTransaction(planId, uplineAddress);
      
      await this.sendMessage(chatId, `
💡 *Ready to Register*

📋 *Details:*
• Plan: ${planInfo.name} (Plan ${planId})
• Price: ${priceFormatted} USDT
• Upline: \`${uplineAddress}\`

⏳ Sending transaction request to your wallet...
      `);

      const result = await this.walletService.sendTransaction(
        userId, 
        txData, 
        `Register Plan ${planId}`
      );

      if (result.success) {
        await this.sendMessage(chatId, `
✅ *Transaction Sent Successfully!*

📄 *Transaction Hash:* \`${result.txHash}\`
🔗 *Explorer:* [View Transaction](${this.contractService.getExplorerUrl(result.txHash)})

⏳ *Status:* Waiting for confirmation...

💡 Use \`/txstatus ${result.txHash}\` to check status
        `);

        this.monitorTransaction(chatId, result.txHash, 'registration');
      }

    } catch (error) {
      console.error('Register error:', error);
      await this.sendMessage(chatId, `❌ Registration failed: ${error.message}`);
    }
  }

  async handleUpgrade(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newPlanId = parseInt(match[1]);

    try {
      const connection = await this.walletService.checkConnection(userId);
      if (!connection.connected) {
        await this.sendMessage(chatId, `
❌ *Wallet Not Connected*

Please connect your wallet first:
\`/connect\`
        `);
        return;
      }

      await this.sendMessage(chatId, '⏳ Validating upgrade conditions...');
      
      let validation;
      try {
        validation = await this.contractService.validateUpgrade(connection.address, newPlanId);
      } catch (validationError) {
        await this.sendMessage(chatId, `❌ Cannot upgrade: ${validationError.message}

💡 *Suggestions:*
• Use \`/myinfo\` to view current status
• Use \`/allplans\` to view available plans
• Use \`/approve <amount>\` if USDT is insufficient`);
        return;
      }

      const { ethers } = require('ethers');
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const newPlanPrice = ethers.formatUnits(validation.newPlanInfo.price, usdtDecimals);
      const upgradeCost = ethers.formatUnits(validation.upgradeCost, usdtDecimals);

      const txData = this.contractService.buildUpgradeTransaction(newPlanId);

      await this.sendMessage(chatId, `
💡 *Ready to Upgrade*

📋 *Details:*
• Current Plan: Plan ${validation.currentPlan}
• New Plan: ${validation.newPlanInfo.name} (Plan ${newPlanId})
• New Plan Price: ${newPlanPrice} USDT
• Upgrade Cost: ${upgradeCost} USDT

⏳ Sending transaction request to your wallet...
      `);

      const result = await this.walletService.sendTransaction(
        userId,
        txData,
        `Upgrade to Plan ${newPlanId}`
      );

      if (result.success) {
        await this.sendMessage(chatId, `
✅ *Transaction Sent Successfully!*

📄 *Transaction Hash:* \`${result.txHash}\`
🔗 *Explorer:* [View Transaction](${this.contractService.getExplorerUrl(result.txHash)})

⏳ *Status:* Waiting for confirmation...

💡 Use \`/txstatus ${result.txHash}\` to check status
        `);

        this.monitorTransaction(chatId, result.txHash, 'upgrade');
      }

    } catch (error) {
      console.error('Upgrade error:', error);
      await this.sendMessage(chatId, `❌ Upgrade failed: ${error.message}`);
    }
  }

  async handleApproveUSDT(msg, match) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const amount = match[1];

  try {
    const connection = await this.walletService.checkConnection(userId);
    if (!connection.connected) {
      await this.sendMessage(chatId, 'âŒ Please connect your wallet first: `/connect`');
      return;
    }

    const amountWei = await this.contractService.parsePrice(amount);
    const txData = this.contractService.buildApproveTransaction(amountWei);

    await this.sendMessage(chatId, `
💡 *Ready to Approve USDT*

📋 *Details:*
• Amount: ${amount} USDT
• Contract: \`${config.contractAddress}\`

⏳ Sending approval request to your wallet...
    `);

    const result = await this.walletService.sendTransaction(
      userId,
      txData,
      `Approve ${amount} USDT`
    );

    if (result.success) {
      // ดึง session เพื่อสร้าง universal links
      const sessionId = this.walletService.userSessions.get(userId);
      const session = sessionId ? this.walletService.sessions.get(sessionId) : null;
      
      const keyboard = {
        inline_keyboard: []
      };

      // สร้าง Universal Links ที่ Telegram รองรับ
      if (session && session.connector.uri) {
        const encodedURI = encodeURIComponent(session.connector.uri);
        
        // Universal Links ที่ใช้ HTTPS (Telegram รองรับ)
        keyboard.inline_keyboard.push([
          { 
            text: '🦊 Open MetaMask', 
            url: `https://metamask.app.link/wc?uri=${encodedURI}` 
          }
        ]);
        
        keyboard.inline_keyboard.push([
          { 
            text: '🛡️ Trust Wallet', 
            url: `https://link.trustwallet.com/wc?uri=${encodedURI}` 
          },
          { 
            text: '🌈 Rainbow', 
            url: `https://rnbwapp.com/wc?uri=${encodedURI}` 
          }
        ]);

        // เพิ่มปุ่ม fallback
        keyboard.inline_keyboard.push([
          { 
            text: '📱 Open Any Wallet', 
            url: `https://walletconnect.com/registry?uri=${encodedURI}` 
          }
        ]);
      }

      await this.sendMessage(chatId, `
✅ *Transaction Request Sent!*

📱 *Quick Wallet Access:*
• Tap buttons below to open your wallet app
• Or manually switch to your wallet app
• Approve the pending transaction

📄 *Transaction Hash:* \`${result.txHash}\`
🔗 *Explorer:* [View Transaction](${this.contractService.getExplorerUrl(result.txHash)})

💡 *Manual Steps:*
1️⃣ Open your wallet app (MetaMask, Trust, etc.)
2️⃣ Look for "WalletConnect" or pending requests
3️⃣ Tap "Approve" to confirm the transaction

⏰ Use \`/txstatus ${result.txHash}\` to check status
      `, { reply_markup: keyboard });

      this.monitorTransaction(chatId, result.txHash, 'approval');
    }

  } catch (error) {
    console.error('Approve error:', error);
    await this.sendMessage(chatId, `❌ Approval failed: ${error.message}`);
  }
}

  // === TRANSACTION MONITORING ===

  async monitorTransaction(chatId, txHash, txType) {
    try {
      const status = await this.contractService.waitForTransactionConfirmation(txHash);
      
      if (status.status === 'success') {
        let message = `
✅ *${txType.charAt(0).toUpperCase() + txType.slice(1)} Successful!*

📄 *Transaction Hash:* \`${txHash}\`
🔗 *Explorer:* [View Transaction](${status.explorerUrl})
⛽ *Gas Used:* ${status.gasUsed}
🧱 *Block:* ${status.blockNumber}
        `;

        if (txType === 'registration' || txType === 'upgrade') {
          message += `\n💡 Use \`/myinfo\` to view updated membership info`;
        }

        await this.sendMessage(chatId, message);
      }
    } catch (error) {
      await this.sendMessage(chatId, `
❌ *Transaction Monitoring Failed*

📄 *Transaction Hash:* \`${txHash}\`
❓ *Error:* ${error.message}

🔗 Please check transaction status manually:
${this.contractService.getExplorerUrl(txHash)}
      `);
    }
  }

  async handleTransactionStatus(msg, match) {
    const chatId = msg.chat.id;
    const txHash = match[1];

    try {
      const status = await this.contractService.checkTransactionStatus(txHash);
      
      let statusEmoji;
      switch (status.status) {
        case 'success':
          statusEmoji = '✅';
          break;
        case 'failed':
          statusEmoji = '❌';
          break;
        case 'pending':
          statusEmoji = '⏳';
          break;
        default:
          statusEmoji = '❓';
      }

      let message = `
${statusEmoji} *Transaction Status*

📄 *Hash:* \`${txHash}\`
📊 *Status:* ${status.status.toUpperCase()}
💬 *Message:* ${status.message}
      `;

      if (status.explorerUrl) {
        message += `\n🔗 *Explorer:* [View Transaction](${status.explorerUrl})`;
      }

      if (status.blockNumber) {
        message += `\n🧱 *Block:* ${status.blockNumber}`;
      }

      if (status.gasUsed) {
        message += `\n⛽ *Gas Used:* ${status.gasUsed}`;
      }

      await this.sendMessage(chatId, message);

    } catch (error) {
      console.error('Transaction status error:', error);
      await this.sendMessage(chatId, `❌ Error checking transaction status: ${error.message}`);
    }
  }

  // === INFORMATION HANDLERS ===

  async handleStart(msg, match) {
    const chatId = msg.chat.id;
    const refAddress = match?.[1];

    if (refAddress) {
      await this.sendMessage(chatId, `🟢 You were invited by \`${refAddress}\`\nThe system will use this as upline when you register`);
    } else {
      await this.sendMessage(chatId, `
🟢 *Welcome to Crypto Membership!*

This bot helps you manage NFT membership on ${config.networkName} with secure wallet integration.

🚀 *Getting Started:*
1️⃣ \`/connect\` - Connect your wallet securely
2️⃣ \`/myinfo\` - Check member status
3️⃣ \`/register 1 <upline_address>\` - Register membership

📋 *Main Commands:*
• \`/help\` - Show all commands
• \`/wallet\` - View wallet info
• \`/allplans\` - View all plans
• \`/contractstatus\` - Check system status

🔒 *Security:*
✅ Your private keys never leave your wallet
✅ All transactions signed securely in your wallet app
✅ WalletConnect standard used for maximum security

💡 Type \`/help\` to see all commands
      `);
    }
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;

    const helpMessage = `
🤖 *Crypto Membership Bot Help*

Secure NFT membership system on ${config.networkName} with WalletConnect integration.

🔗 *Wallet Connection*
• \`/connect\` - Connect wallet via WalletConnect
• \`/disconnect\` - Disconnect wallet
• \`/wallet\` - View wallet status & balance

👤 *Registration / Upgrade*
• \`/register <plan> <upline>\` - Register new membership
• \`/upgrade <plan>\` - Upgrade membership plan
• \`/myinfo\` - View your membership info

📋 *Plan Information*
• \`/planinfo <id>\` - View specific plan info
• \`/allplans\` - Show all active plans

💰 *USDT Management*
• \`/approve <amount>\` - Approve USDT to contract
• \`/usdtbalance\` - Check your USDT balance

📄 *Transaction Tracking*
• \`/txstatus <hash>\` - Check transaction status

🤝 *Referral (Invite Friends)*
• \`/getreferrallink\` - Get invitation link

🔧 *System Status*
• \`/contractstatus\` - Check system status

🔍 *Validation Commands*
• \`/validate <plan> <upline>\` - Validate before registration
• \`/validateupgrade <plan>\` - Validate before upgrade

📖 **Usage Examples**
\`/connect\`
\`/register 1 0xABCD...\`
\`/approve 5\`
\`/upgrade 2\`

⚠️ **Security Features:**
✅ WalletConnect integration - no private keys shared
✅ Mobile & Desktop support
✅ Multiple wallet support (MetaMask, Trust, etc.)

🌐 **Network:**
• Network: ${config.networkName}
• Contract: \`${config.contractAddress}\`
  `;

    await this.sendMessage(chatId, helpMessage);
  }

  async handleMyInfo(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const connection = await this.walletService.checkConnection(userId);
      if (!connection.connected) {
        await this.sendMessage(chatId, `
❌ *Wallet Not Connected*

Please connect your wallet first:
\`/connect\`
        `);
        return;
      }

      const memberInfo = await this.contractService.getMemberInfo(connection.address);

      if (!memberInfo.isMember) {
        await this.sendMessage(chatId, `
❌ *Not a Member Yet*

You are not a member of the system yet.

💡 *How to get started:*
• \`/allplans\` - View available plans
• \`/register 1 <upline_address>\` - Register for Plan 1

📝 New members must start from Plan 1
        `);
        return;
      }

      const planInfo = await this.contractService.getPlanInfo(parseInt(memberInfo.planId));
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const { ethers } = require('ethers');
      const earningsFormatted = ethers.formatUnits(memberInfo.totalEarnings, usdtDecimals);
      const registeredDate = new Date(parseInt(memberInfo.registeredAt) * 1000).toLocaleString('en-US');

      const currentPlan = parseInt(memberInfo.planId);
      const nextPlan = currentPlan + 1;
      const totalPlans = await this.contractService.getTotalPlanCount();
      const canUpgrade = nextPlan <= parseInt(totalPlans);

      let upgradeMessage = '';
      if (canUpgrade) {
        upgradeMessage = `\n💡 *Available Actions:*\n• \`/upgrade ${nextPlan}\` - Upgrade to Plan ${nextPlan}\n• \`/planinfo ${nextPlan}\` - View Plan ${nextPlan} info`;
      } else {
        upgradeMessage = `\n🏆 *Congratulations! You are on the highest plan!*`;
      }

      await this.sendMessage(chatId, `
👤 *Your Membership Info*

🔗 *Wallet:* \`${connection.address}\`

📋 *Membership Details:*
• Current Plan: ${planInfo.name} (Plan ${memberInfo.planId})
• Cycle: ${memberInfo.cycleNumber}
• Upline: \`${memberInfo.upline}\`

💰 *Statistics:*
• Total Earnings: ${earningsFormatted} USDT
• Total Referrals: ${memberInfo.totalReferrals} people
• Registration Date: ${registeredDate}${upgradeMessage}
      `);

    } catch (error) {
      console.error('MyInfo error:', error);
      await this.sendMessage(chatId, `❌ Error retrieving member info: ${error.message}`);
    }
  }

  async handlePlanInfo(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const planId = parseInt(match[1]);

    try {
      if (!planId || planId < 1) {
        await this.sendMessage(chatId, '❌ Invalid Plan ID');
        return;
      }

      const planInfo = await this.contractService.getPlanInfo(planId);
      const { ethers } = require('ethers');
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const priceFormatted = ethers.formatUnits(planInfo.price, usdtDecimals);

      let memberInfo = null;
      let isExistingMember = false;
      let userAddress = null;

      const connection = await this.walletService.checkConnection(userId);
      if (connection.connected) {
        try {
          userAddress = connection.address;
          memberInfo = await this.contractService.getMemberInfo(userAddress);
          isExistingMember = memberInfo.isMember;
        } catch (error) {
          // Ignore error
        }
      }

      let actionMessage = '';
      let keyboard = null;

      if (!connection.connected) {
        actionMessage = `\n💡 *Get Started:*\n\`/connect\` - Connect wallet to register`;
      } else if (isExistingMember) {
        const currentPlan = parseInt(memberInfo.planId);
        const targetPlan = planId;

        if (targetPlan === currentPlan) {
          actionMessage = `\n✅ *You are currently on this plan*`;
        } else if (targetPlan === currentPlan + 1) {
          actionMessage = `\n💡 *Ready to upgrade:*`;
          keyboard = {
            inline_keyboard: [
              [{ text: `⬆️ Upgrade to Plan ${planId}`, callback_data: `upgrade_${planId}` }],
              [{ text: '🔍 Validate First', callback_data: `validate_upgrade_${planId}` }]
            ]
          };
        } else if (targetPlan > currentPlan + 1) {
          actionMessage = `\n⚠️ *Must upgrade one plan at a time*\nYou are on Plan ${currentPlan}, must upgrade to Plan ${currentPlan + 1} first`;
        } else {
          actionMessage = `\n⬇️ *This plan is lower than your current plan (${currentPlan})*`;
        }
      } else {
        if (planId === 1) {
          actionMessage = `\n💡 *Ready to register:*`;
          keyboard = {
            inline_keyboard: [
              [{ text: '📝 How to Register', callback_data: 'how_to_register' }]
            ]
          };
        } else {
          actionMessage = `\n⚠️ *New members must start from Plan 1 only*\nUse command: \`/planinfo 1\``;
        }
      }

      await this.sendMessage(chatId, `
📊 *Plan ${planId} Information*

📋 *Details:*
• Plan Name: ${planInfo.name}
• Price: ${priceFormatted} USDT
• Members per Cycle: ${planInfo.membersPerCycle} people
• Status: ${planInfo.isActive ? '🟢 Active' : '🔴 Inactive'}${actionMessage}
      `, keyboard ? { reply_markup: keyboard } : {});

    } catch (error) {
      console.error('PlanInfo error:', error);
      await this.sendMessage(chatId, `❌ Error retrieving plan info: ${error.message}`);
    }
  }

  async handleTotalPlans(msg) {
    const chatId = msg.chat.id;

    try {
      const totalPlans = await this.contractService.getTotalPlanCount();
      await this.sendMessage(chatId, `📊 Total membership plans: *${totalPlans}* plans\n\nUse \`/allplans\` to view details of all plans`);
    } catch (error) {
      console.error('TotalPlans error:', error);
      await this.sendMessage(chatId, `❌ Error retrieving total plans: ${error.message}`);
    }
  }

  async handleAllPlans(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const totalPlans = await this.contractService.getTotalPlanCount();
      const { ethers } = require('ethers');
      const usdtDecimals = await this.contractService.usdtContract.decimals();

      let message = '📊 *All Membership Plans*\n\n';

      for (let i = 1; i <= parseInt(totalPlans); i++) {
        try {
          const planInfo = await this.contractService.getPlanInfo(i);
          const priceFormatted = ethers.formatUnits(planInfo.price, usdtDecimals);
          const status = planInfo.isActive ? '🟢' : '🔴';

          message += `${status} *Plan ${i}: ${planInfo.name}*\n`;
          message += `   💰 ${priceFormatted} USDT\n`;
          message += `   👥 ${planInfo.membersPerCycle} people/cycle\n\n`;
        } catch (error) {
          message += `❌ Plan ${i}: Unable to load data\n\n`;
        }
      }

      const connection = await this.walletService.checkConnection(userId);
      if (connection.connected) {
        try {
          const memberInfo = await this.contractService.getMemberInfo(connection.address);

          if (memberInfo.isMember) {
            const currentPlan = parseInt(memberInfo.planId);
            const nextPlan = currentPlan + 1;

            message += `\n👤 *Your Status:*\n`;
            message += `• Current Plan: Plan ${currentPlan}\n`;

            if (nextPlan <= parseInt(totalPlans)) {
              message += `• Next Upgrade: \`/upgrade ${nextPlan}\`\n`;
            } else {
              message += `• You are on the highest plan! 🏆\n`;
            }
          } else {
            message += `\n👤 *Get Started:*\n`;
            message += `• Register: \`/register 1 <upline_address>\`\n`;
          }
        } catch (error) {
          // Ignore error
        }
      } else {
        message += `\n👤 *Get Started:*\n`;
        message += `• Connect Wallet: \`/connect\`\n`;
      }

      await this.sendMessage(chatId, message);
    } catch (error) {
      console.error('AllPlans error:', error);
      await this.sendMessage(chatId, `❌ Error retrieving plans: ${error.message}`);
    }
  }

  async handleContractStatus(msg) {
    const chatId = msg.chat.id;

    try {
      const isPaused = await this.contractService.isContractPaused();
      const owner = await this.contractService.getContractOwner();
      const networkInfo = await this.contractService.getNetworkInfo();

      await this.sendMessage(chatId, `
🔧 *Contract Status*

📋 *Contract Details:*
• Status: ${isPaused ? '🔴 Paused' : '🟢 Active'}
• Owner: \`${owner}\`
• Contract: \`${config.contractAddress}\`

🌐 *Network Information:*
• Network: ${config.networkName}
• Chain ID: ${networkInfo.chainId}
• Current Block: ${networkInfo.blockNumber}
• Gas Price: ${ethers.formatUnits(networkInfo.gasPrice || '0', 'gwei')} Gwei

🔗 *Explorer:* [View Contract](${config.explorerUrl}/address/${config.contractAddress})
      `);

    } catch (error) {
      console.error('ContractStatus error:', error);
      await this.sendMessage(chatId, `❌ Error retrieving contract status: ${error.message}`);
    }
  }

  async handleUSDTBalance(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const connection = await this.walletService.checkConnection(userId);
      if (!connection.connected) {
        await this.sendMessage(chatId, `
❌ *Wallet Not Connected*

Please connect your wallet first:
\`/connect\`
        `);
        return;
      }

      const balanceInfo = await this.contractService.getUSDTBalance(connection.address);
      const allowanceInfo = await this.contractService.getUSDTAllowance(connection.address);

      await this.sendMessage(chatId, `
💰 *USDT Information*

🔗 *Wallet:* \`${connection.address}\`

💳 *Balance Details:*
• USDT Balance: ${balanceInfo.formatted} USDT
• USDT Allowance: ${allowanceInfo.formatted} USDT

📝 *Note:*
• Balance: Available USDT in your wallet
• Allowance: USDT approved for contract usage

💡 *Commands:*
• \`/approve <amount>\` - Approve more USDT
• \`/wallet\` - View complete wallet info
      `);

    } catch (error) {
      console.error('USDTBalance error:', error);
      await this.sendMessage(chatId, `❌ Error retrieving USDT info: ${error.message}`);
    }
  }

  async handleValidateRegistration(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const planId = parseInt(match[1]);
    const uplineAddress = match[2];

    try {
      const connection = await this.walletService.checkConnection(userId);
      if (!connection.connected) {
        await this.sendMessage(chatId, '❌ Please connect your wallet first: `/connect`');
        return;
      }

      await this.sendMessage(chatId, '⏳ Validating registration conditions...');

      await this.contractService.validateRegistration(connection.address, planId, uplineAddress);

      await this.sendMessage(chatId, `
✅ *All validations passed!*

📋 *Details:*
• Wallet: \`${connection.address}\`
• Plan: ${planId}
• Upline: \`${uplineAddress}\`

🟢 Ready to register! Use command:
\`/register ${planId} ${uplineAddress}\`
      `);

    } catch (error) {
      console.error('ValidateRegistration error:', error);
      await this.sendMessage(chatId, `❌ Validation failed: ${error.message}

💡 *Suggestions:*
• Check if you're already a member with \`/myinfo\`
• Ensure upline is a valid member
• Check USDT balance with \`/wallet\`
• Use \`/approve <amount>\` to approve USDT`);
    }
  }

  async handleValidateUpgrade(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newPlanId = parseInt(match[1]);

    try {
      const connection = await this.walletService.checkConnection(userId);
      if (!connection.connected) {
        await this.sendMessage(chatId, '❌ Please connect your wallet first: `/connect`');
        return;
      }

      await this.sendMessage(chatId, '⏳ Validating upgrade conditions...');

      const validation = await this.contractService.validateUpgrade(connection.address, newPlanId);

      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const { ethers } = require('ethers');
      const upgradeCost = ethers.formatUnits(validation.upgradeCost, usdtDecimals);
      const newPlanPrice = ethers.formatUnits(validation.newPlanInfo.price, usdtDecimals);

      await this.sendMessage(chatId, `
✅ *All validations passed!*

📋 *Details:*
• Wallet: \`${connection.address}\`
• Current Plan: Plan ${validation.currentPlan}
• New Plan: ${validation.newPlanInfo.name} (Plan ${newPlanId})
• New Plan Price: ${newPlanPrice} USDT
• Upgrade Cost: ${upgradeCost} USDT

🟢 Ready to upgrade! Use command:
\`/upgrade ${newPlanId}\`
      `);

    } catch (error) {
      console.error('ValidateUpgrade error:', error);
      await this.sendMessage(chatId, `❌ Validation failed: ${error.message}

💡 *Suggestions:*
• Check if you are already a member with \`/myinfo\`
• Ensure you upgrade one plan at a time
• Check USDT balance and allowance with \`/wallet\`
• Use \`/approve <amount>\` if allowance is insufficient`);
    }
  }

  async handleReferralLink(msg) {
    const userId = msg.from.id;

    try {
      const connection = await this.walletService.checkConnection(userId);
      if (!connection.connected) {
        await this.sendMessage(msg.chat.id, '❌ Please connect your wallet first: `/connect`');
        return;
      }

      const botUsername = this.me && this.me.username ? this.me.username : 'ChainsxCo_bot';
      const refLink = `https://t.me/${botUsername}?start=ref_${connection.address}`;

      await this.sendMessage(msg.chat.id, `
🔗 *Your Invitation Link*

${refLink}

📋 *How to use:*
• Share this link with friends
• When they click and start the bot, your address will be automatically set as their upline
• You'll earn commissions when they register and upgrade

💰 *Benefits:*
• Earn from direct referrals
• Build your downline network
• Passive income from team activities
      `);

    } catch (error) {
      console.error('ReferralLink error:', error);
      await this.sendMessage(msg.chat.id, `❌ Error generating referral link: ${error.message}`);
    }
  }

  start() {
    console.log('🤖 User Bot started with WalletConnect integration!');
    console.log(`🌐 Network: ${config.networkName}`);
    console.log(`📄 Contract: ${config.contractAddress}`);
    console.log(`🔗 WalletConnect bridge: https://bridge.walletconnect.org`);
    console.log(`🌐 API Server: http://localhost:3001`);
    console.log('✅ User Bot ready to receive commands...');
  }
}

module.exports = TelegramMembershipBot;