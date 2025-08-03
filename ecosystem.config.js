module.exports = {
  apps: [
    {
      name: 'membership-system',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        ENABLE_USER_BOT: 'true',
        ENABLE_ADMIN_BOT: 'true'
      },
      env_production: {
        NODE_ENV: 'production',
        ENABLE_USER_BOT: 'true', 
        ENABLE_ADMIN_BOT: 'true'
      },
      env_user_only: {
        NODE_ENV: 'production',
        ENABLE_USER_BOT: 'true',
        ENABLE_ADMIN_BOT: 'false'
      },
      env_admin_only: {
        NODE_ENV: 'production',
        ENABLE_USER_BOT: 'false',
        ENABLE_ADMIN_BOT: 'true'
      }
    }
  ]
};