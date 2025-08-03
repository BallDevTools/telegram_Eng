require('dotenv').config();

const config = {
  // Telegram Bot Configuration
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  adminTelegramBotToken: process.env.ADMIN_TELEGRAM_BOT_TOKEN,
  
  // Bot Control
  enableUserBot: process.env.ENABLE_USER_BOT !== 'false', // default true
  enableAdminBot: process.env.ENABLE_ADMIN_BOT === 'true', // default false
  
  // Blockchain Configuration
  rpcUrl: process.env.RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
  chainId: parseInt(process.env.CHAIN_ID) || 97,
  
  // Smart Contract Configuration
  contractAddress: process.env.CONTRACT_ADDRESS,
  usdtContractAddress: process.env.USDT_CONTRACT_ADDRESS || '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
  
  // Admin Configuration
  adminPrivateKey: process.env.ADMIN_WALLET_PRIVATE_KEY,
  adminTelegramUserIds: process.env.ADMIN_TELEGRAM_USER_IDS ? 
    process.env.ADMIN_TELEGRAM_USER_IDS.split(',').map(id => parseInt(id.trim())) : [],
  
  // Network Information
  networkName: process.env.NETWORK_NAME || 'BSC Testnet',
  explorerUrl: process.env.EXPLORER_URL || 'https://testnet.bscscan.com',
  
  // Gas Configuration
  gasLimit: parseInt(process.env.GAS_LIMIT) || 1000000,
  gasPrice: process.env.GAS_PRICE || '20000000000',
};

// Validation
if (config.enableUserBot && !config.telegramBotToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is required for user bot');
}

if (config.enableAdminBot && !config.adminTelegramBotToken) {
  throw new Error('ADMIN_TELEGRAM_BOT_TOKEN is required for admin bot');
}

if (!config.contractAddress) {
  throw new Error('CONTRACT_ADDRESS is required');
}

if (config.enableAdminBot && config.adminTelegramUserIds.length === 0) {
  console.warn('Warning: No admin user IDs configured for admin bot');
}

module.exports = config;