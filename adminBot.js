const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const ContractService = require('./contractService');

class TelegramAdminBot {
  constructor() {
    this.bot = new TelegramBot(config.adminTelegramBotToken, { polling: true });
    this.contractService = new ContractService();
    
    this.setupCommands();
    this.setupErrorHandling();
  }

  setupCommands() {
    // Basic Commands
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));
    
    // System Control
    this.bot.onText(/\/pause/, (msg) => this.handlePause(msg));
    this.bot.onText(/\/unpause/, (msg) => this.handleUnpause(msg));
    this.bot.onText(/\/stats/, (msg) => this.handleStats(msg));
    
    // Plan Management
    this.bot.onText(/\/updateprice (.+) (.+)/, (msg, match) => this.handleUpdatePrice(msg, match));
    this.bot.onText(/\/setimage (.+) (.+)/, (msg, match) => this.handleSetImage(msg, match));
    this.bot.onText(/\/planstatus (.+) (.+)/, (msg, match) => this.handlePlanStatus(msg, match));
    
    // Financial Management
    this.bot.onText(/\/withdraw (.+) (.+)/, (msg, match) => this.handleWithdraw(msg, match));
    this.bot.onText(/\/balances/, (msg) => this.handleBalances(msg));
    
    // Emergency Commands
    this.bot.onText(/\/emergency_request/, (msg) => this.handleEmergencyRequest(msg));
    this.bot.onText(/\/emergency_withdraw/, (msg) => this.handleEmergencyWithdraw(msg));
    this.bot.onText(/\/emergency_cancel/, (msg) => this.handleEmergencyCancel(msg));
    
    // Monitoring
    this.bot.onText(/\/contractinfo/, (msg) => this.handleContractInfo(msg));
    this.bot.onText(/\/validate/, (msg) => this.handleValidateContract(msg));
  }

  setupErrorHandling() {
    this.bot.on('polling_error', (error) => {
      console.error('Admin Bot Polling error:', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Admin Bot Unhandled Rejection at:', promise, 'reason:', reason);
    });
  }

  // Utility Methods
  isAuthorized(userId) {
    return config.adminTelegramUserIds.includes(userId);
  }

  async sendMessage(chatId, text, options = {}) {
    try {
      return await this.bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        ...options
      });
    } catch (error) {
      console.error('Error sending admin message:', error);
      return await this.bot.sendMessage(chatId, text.replace(/[*_`]/g, ''));
    }
  }

  // Command Handlers
  async handleStart(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, `❌ Access Denied\n\nUser: ${username}\nID: ${userId}\n\nContact system administrator.`);
      console.warn(`Unauthorized access attempt: ${username} (${userId})`);
      return;
    }

    const welcomeMessage = `
🔧 *Admin Control Panel*

Welcome *${username}*!

🎛️ *System Control:*
• \`/pause\` - Pause system temporarily
• \`/unpause\` - Resume system
• \`/stats\` - View system statistics

💼 *Plan Management:*
• \`/updateprice <plan> <price>\` - Update plan price
• \`/setimage <plan> <uri>\` - Set plan image
• \`/planstatus <plan> <true/false>\` - Enable/disable plan

💰 *Financial:*
• \`/balances\` - View balances
• \`/withdraw <type> <amount>\` - Withdraw funds

🚨 *Emergency:*
• \`/emergency_request\` - Request emergency withdraw

📊 *Monitoring:*
• \`/contractinfo\` - Contract information
• \`/validate\` - Validate contract integrity

⚠️ *Warning:* These commands affect the entire system
    `;
    
    await this.sendMessage(chatId, welcomeMessage);
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    const helpMessage = `
🔧 *Admin Commands Reference*

📋 *Basic Commands:*
• \`/start\` - Access Admin Control Panel
• \`/help\` - Show all admin commands

🎛️ *System Control:*
• \`/pause\` - Pause contract operations temporarily
• \`/unpause\` - Resume contract operations
• \`/stats\` - View complete system statistics

💼 *Plan Management:*
• \`/updateprice <plan_id> <new_price>\` - Update plan price
• \`/setimage <plan_id> <image_uri>\` - Set plan image
• \`/planstatus <plan_id> <true/false>\` - Enable/disable plan

💰 *Financial Management:*
• \`/balances\` - View all balances
• \`/withdraw <type> <amount>\` - Withdraw funds
  - type: owner, fee, fund
  - amount: USDT amount

🚨 *Emergency Commands:*
• \`/emergency_request\` - Request emergency withdraw (48hr timelock)
• \`/emergency_withdraw\` - Execute emergency withdraw
• \`/emergency_cancel\` - Cancel emergency request

📊 *System Monitoring:*
• \`/contractinfo\` - View contract details
• \`/validate\` - Validate contract integrity

📝 *Usage Examples:*
\`/updateprice 1 1.5\` - Change Plan 1 price to 1.5 USDT
\`/withdraw owner 100\` - Withdraw 100 USDT from owner balance
\`/planstatus 1 false\` - Disable Plan 1
\`/setimage 1 ipfs://xxx\` - Set Plan 1 image

⚠️ *Important Warnings:*
• These commands affect the entire system
• Verify parameters before sending
• Emergency withdraw has 48-hour timelock
• Only authorized Admin User IDs allowed

🌐 *System Information:*
• Network: ${config.networkName}
• Contract: \`${config.contractAddress}\`
• Admin Users: ${config.adminTelegramUserIds.length} users

💡 *Tips:*
• Use \`/stats\` for system overview
• Use \`/balances\` before withdrawing
• Backup important data regularly
    `;

    await this.sendMessage(chatId, helpMessage);
  }

  async handlePause(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      await this.sendMessage(chatId, '⏳ Pausing system...');
      
      const tx = await this.contractService.setPaused(true);
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);
      
      await this.sendMessage(chatId, `
✅ *System Paused*

🔴 Status: PAUSED
📄 TX: [Explorer](${explorerUrl})
⏰ Time: ${new Date().toLocaleString('en-US')}

⚠️ *Effects:*
• Users cannot register
• Cannot upgrade plans
• System stops accepting new transactions

💡 Use \`/unpause\` to resume system
      `);

    } catch (error) {
      console.error('Pause error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleUnpause(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      await this.sendMessage(chatId, '⏳ Resuming system...');
      
      const tx = await this.contractService.setPaused(false);
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);
      
      await this.sendMessage(chatId, `
✅ *System Active*

🟢 Status: ACTIVE
📄 TX: [Explorer](${explorerUrl})
⏰ Time: ${new Date().toLocaleString('en-US')}

🎉 *System Ready:*
• Users can register
• Can upgrade plans
• Normal transaction processing

📊 Use \`/stats\` to view latest statistics
      `);

    } catch (error) {
      console.error('Unpause error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleStats(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      const { ethers } = require('ethers');
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      
      const stats = await this.contractService.contract.getSystemStats();
      const status = await this.contractService.contract.getContractStatus();
      const owner = await this.contractService.getContractOwner();
      
      const totalMembers = stats[0].toString();
      const totalRevenue = ethers.formatUnits(stats[1], usdtDecimals);
      const totalCommission = ethers.formatUnits(stats[2], usdtDecimals);
      const ownerFunds = ethers.formatUnits(stats[3], usdtDecimals);
      const feeFunds = ethers.formatUnits(stats[4], usdtDecimals);
      const fundFunds = ethers.formatUnits(stats[5], usdtDecimals);

      const isPaused = status[0];
      const totalBalance = ethers.formatUnits(status[1], usdtDecimals);
      const memberCount = status[2].toString();
      const currentPlanCount = status[3].toString();
      const hasEmergencyRequest = status[4];
      const emergencyTimeRemaining = status[5].toString();

      let emergencyInfo = '';
      if (hasEmergencyRequest) {
        const hoursRemaining = Math.floor(parseInt(emergencyTimeRemaining) / 3600);
        emergencyInfo = `\n🚨 *Emergency Request Active*\n⏰ Remaining: ${hoursRemaining} hours`;
      }

      await this.sendMessage(chatId, `
📊 *Admin Dashboard*

⚙️ *System Status:*
• Contract: ${isPaused ? '🔴 PAUSED' : '🟢 ACTIVE'}
• Owner: \`${owner}\`
• Network: ${config.networkName}

👥 *Members:*
• Total Members: ${totalMembers} people
• Available Plans: ${currentPlanCount} plans

💰 *Finance (USDT):*
• Total Revenue: ${totalRevenue}
• Commission Paid: ${totalCommission}
• Contract Balance: ${totalBalance}

💳 *Fund Balances:*
• Owner Balance: ${ownerFunds}
• Fee Balance: ${feeFunds}
• Fund Balance: ${fundFunds}${emergencyInfo}

⏰ *Updated:* ${new Date().toLocaleString('en-US')}

💡 Use \`/balances\` for financial details
      `);

    } catch (error) {
      console.error('Stats error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleBalances(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      const { ethers } = require('ethers');
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const stats = await this.contractService.contract.getSystemStats();
      
      const ownerFunds = ethers.formatUnits(stats[3], usdtDecimals);
      const feeFunds = ethers.formatUnits(stats[4], usdtDecimals);
      const fundFunds = ethers.formatUnits(stats[5], usdtDecimals);

      const totalInternal = parseFloat(ownerFunds) + parseFloat(feeFunds) + parseFloat(fundFunds);
      
      // Check actual balance in contract
      const actualBalance = await this.contractService.usdtContract.balanceOf(config.contractAddress);
      const actualFormatted = ethers.formatUnits(actualBalance, usdtDecimals);
      
      const difference = parseFloat(actualFormatted) - totalInternal;
      const balanceStatus = Math.abs(difference) < 0.001 ? '✅' : '⚠️';

      await this.sendMessage(chatId, `
💳 *Balance Details*

📊 *Internal Balances:*
• Owner Balance: ${ownerFunds} USDT
• Fee Balance: ${feeFunds} USDT
• Fund Balance: ${fundFunds} USDT
• Total Internal: ${totalInternal.toFixed(6)} USDT

💰 *Contract Balance:*
• Actual Contract Balance: ${actualFormatted} USDT
• Difference: ${difference.toFixed(6)} USDT ${balanceStatus}

💡 *Usage:*
• Owner: Withdrawable immediately
• Fee: For system fees  
• Fund: For member refunds

🔧 *Withdrawal Commands:*
\`/withdraw owner ${ownerFunds}\`
\`/withdraw fee ${feeFunds}\`
\`/withdraw fund ${fundFunds}\`

${balanceStatus === '⚠️' ? '⚠️ *Balance anomaly detected, please investigate*' : ''}
      `);

    } catch (error) {
      console.error('Balances error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleUpdatePrice(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      const planId = parseInt(match[1]);
      const newPrice = parseFloat(match[2]);

      if (isNaN(planId) || planId <= 0) {
        await this.sendMessage(chatId, '❌ Invalid Plan ID');
        return;
      }

      if (isNaN(newPrice) || newPrice <= 0) {
        await this.sendMessage(chatId, '❌ Invalid price');
        return;
      }

      await this.sendMessage(chatId, '⏳ Updating price...');

      // Convert price to wei using USDT decimals
      const priceInWei = await this.contractService.parsePrice(newPrice.toString());
      const tx = await this.contractService.updatePlanPrice(planId, priceInWei);
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
✅ *Price Update Successful!*

📋 *Details:*
• Plan ${planId}: ${newPrice} USDT
• Transaction: [Explorer](${explorerUrl})
• Time: ${new Date().toLocaleString('en-US')}

💡 Users will see new price immediately
      `);

    } catch (error) {
      console.error('UpdatePrice error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleSetImage(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      const planId = parseInt(match[1]);
      const imageUri = match[2];

      if (isNaN(planId) || planId <= 0) {
        await this.sendMessage(chatId, '❌ Invalid Plan ID');
        return;
      }

      if (!imageUri || imageUri.length === 0) {
        await this.sendMessage(chatId, '❌ Invalid Image URI');
        return;
      }

      await this.sendMessage(chatId, '⏳ Setting image...');

      const tx = await this.contractService.setPlanDefaultImage(planId, imageUri);
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
✅ *Image Set Successfully!*

📋 *Details:*
• Plan ${planId}
• Image URI: \`${imageUri}\`
• Transaction: [Explorer](${explorerUrl})
• Time: ${new Date().toLocaleString('en-US')}

🖼️ New NFTs will use this image
      `);

    } catch (error) {
      console.error('SetImage error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handlePlanStatus(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      const planId = parseInt(match[1]);
      const status = match[2].toLowerCase() === 'true';

      if (isNaN(planId) || planId <= 0) {
        await this.sendMessage(chatId, '❌ Invalid Plan ID');
        return;
      }

      await this.sendMessage(chatId, `⏳ ${status ? 'Enabling' : 'Disabling'} plan...`);

      const tx = await this.contractService.setPlanStatus(planId, status);
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
✅ *Plan ${status ? 'Enabled' : 'Disabled'} Successfully!*

📋 *Details:*
• Plan ${planId}: ${status ? '🟢 Active' : '🔴 Inactive'}
• Transaction: [Explorer](${explorerUrl})
• Time: ${new Date().toLocaleString('en-US')}

${status ? '🎉 Users can register/upgrade to this plan' : '⚠️ Users cannot register/upgrade to this plan'}
      `);

    } catch (error) {
      console.error('PlanStatus error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleWithdraw(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      const type = match[1].toLowerCase();
      const amount = parseFloat(match[2]);

      if (!['owner', 'fee', 'fund'].includes(type)) {
        await this.sendMessage(chatId, '❌ Invalid type. Use: owner, fee, or fund');
        return;
      }

      if (isNaN(amount) || amount <= 0) {
        await this.sendMessage(chatId, '❌ Invalid amount');
        return;
      }

      await this.sendMessage(chatId, '⏳ Withdrawing funds...');

      // Convert amount to wei
      const amountInWei = await this.contractService.parsePrice(amount.toString());
      let tx;

      switch (type) {
        case 'owner':
          tx = await this.contractService.withdrawOwnerBalance(amountInWei);
          break;
        case 'fee':
          tx = await this.contractService.withdrawFeeBalance(amountInWei);
          break;
        case 'fund':
          tx = await this.contractService.withdrawFundBalance(amountInWei);
          break;
      }

      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
✅ *Withdrawal Successful!*

📋 *Details:*
• Type: ${type.toUpperCase()} Balance
• Amount: ${amount} USDT
• Transaction: [Explorer](${explorerUrl})
• Time: ${new Date().toLocaleString('en-US')}

💰 Funds sent to owner wallet
      `);

    } catch (error) {
      console.error('Withdraw error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleEmergencyRequest(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      await this.sendMessage(chatId, '⏳ Requesting Emergency Withdraw...');

      const tx = await this.contractService.requestEmergencyWithdraw();
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
🚨 *Emergency Withdraw Request Successful!*

📋 *Details:*
• Timelock: 48 hours
• Transaction: [Explorer](${explorerUrl})
• Start Time: ${new Date().toLocaleString('en-US')}

⏰ *Next Steps:*
• Wait 48 hours
• Use \`/emergency_withdraw\` to execute
• Or \`/emergency_cancel\` to cancel

⚠️ *Warning:* Emergency withdraw will withdraw all funds from contract
      `);

    } catch (error) {
      console.error('EmergencyRequest error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleEmergencyWithdraw(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      await this.sendMessage(chatId, '⏳ Executing Emergency Withdraw...');

      const tx = await this.contractService.emergencyWithdraw();
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
🚨 *Emergency Withdraw Successful!*

📋 *Details:*
• Transaction: [Explorer](${explorerUrl})
• Time: ${new Date().toLocaleString('en-US')}

💰 All funds transferred to owner wallet

⚠️ *Next Steps:*
• Check wallet balance
• Consider refunding contract
• Or temporarily pause service
      `);

    } catch (error) {
      console.error('EmergencyWithdraw error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleEmergencyCancel(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      await this.sendMessage(chatId, '⏳ Canceling Emergency Request...');

      const tx = await this.contractService.cancelEmergencyWithdraw();
      const explorerUrl = this.contractService.getExplorerUrl(tx.transactionHash);

      await this.sendMessage(chatId, `
✅ *Emergency Request Canceled Successfully!*

📋 *Details:*
• Transaction: [Explorer](${explorerUrl})
• Time: ${new Date().toLocaleString('en-US')}

🔄 System returned to normal state
      `);

    } catch (error) {
      console.error('EmergencyCancel error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleContractInfo(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      const owner = await this.contractService.getContractOwner();
      const isPaused = await this.contractService.isContractPaused();
      const totalPlans = await this.contractService.getTotalPlanCount();

      // Get contract balance
      const { ethers } = require('ethers');
      const contractBalance = await this.contractService.usdtContract.balanceOf(config.contractAddress);
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      const balanceFormatted = ethers.formatUnits(contractBalance, usdtDecimals);

      await this.sendMessage(chatId, `
📄 *Contract Information*

🏗️ *Contract Details:*
• Address: \`${config.contractAddress}\`
• Owner: \`${owner}\`
• Network: ${config.networkName}
• Chain ID: ${config.chainId}

💰 *USDT Contract:*
• Address: \`${config.usdtContractAddress}\`
• Balance in Contract: ${balanceFormatted} USDT

📊 *Contract Status:*
• Paused: ${isPaused ? '🔴 Yes' : '🟢 No'}
• Total Plans: ${totalPlans}
• Explorer: [View Contract](${config.explorerUrl}/address/${config.contractAddress})

🔧 *Admin Info:*
• Authorized Users: ${config.adminTelegramUserIds.length}
• Your User ID: ${userId}

⏰ *Updated:* ${new Date().toLocaleString('en-US')}
      `);

    } catch (error) {
      console.error('ContractInfo error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  async handleValidateContract(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!this.isAuthorized(userId)) {
      await this.sendMessage(chatId, '❌ Access Denied');
      return;
    }

    try {
      await this.sendMessage(chatId, '⏳ Validating contract...');

      // Validate contract balance
      const { ethers } = require('ethers');
      const stats = await this.contractService.contract.getSystemStats();
      const usdtDecimals = await this.contractService.usdtContract.decimals();
      
      const ownerFunds = parseFloat(ethers.formatUnits(stats[3], usdtDecimals));
      const feeFunds = parseFloat(ethers.formatUnits(stats[4], usdtDecimals));
      const fundFunds = parseFloat(ethers.formatUnits(stats[5], usdtDecimals));
      const totalInternal = ownerFunds + feeFunds + fundFunds;

      const actualBalance = await this.contractService.usdtContract.balanceOf(config.contractAddress);
      const actualFormatted = parseFloat(ethers.formatUnits(actualBalance, usdtDecimals));
      
      const difference = actualFormatted - totalInternal;
      const isBalanced = Math.abs(difference) < 0.001;

      // Check if contract is paused
      const isPaused = await this.contractService.isContractPaused();
      
      // Check owner
      const owner = await this.contractService.getContractOwner();
      const expectedOwner = config.adminPrivateKey ? 
        new ethers.Wallet(config.adminPrivateKey).address : 'Not configured';

      await this.sendMessage(chatId, `
🔍 *Contract Validation Report*

💰 *Balance Validation:*
• Internal Total: ${totalInternal.toFixed(6)} USDT
• Actual Balance: ${actualFormatted.toFixed(6)} USDT
• Difference: ${difference.toFixed(6)} USDT
• Status: ${isBalanced ? '✅ Balanced' : '⚠️ Imbalanced'}

🎛️ *System Status:*
• Contract Paused: ${isPaused ? '🔴 Yes' : '✅ No'}
• Owner Match: ${owner.toLowerCase() === expectedOwner.toLowerCase() ? '✅ Yes' : '❌ No'}
• Expected Owner: \`${expectedOwner}\`
• Actual Owner: \`${owner}\`

📊 *Fund Distribution:*
• Owner Funds: ${ownerFunds.toFixed(6)} USDT
• Fee Funds: ${feeFunds.toFixed(6)} USDT  
• Fund Balance: ${fundFunds.toFixed(6)} USDT

${isBalanced && !isPaused && owner.toLowerCase() === expectedOwner.toLowerCase() ? 
  '✅ *Everything is normal!*' : 
  '⚠️ *Issues found, please investigate!*'
}

⏰ *Validation Time:* ${new Date().toLocaleString('en-US')}
      `);

    } catch (error) {
      console.error('ValidateContract error:', error);
      await this.sendMessage(chatId, `❌ Error occurred: ${error.message}`);
    }
  }

  start() {
    console.log('🔧 Admin Bot started!');
    console.log(`📱 Admin Network: ${config.networkName}`);
    console.log(`📄 Contract: ${config.contractAddress}`);
    console.log(`👥 Authorized Users: ${config.adminTelegramUserIds.length}`);
    console.log('✅ Admin Bot ready for commands...');
  }
}

module.exports = TelegramAdminBot;