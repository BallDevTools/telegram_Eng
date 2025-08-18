const express = require('express');
const cors = require('cors');

class SimpleServer {
  constructor(walletService, port = 3001) {
    this.app = express();
    this.walletService = walletService;
    this.port = port;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Allow CORS from chainsx.info
    this.app.use(cors({
      origin: [
        'https://chainsx.info',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ],
      credentials: true
    }));
    this.app.use(express.json());
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Check wallet connection status
    this.app.get('/api/wallet/status/:userId', async (req, res) => {
      try {
        const userId = parseInt(req.params.userId);
        const connection = await this.walletService.checkConnection(userId);
        
        console.log(`📊 API: Checking connection for user ${userId}:`, connection);
        
        res.json({
          connected: connection.connected,
          address: connection.address,
          chainId: connection.chainId,
          sessionId: connection.sessionId,
          reason: connection.reason
        });
      } catch (error) {
        console.error('API Error checking connection:', error);
        res.status(500).json({ 
          error: 'Internal server error',
          connected: false 
        });
      }
    });

    // Webhook for wallet notifications (optional)
    this.app.post('/api/wallet/notify-connected', (req, res) => {
      try {
        const { userId, address, chainId } = req.body;
        console.log(`📨 API: Wallet connected notification:`, { userId, address, chainId });
        
        // Could emit event here if needed
        res.json({ 
          success: true, 
          message: 'Notification received' 
        });
      } catch (error) {
        console.error('API Error processing notification:', error);
        res.status(500).json({ 
          error: 'Internal server error' 
        });
      }
    });

    // Get wallet service stats
    this.app.get('/api/wallet/stats', (req, res) => {
      try {
        const stats = this.walletService.getStats();
        res.json(stats);
      } catch (error) {
        console.error('API Error getting stats:', error);
        res.status(500).json({ 
          error: 'Internal server error' 
        });
      }
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err) => {
        if (err) {
          console.error(`❌ Failed to start API server on port ${this.port}:`, err);
          reject(err);
        } else {
          console.log(`🌐 API server started on port ${this.port}`);
          console.log(`   Health: http://localhost:${this.port}/health`);
          console.log(`   Wallet Status: http://localhost:${this.port}/api/wallet/status/:userId`);
          resolve();
        }
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log(`🛑 API server stopped`);
    }
  }
}

module.exports = SimpleServer;