const config = require('./config');

async function startBots() {
  const bots = [];
  
  try {
    console.log('🚀 Starting Telegram Membership System...\n');
    
    // Start User Bot
    if (config.enableUserBot) {
      console.log('🤖 Starting User Bot...');
      const TelegramMembershipBot = require('./bot');
      const userBot = new TelegramMembershipBot();
      userBot.start();
      bots.push({ 
        name: 'User Bot', 
        instance: userBot, 
        token: config.telegramBotToken 
      });
      console.log('   ✅ User Bot initialized');
    }
    
    // Start Admin Bot
    if (config.enableAdminBot) {
      console.log('🔧 Starting Admin Bot...');
      const TelegramAdminBot = require('./adminBot');
      const adminBot = new TelegramAdminBot();
      adminBot.start();
      bots.push({ 
        name: 'Admin Bot', 
        instance: adminBot, 
        token: config.adminTelegramBotToken 
      });
      console.log('   ✅ Admin Bot initialized');
    }
    
    if (bots.length === 0) {
      console.log('⚠️  No bots enabled. Check your .env configuration:');
      console.log('   ENABLE_USER_BOT=true');
      console.log('   ENABLE_ADMIN_BOT=true');
      process.exit(1);
    }
    
    console.log(`\n🎉 Successfully started ${bots.length} bot(s):`);
    bots.forEach(bot => {
      const maskedToken = bot.token ? `${bot.token.substring(0, 10)}...` : 'Not configured';
      console.log(`   ✅ ${bot.name} (${maskedToken})`);
    });
    
    console.log(`\n📱 Network: ${config.networkName}`);
    console.log(`📄 Contract: ${config.contractAddress}`);
    console.log(`👥 Admin Users: ${config.adminTelegramUserIds.length}`);
    console.log('\n🚀 All bots are ready and listening for commands!\n');
    
    // Usage information
    if (config.enableUserBot && config.enableAdminBot) {
      console.log('💡 Usage:');
      console.log('   👤 Users: Chat with User Bot for membership functions');
      console.log('   🔧 Admins: Chat with Admin Bot for system control');
    } else if (config.enableUserBot) {
      console.log('💡 Usage:');
      console.log('   👤 Users: Chat with User Bot for membership functions');
    } else if (config.enableAdminBot) {
      console.log('💡 Usage:');
      console.log('   🔧 Admins: Chat with Admin Bot for system control');
    }
    
  } catch (error) {
    console.error('❌ Error starting bots:', error.message);
    console.error('📋 Check your .env file configuration');
    
    // Show additional error details
    if (error.message.includes('TELEGRAM_BOT_TOKEN')) {
      console.error('   Missing: TELEGRAM_BOT_TOKEN in .env file');
    }
    if (error.message.includes('ADMIN_TELEGRAM_BOT_TOKEN')) {
      console.error('   Missing: ADMIN_TELEGRAM_BOT_TOKEN in .env file');
    }
    if (error.message.includes('CONTRACT_ADDRESS')) {
      console.error('   Missing: CONTRACT_ADDRESS in .env file');
    }
    
    process.exit(1);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down bots gracefully...');
  console.log('💡 All user sessions will be cleared on restart');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down bots gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

// Start the application
startBots();