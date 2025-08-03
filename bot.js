const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const ContractService = require('./contractService');

class TelegramMembershipBot {
  constructor() {
    this.bot = new TelegramBot(config.telegramBotToken, {
      polling: true
    });
    this.contractService = new ContractService();
    this.userSessions = new Map();

    // Initialize me object with fallback value
    this.me = {
      username: 'YourBot'
    };

    this.setupCommands();
    this.setupErrorHandling();

    // Call start() after setup is complete
    this.initializeBot();
  }

  async initializeBot() {
    try {
      this.me = await this.bot.getMe();
      console.log(`🤖 Bot username loaded: @${this.me.username}`);
    } catch (err) {
      console.warn('⚠️ Unable to load bot username:', err.message);
      this.me = {
        username: 'YourBot'
      }; // fallback
    }
  }

  setupCommands() {
    // Basic Commands
    this.bot.onText(/\/start(?:\s+ref_(0x[a-fA-F0-9]{40}))?/, (msg, match) => this.handleStart(msg, match));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));

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
    this.bot.onText(/\/usdtbalance (.+)/, (msg, match) => this.handleUSDTBalance(msg, match));

    // Wallet Management Commands
    this.bot.onText(/\/setprivatekey (.+)/, (msg, match) => this.handleSetPrivateKey(msg, match));
    this.bot.onText(/\/mywallet/, (msg) => this.handleMyWallet(msg));

    // Validation Commands
    this.bot.onText(/\/validate (.+) (.+)/, (msg, match) => this.handleValidateRegistration(msg, match));
    this.bot.onText(/\/validateupgrade (.+)/, (msg, match) => this.handleValidateUpgrade(msg, match));
    this.bot.onText(/\/approve (.+)/, (msg, match) => this.handleApproveUSDT(msg, match));

    // Referral Commands
    this.bot.onText(/\/getreferrallink/, (msg) => this.handleReferralLink(msg));
  }

  setupErrorHandling() {
    this.bot.on('polling_error', (error) => {
      console.error('User Bot Polling error:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('User Bot Unhandled Rejection at:', promise, 'reason:', reason);
    });
  }

  // Utility Methods
  getUserSession(userId) {
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, {});
    }
    return this.userSessions.get(userId);
  }

  async sendMessage(chatId, text, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...options
      });
    } catch (error) {
      console.error('Error sending message:', error);
      // Fallback without markdown
      return await this.bot.sendMessage(chatId, text.replace(/[*_`]/g, ''));
    }
  }

  async handleStart(msg, match) {
    const chatId = msg.chat.id;
    const refAddress = match?.[1];

    const session = this.getUserSession(msg.from.id);

    if (refAddress) {
      session.referrer = refAddress;
      await this.sendMessage(chatId, `🎉 You were invited by \`${refAddress}\`\nThe system will use this as upline when you register`);
    } else {
      await this.sendMessage(chatId, `
🎉 *Welcome to Crypto Membership!*

This bot helps you manage NFT membership on ${config.networkName} easily.

🚀 *Getting Started:*
1️⃣ \`/setprivatekey <your_key>\` - Set up wallet (private chat)
2️⃣ \`/myinfo\` - Check member status
3️⃣ \`/register 1 <upline_address>\` - Register membership

📋 *Main Commands:*
• \`/help\` - Show all commands
• \`/myinfo\` - View member info
• \`/allplans\` - View all plans
• \`/contractstatus\` - Check system status

🔐 *Security:*
⚠️ Never send private key in group chats!
⚠️ Use private chat with bot only!

💡 Type \`/help\` to see all commands
      `);
    }
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;

    const helpMessage = `
🤖 *Crypto Membership Bot Help*

Manage NFT membership system on ${config.networkName} easily with these commands:

🔹 *Getting Started*
• \`/start\` – Start using / Introduction
• \`/help\` – Show all commands
• \`/setprivatekey <key>\` – Set up wallet (private chat only)

🔹 *Registration / Upgrade*
• \`/register <plan> [upline]\` – Register new membership
• \`/upgrade <plan>\` – Upgrade membership plan
• \`/myinfo\` – View your membership info

🔹 *Plan Information*
• \`/planinfo <id>\` – View specific plan info
• \`/allplans\` – Show all active plans

🔹 *Referral (Invite Friends)*
• \`/getreferrallink\` – Get invitation link
• \`/start ref_<address>\` – Used automatically when clicking invite link

🔹 *Wallet & Status*
• \`/mywallet\` – View your address
• \`/usdtbalance <address>\` – Check USDT balance
• \`/contractstatus\` – Check system status

🛠️ *Validation Commands*
• \`/validate <plan> <upline>\` – Validate before registration
• \`/validateupgrade <plan>\` – Validate before upgrade
• \`/approve <amount>\` – Approve USDT to system

📌 **Usage Examples**
\`/setprivatekey 0x1234...\`
\`/register 1 0xABCD...\`
\`/approve 5\`
\`/upgrade 2\`

⚠️ **Important:**
- Never share Private Key with anyone!
- Use important commands in private chat only
- New members should start from Plan 1

🌐 **Network:**
• Network: ${config.networkName}
• Contract: \`${config.contractAddress}\`
  `;

    await this.sendMessage(chatId, helpMessage, {
      parse_mode: "Markdown"
    });
  }

  async handleReferralLink(msg) {
    const userId = msg.from.id;
    const session = this.getUserSession(userId);

    if (!session.privateKey) {
      return this.sendMessage(msg.chat.id, '❌ Please set up private key first with `/setprivatekey`');
    }

    const { Wallet } = require('ethers');
    const wallet = new Wallet(session.privateKey);

    // Check this.me and username before using
    const botUsername = this.me && this.me.username ? this.me.username : 'YourBot';
    const refLink = `https://t.me/${botUsername}?start=ref_${wallet.address}`;

    await this.sendMessage(msg.chat.id, `🔗 *Your Invitation Link:*\n${refLink}`);
  }

  async handleValidateUpgrade(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newPlanId = parseInt(match[1]);

    try {
      const session = this.getUserSession(userId);
      if (!session.privateKey) {
        await this.sendMessage(chatId, '❌ Please set up private key first');
        return;
      }

      const { Wallet, ethers } = require('ethers');
      const wallet = new Wallet(session.privateKey);

      await this.sendMessage(chatId, '⏳ Validating upgrade conditions...');

      // Use new validateUpgrade method
      const validation = await this.contractService.validateUpgrade(wallet.address, newPlanId);

      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const upgradeCost = ethers.formatUnits(validation.upgradeCost, usdtDecimals);
      const newPlanPrice = ethers.formatUnits(validation.newPlanInfo.price, usdtDecimals);

      await this.sendMessage(chatId, `
✅ **All validations passed!**

📋 **Details:**
• Wallet: \`${wallet.address}\`
• Current Plan: Plan ${validation.currentPlan}
• New Plan: ${validation.newPlanInfo.name} (Plan ${newPlanId})
• New Plan Price: ${newPlanPrice} USDT
• Upgrade Cost: ${upgradeCost} USDT

🎉 Ready to upgrade! Use command:
\`/upgrade ${newPlanId}\`
    `);

    } catch (error) {
      console.error('ValidateUpgrade error:', error);
      await this.sendMessage(chatId, `❌ Validation failed: ${error.message}

💡 **Suggestions:**
• Check if you are already a member
• Ensure you upgrade one plan at a time
• Check USDT balance and allowance
• Use \`/approve <amount>\` if allowance is insufficient`);
    }
  }

  async handleRegister(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const planId = match[1];
    let uplineAddress = match[2]; // May be undefined

    const session = this.getUserSession(userId);

    // If no upline provided → use referrer from session
    if (!uplineAddress && session.referrer) {
      uplineAddress = session.referrer;
    }

    if (!uplineAddress) {
      return this.sendMessage(chatId, '❌ Please specify upline address or use a valid invitation link');
    }

    try {
      // Validate planId
      if (!planId || isNaN(planId) || parseInt(planId) < 1) {
        return this.sendMessage(chatId, '❌ Invalid Plan ID. Please specify a number greater than 0');
      }

      if (!this.contractService.isValidAddress(uplineAddress)) {
        return this.sendMessage(chatId, '❌ Invalid upline address');
      }

      if (!session.privateKey) {
        return this.sendMessage(chatId, '❌ Please set up private key first. Use `/setprivatekey <your_private_key>` in private chat');
      }

      await this.sendMessage(chatId, '⏳ Registering membership...');

      const planInfo = await this.contractService.getPlanInfo(parseInt(planId));
      const { ethers } = require('ethers');
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const priceFormatted = ethers.formatUnits(planInfo.price, usdtDecimals);

      const tx = await this.contractService.registerMember(
        parseInt(planId),
        uplineAddress,
        session.privateKey
      );

      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
✅ *Membership Registration Successful!*

📋 *Details:*
• Plan: ${planInfo.name} (Plan ${planId})
• Price: ${priceFormatted} USDT
• Upline: \`${uplineAddress}\`
• Transaction: [View on Explorer](${explorerUrl})

🎉 Welcome to the membership system!

💡 *Useful Commands:*
• \`/myinfo\` - View your membership info
• \`/upgrade 2\` - Upgrade to Plan 2
• \`/planinfo 2\` - View other plan info
      `);

    } catch (error) {
      console.error('Register error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleUpgrade(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const newPlanId = match[1];

    try {
      if (!newPlanId || isNaN(newPlanId) || parseInt(newPlanId) < 1) {
        await this.sendMessage(chatId, '❌ Invalid Plan ID');
        return;
      }

      const session = this.getUserSession(userId);
      if (!session.privateKey) {
        await this.sendMessage(chatId, '❌ Please set up private key first');
        return;
      }

      await this.sendMessage(chatId, '⏳ Validating upgrade conditions...');

      // Check conditions first
      const { Wallet, ethers } = require('ethers');
      const wallet = new Wallet(session.privateKey);

      try {
        const validation = await this.contractService.validateUpgrade(wallet.address, parseInt(newPlanId));

        await this.sendMessage(chatId, '✅ Conditions passed, upgrading plan...');

        // Get new plan info and format price
        const newPlanInfo = validation.newPlanInfo;
        const usdtDecimals = await this.contractService.usdtContract.decimals();
        const newPlanPrice = ethers.formatUnits(newPlanInfo.price, usdtDecimals);
        const upgradeCost = ethers.formatUnits(validation.upgradeCost, usdtDecimals);

        const tx = await this.contractService.upgradePlan(parseInt(newPlanId), session.privateKey);
        const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

        await this.sendMessage(chatId, `
✅ *Plan Upgrade Successful!*

📋 *Details:*
• Previous Plan: Plan ${validation.currentPlan}
• New Plan: ${newPlanInfo.name} (Plan ${newPlanId})
• New Plan Price: ${newPlanPrice} USDT
• Upgrade Cost: ${upgradeCost} USDT
• Transaction: [View on Explorer](${explorerUrl})

🎉 Congratulations! You have upgraded successfully

💡 *Useful Commands:*
• \`/myinfo\` - View updated membership info
• \`/upgrade ${parseInt(newPlanId) + 1}\` - Upgrade to Plan ${parseInt(newPlanId) + 1}
      `);

      } catch (validationError) {
        // Show validation error
        await this.sendMessage(chatId, `❌ Cannot upgrade: ${validationError.message}

💡 *Suggestions:*
• Use \`/myinfo\` to view current status
• Use \`/allplans\` to view available plans
• Use \`/approve <amount>\` if USDT is insufficient`);
        return;
      }

    } catch (error) {
      console.error('Upgrade error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}

🔍 *Troubleshooting:*
1. Check USDT balance and approve sufficient amount
2. Ensure target plan is active
3. Ensure you upgrade one plan at a time (${parseInt(newPlanId)-1} → ${newPlanId})
4. Check that system is not paused`);
    }
  }

  async handleMyInfo(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const session = this.getUserSession(userId);
      if (!session.privateKey) {
        await this.sendMessage(chatId, '❌ Please set up private key first');
        return;
      }

      const { Wallet, ethers } = require('ethers');
      const wallet = new Wallet(session.privateKey);
      const memberInfo = await this.contractService.getMemberInfo(wallet.address);

      if (!memberInfo.isMember) {
        await this.sendMessage(chatId, '❌ You are not a member yet. Please register first');
        return;
      }

      const planInfo = await this.contractService.getPlanInfo(parseInt(memberInfo.planId));

      // Get USDT decimals and format earnings
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const earningsFormatted = ethers.formatUnits(memberInfo.totalEarnings, usdtDecimals);

      const registeredDate = new Date(parseInt(memberInfo.registeredAt) * 1000).toLocaleString('en-US');

      // Check if upgrade is possible
      const currentPlan = parseInt(memberInfo.planId);
      const nextPlan = currentPlan + 1;
      const totalPlans = await this.contractService.getTotalPlanCount();
      const canUpgrade = nextPlan <= parseInt(totalPlans);

      let upgradeMessage = '';
      if (canUpgrade) {
        upgradeMessage = `\n💡 *Useful Commands:*\n• \`/upgrade ${nextPlan}\` - Upgrade to Plan ${nextPlan}\n• \`/planinfo ${nextPlan}\` - View Plan ${nextPlan} info`;
      } else {
        upgradeMessage = `\n🏆 *You are on the highest plan!*`;
      }

      await this.sendMessage(chatId, `
👤 *Your Membership Info*

📋 *Details:*
• Wallet: \`${wallet.address}\`
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
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handlePlanInfo(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const planId = match[1];

    try {
      if (!planId || isNaN(planId) || parseInt(planId) < 1) {
        await this.sendMessage(chatId, '❌ Invalid Plan ID');
        return;
      }

      const planInfo = await this.contractService.getPlanInfo(parseInt(planId));

      // Format price correctly
      const { ethers } = require('ethers');
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const priceFormatted = ethers.formatUnits(planInfo.price, usdtDecimals);

      // Check if user is a member
      let memberInfo = null;
      let isExistingMember = false;

      const session = this.getUserSession(userId);
      if (session.privateKey) {
        try {
          const { Wallet } = require('ethers');
          const wallet = new Wallet(session.privateKey);
          memberInfo = await this.contractService.getMemberInfo(wallet.address);
          isExistingMember = memberInfo.isMember;
        } catch (error) {
          // No problem if data cannot be retrieved
        }
      }

      let actionMessage = '';

      if (isExistingMember) {
        const currentPlan = parseInt(memberInfo.planId);
        const targetPlan = parseInt(planId);

        if (targetPlan === currentPlan) {
          actionMessage = `\n✅ *You are already on this plan*`;
        } else if (targetPlan === currentPlan + 1) {
          actionMessage = `\n💡 *How to upgrade:*\n\`/upgrade ${planId}\``;
        } else if (targetPlan > currentPlan + 1) {
          actionMessage = `\n⚠️ *Must upgrade one plan at a time*\nYou are on Plan ${currentPlan}, must upgrade to Plan ${currentPlan + 1} first`;
        } else {
          actionMessage = `\n⬇️ *This plan is lower than your current plan*`;
        }
      } else {
        if (parseInt(planId) === 1) {
          actionMessage = `\n💡 *How to register new membership:*\n\`/register 1 <upline_address>\``;
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
      `);

    } catch (error) {
      console.error('PlanInfo error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleTotalPlans(msg) {
    const chatId = msg.chat.id;

    try {
      const totalPlans = await this.contractService.getTotalPlanCount();
      await this.sendMessage(chatId, `📊 Total membership plans: *${totalPlans}* plans\n\nUse \`/allplans\` to view details of all plans`);
    } catch (error) {
      console.error('TotalPlans error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleAllPlans(msg) {
    const chatId = msg.chat.id;

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

      // Add member information
      const session = this.getUserSession(msg.from.id);
      if (session.privateKey) {
        try {
          const { Wallet } = require('ethers');
          const wallet = new Wallet(session.privateKey);
          const memberInfo = await this.contractService.getMemberInfo(wallet.address);

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
            message += `\n👤 *For You:*\n`;
            message += `• Get Started: \`/register 1 <upline_address>\`\n`;
          }
        } catch (error) {
          // No problem if data cannot be retrieved
        }
      }

      await this.sendMessage(chatId, message);
    } catch (error) {
      console.error('AllPlans error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleContractStatus(msg) {
    const chatId = msg.chat.id;

    try {
      const isPaused = await this.contractService.isContractPaused();
      const owner = await this.contractService.getContractOwner();

      await this.sendMessage(chatId, `
🔍 *Contract Status*

📋 *Details:*
• Status: ${isPaused ? '🔴 Paused' : '🟢 Active'}
• Contract Owner: \`${owner}\`
• Network: ${config.networkName}
• Contract Address: \`${config.contractAddress}\`
      `);

    } catch (error) {
      console.error('ContractStatus error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleUSDTBalance(msg, match) {
    const chatId = msg.chat.id;
    const address = match[1];

    try {
      if (!this.contractService.isValidAddress(address)) {
        await this.sendMessage(chatId, '❌ Invalid address');
        return;
      }

      const balanceInfo = await this.contractService.getUSDTBalance(address);

      await this.sendMessage(chatId, `
💰 *USDT Balance*

📋 *Details:*
• Address: \`${address}\`
• Balance: ${balanceInfo.formatted} USDT
• Raw Amount: ${balanceInfo.balance}
      `);

    } catch (error) {
      console.error('USDTBalance error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleSetPrivateKey(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const privateKey = match[1];

    // Check if it's a private chat
    if (msg.chat.type !== 'private') {
      await this.sendMessage(chatId, '⚠️ This command can only be used in private chat for security');
      return;
    }

    try {
      // Validate private key
      const { Wallet } = require('ethers');
      const wallet = new Wallet(privateKey);

      // Save private key in session
      const session = this.getUserSession(userId);
      session.privateKey = privateKey;

      await this.sendMessage(chatId, `
✅ *Private Key Set Successfully!*

📋 *Details:*
• Wallet Address: \`${wallet.address}\`

⚠️ *Warning:*
• Private key is stored in temporary memory only
• If bot restarts, you will need to set it again
• Never share private key with anyone!

🔐 You can now use all commands
      `);

    } catch (error) {
      console.error('SetPrivateKey error:', error);
      await this.sendMessage(chatId, '❌ Invalid private key');
    }
  }

  async handleMyWallet(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const session = this.getUserSession(userId);
      if (!session.privateKey) {
        await this.sendMessage(chatId, '❌ You have not set up private key yet');
        return;
      }

      const { Wallet } = require('ethers');
      const wallet = new Wallet(session.privateKey);

      await this.sendMessage(chatId, `
💼 *Your Wallet Information*

📋 *Details:*
• Address: \`${wallet.address}\`
• Network: ${config.networkName}

💡 *Related Commands:*
• \`/usdtbalance ${wallet.address}\` - Check USDT balance
• \`/myinfo\` - View membership info
      `);

    } catch (error) {
      console.error('MyWallet error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleValidateRegistration(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const planId = match[1];
    const uplineAddress = match[2];

    try {
      const session = this.getUserSession(userId);
      if (!session.privateKey) {
        await this.sendMessage(chatId, '❌ Please set up private key first');
        return;
      }

      const { Wallet } = require('ethers');
      const wallet = new Wallet(session.privateKey);

      await this.sendMessage(chatId, '⏳ Validating conditions...');

      // Use new validate function
      await this.contractService.validateRegistration(wallet.address, parseInt(planId), uplineAddress);

      await this.sendMessage(chatId, `
✅ *All validations passed!*

📋 *Details:*
• Wallet: \`${wallet.address}\`
• Plan: ${planId}
• Upline: \`${uplineAddress}\`

🎉 Ready to register! Use command:
\`/register ${planId} ${uplineAddress}\`
      `);

    } catch (error) {
      console.error('ValidateRegistration error:', error);
      await this.sendMessage(chatId, `❌ Validation failed: ${error.message}`);
    }
  }

  async handleApproveUSDT(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const amount = match[1];

    try {
      const session = this.getUserSession(userId);
      if (!session.privateKey) {
        await this.sendMessage(chatId, '❌ Please set up private key first');
        return;
      }

      const { ethers, Wallet } = require('ethers');
      const wallet = new Wallet(session.privateKey, this.contractService.provider);

      const usdtContract = new ethers.Contract(
        config.usdtContractAddress,
        require('./contractABI').usdtABI,
        wallet
      );

      // Use correct USDT decimals
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const amountWei = ethers.parseUnits(amount, usdtDecimals);

      await this.sendMessage(chatId, '⏳ Approving USDT...');

      const tx = await usdtContract.approve(config.contractAddress, amountWei, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      await tx.wait();

      const explorerUrl = this.contractService.getExplorerUrl(tx.hash);

      await this.sendMessage(chatId, `
✅ *USDT Approval Successful!*

📋 *Details:*
• Amount: ${amount} USDT
• Transaction: [View on Explorer](${explorerUrl})

🎉 You can now register!
      `);

    } catch (error) {
      console.error('ApproveUSDT error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  start() {
    console.log('🤖 User Bot started!');
    console.log(`📱 Network: ${config.networkName}`);
    console.log(`📄 Contract: ${config.contractAddress}`);
    console.log('✅ User Bot ready to receive commands...');
  }
}

module.exports = TelegramMembershipBot;