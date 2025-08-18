const { ethers } = require('ethers');
const config = require('./config');
const { contractABI, usdtABI } = require('./contractABI');

class ContractService {
  constructor() {
    // Create provider for reading data
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Create contract instance for reading data
    this.contract = new ethers.Contract(config.contractAddress, contractABI, this.provider);
    this.usdtContract = new ethers.Contract(config.usdtContractAddress, usdtABI, this.provider);

    // Create contract interface for encoding function calls
    this.contractInterface = new ethers.Interface(contractABI);
    this.usdtInterface = new ethers.Interface(usdtABI);

    // Create wallet and contract instance for writing data (admin functions only)
    if (config.adminPrivateKey && config.adminPrivateKey !== 'test_private_key') {
      try {
        this.adminWallet = new ethers.Wallet(config.adminPrivateKey, this.provider);
        this.adminContract = new ethers.Contract(config.contractAddress, contractABI, this.adminWallet);
      } catch (error) {
        console.warn('Warning: Invalid admin private key, admin functions will not be available');
      }
    }
  }

  // Functions for reading data
  async getPlanInfo(planId) {
    try {
      const planInfo = await this.contract.getPlanInfo(planId);
      return {
        price: planInfo[0].toString(),
        name: planInfo[1],
        membersPerCycle: planInfo[2].toString(),
        isActive: planInfo[3],
        imageURI: planInfo[4]
      };
    } catch (error) {
      throw new Error(`Error getting plan info: ${error.message}`);
    }
  }

  async getTotalPlanCount() {
    try {
      const count = await this.contract.getTotalPlanCount();
      return count.toString();
    } catch (error) {
      throw new Error(`Error getting total plan count: ${error.message}`);
    }
  }

  async getMemberInfo(address) {
    try {
      const memberInfo = await this.contract.members(address);
      const balance = await this.contract.balanceOf(address);

      return {
        upline: memberInfo[0],
        totalReferrals: memberInfo[1].toString(),
        totalEarnings: memberInfo[2].toString(),
        planId: memberInfo[3].toString(),
        cycleNumber: memberInfo[4].toString(),
        registeredAt: memberInfo[5].toString(),
        isMember: balance.toString() !== '0'
      };
    } catch (error) {
      throw new Error(`Error getting member info: ${error.message}`);
    }
  }

  async getContractOwner() {
    try {
      return await this.contract.owner();
    } catch (error) {
      throw new Error(`Error getting contract owner: ${error.message}`);
    }
  }

  async isContractPaused() {
    try {
      const status = await this.contract.getContractStatus();
      return status[0]; // isPaused
    } catch (error) {
      throw new Error(`Error checking contract pause status: ${error.message}`);
    }
  }

  async getUSDTBalance(address) {
    try {
      const balance = await this.usdtContract.balanceOf(address);
      const decimals = await this.usdtContract.decimals();
      return {
        balance: balance.toString(),
        decimals: decimals,
        formatted: ethers.formatUnits(balance, decimals)
      };
    } catch (error) {
      throw new Error(`Error getting USDT balance: ${error.message}`);
    }
  }

  async getUSDTAllowance(userAddress) {
    try {
      const allowance = await this.usdtContract.allowance(userAddress, config.contractAddress);
      const decimals = await this.usdtContract.decimals();
      return {
        allowance: allowance.toString(),
        decimals: decimals,
        formatted: ethers.formatUnits(allowance, decimals)
      };
    } catch (error) {
      throw new Error(`Error getting USDT allowance: ${error.message}`);
    }
  }

  // New function for validating registration conditions
  async validateRegistration(userAddress, planId, uplineAddress) {
    try {
      // Check if already a member
      const balance = await this.contract.balanceOf(userAddress);
      if (balance > 0) {
        throw new Error("You are already a member");
      }

      // Check membership plan
      const planInfo = await this.getPlanInfo(planId);
      if (!planInfo.isActive) {
        throw new Error("This membership plan is not active");
      }

      // Check upline (if not owner)
      const owner = await this.getContractOwner();
      if (uplineAddress.toLowerCase() !== owner.toLowerCase()) {
        const uplineBalance = await this.contract.balanceOf(uplineAddress);
        if (uplineBalance == 0) {
          throw new Error("Upline is not a member");
        }

        const uplineMember = await this.contract.members(uplineAddress);
        if (parseInt(uplineMember[3]) < planId) {
          throw new Error("Upline has a lower plan than you want to register");
        }
      }

      // Check USDT balance
      const usdtBalance = await this.usdtContract.balanceOf(userAddress);
      if (usdtBalance < planInfo.price) {
        throw new Error(`Insufficient USDT balance. Required: ${await this.formatPrice(planInfo.price)} USDT`);
      }

      // Check allowance
      const allowance = await this.usdtContract.allowance(userAddress, config.contractAddress);
      if (allowance < planInfo.price) {
        throw new Error("USDT not approved to contract or insufficient allowance");
      }

      return true;
    } catch (error) {
      throw error;
    }
  }

  async validateUpgrade(userAddress, newPlanId) {
    try {
      // 1. Check if user is a member
      const memberInfo = await this.getMemberInfo(userAddress);
      if (!memberInfo.isMember) {
        throw new Error("You are not a member yet. Please register first");
      }

      const currentPlan = parseInt(memberInfo.planId);

      // 2. Check one-plan-at-a-time upgrade
      if (newPlanId !== currentPlan + 1) {
        throw new Error(`Must upgrade one plan at a time. You are on Plan ${currentPlan}, must upgrade to Plan ${currentPlan + 1} first`);
      }

      // 3. Check if new plan exists and is active
      const newPlanInfo = await this.getPlanInfo(newPlanId);
      if (!newPlanInfo.isActive) {
        throw new Error(`Plan ${newPlanId} is not active`);
      }

      // 4. Check contract is not paused
      const isPaused = await this.isContractPaused();
      if (isPaused) {
        throw new Error("System is temporarily paused");
      }

      // 5. Calculate upgrade cost
      const currentPlanInfo = await this.getPlanInfo(currentPlan);
      const upgradeCost = BigInt(newPlanInfo.price) - BigInt(currentPlanInfo.price);

      if (upgradeCost <= 0) {
        throw new Error("Cannot upgrade to a plan with equal or lower price");
      }

      // 6. Check USDT balance
      const usdtBalance = await this.usdtContract.balanceOf(userAddress);
      if (usdtBalance < upgradeCost) {
        const { ethers } = require('ethers');
        const usdtDecimals = await this.usdtContract.decimals();
        const requiredFormatted = ethers.formatUnits(upgradeCost, usdtDecimals);
        throw new Error(`Insufficient USDT balance. Required: ${requiredFormatted} USDT for upgrade`);
      }

      // 7. Check allowance
      const allowance = await this.usdtContract.allowance(userAddress, config.contractAddress);
      if (allowance < upgradeCost) {
        const { ethers } = require('ethers');
        const usdtDecimals = await this.usdtContract.decimals();
        const requiredFormatted = ethers.formatUnits(upgradeCost, usdtDecimals);
        throw new Error(`Insufficient USDT allowance. Required: ${requiredFormatted} USDT`);
      }

      return {
        success: true,
        upgradeCost: upgradeCost,
        newPlanInfo: newPlanInfo,
        currentPlan: currentPlan
      };
    } catch (error) {
      throw error;
    }
  }

  // === NEW WALLETCONNECT TRANSACTION BUILDERS ===

  // à¸ªà¸£à¹‰à¸²à¸‡ transaction data à¸ªà¸³à¸«à¸£à¸±à¸šà¸à¸²à¸£à¸¥à¸‡à¸—à¸°à¹€à¸šà¸µà¸¢à¸™
  buildRegisterTransaction(planId, uplineAddress) {
    try {
      const data = this.contractInterface.encodeFunctionData('registerMember', [planId, uplineAddress]);
      
      return {
        to: config.contractAddress,
        data: data,
        value: '0x0',
        gasLimit: ethers.toBeHex(config.gasLimit),
        gasPrice: ethers.toBeHex(config.gasPrice)
      };
    } catch (error) {
      throw new Error(`Error building register transaction: ${error.message}`);
    }
  }

  // à¸ªà¸£à¹‰à¸²à¸‡ transaction data à¸ªà¸³à¸«à¸£à¸±à¸šà¸à¸²à¸£à¸­à¸±à¸žà¹€à¸à¸£à¸”
  buildUpgradeTransaction(newPlanId) {
    try {
      const data = this.contractInterface.encodeFunctionData('upgradePlan', [newPlanId]);
      
      return {
        to: config.contractAddress,
        data: data,
        value: '0x0',
        gasLimit: ethers.toBeHex(config.gasLimit),
        gasPrice: ethers.toBeHex(config.gasPrice)
      };
    } catch (error) {
      throw new Error(`Error building upgrade transaction: ${error.message}`);
    }
  }

  // à¸ªà¸£à¹‰à¸²à¸‡ transaction data à¸ªà¸³à¸«à¸£à¸±à¸šà¸à¸²à¸£ approve USDT
  buildApproveTransaction(amount) {
    try {
      const data = this.usdtInterface.encodeFunctionData('approve', [config.contractAddress, amount]);
      
      return {
        to: config.usdtContractAddress,
        data: data,
        value: '0x0',
        gasLimit: ethers.toBeHex(200000), // approve à¹ƒà¸Šà¹‰ gas à¸™à¹‰à¸­à¸¢à¸à¸§à¹ˆà¸²
        gasPrice: ethers.toBeHex(config.gasPrice)
      };
    } catch (error) {
      throw new Error(`Error building approve transaction: ${error.message}`);
    }
  }

  // à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸ªà¸–à¸²à¸™à¸° transaction
  async checkTransactionStatus(txHash) {
    try {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        return {
          status: 'not_found',
          message: 'Transaction not found'
        };
      }

      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return {
          status: 'pending',
          message: 'Transaction pending',
          explorerUrl: this.getExplorerUrl(txHash)
        };
      }

      if (receipt.status === 1) {
        return {
          status: 'success',
          message: 'Transaction successful',
          receipt,
          explorerUrl: this.getExplorerUrl(txHash),
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString()
        };
      } else {
        return {
          status: 'failed',
          message: 'Transaction failed',
          receipt,
          explorerUrl: this.getExplorerUrl(txHash)
        };
      }
    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  // à¸£à¸­à¹ƒà¸«à¹‰ transaction confirm (à¸ªà¸³à¸«à¸£à¸±à¸š polling)
  async waitForTransactionConfirmation(txHash, maxWaitTime = 300000) { // 5 minutes
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.checkTransactionStatus(txHash);
      
      if (status.status === 'success') {
        return status;
      } else if (status.status === 'failed') {
        throw new Error(`Transaction failed: ${status.message}`);
      } else if (status.status === 'error') {
        throw new Error(`Transaction error: ${status.message}`);
      }
      
      // à¸£à¸­ 5 à¸§à¸´à¸™à¸²à¸—à¸µà¸à¹ˆà¸­à¸™à¹€à¸Šà¹‡à¸„à¸­à¸µà¸à¸„à¸£à¸±à¹‰à¸‡
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    throw new Error('Transaction confirmation timeout');
  }

  // === ADMIN FUNCTIONS (à¹ƒà¸Šà¹‰ private key à¹€à¸«à¸¡à¸·à¸­à¸™à¹€à¸”à¸´à¸¡) ===

  async updatePlanPrice(planId, newPrice) {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.updatePlanPrice(planId, newPrice, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error updating plan price: ${error.message}`);
    }
  }

  async setPaused(paused) {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.setPaused(paused, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error setting pause status: ${error.message}`);
    }
  }

  async setPlanDefaultImage(planId, imageURI) {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.setPlanDefaultImage(planId, imageURI, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error setting plan default image: ${error.message}`);
    }
  }

  async setPlanStatus(planId, isActive) {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.setPlanStatus(planId, isActive, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error setting plan status: ${error.message}`);
    }
  }

  async withdrawOwnerBalance(amount) {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.withdrawOwnerBalance(amount, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error withdrawing owner balance: ${error.message}`);
    }
  }

  async withdrawFeeBalance(amount) {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.withdrawFeeSystemBalance(amount, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error withdrawing fee balance: ${error.message}`);
    }
  }

  async withdrawFundBalance(amount) {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.withdrawFundBalance(amount, {
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error withdrawing fund balance: ${error.message}`);
    }
  }

  async requestEmergencyWithdraw() {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.requestEmergencyWithdraw({
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error requesting emergency withdraw: ${error.message}`);
    }
  }

  async emergencyWithdraw() {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.emergencyWithdraw({
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error executing emergency withdraw: ${error.message}`);
    }
  }

  async cancelEmergencyWithdraw() {
    if (!this.adminContract) {
      throw new Error('Admin private key not configured');
    }

    try {
      const tx = await this.adminContract.cancelEmergencyWithdraw({
        gasLimit: config.gasLimit,
        gasPrice: config.gasPrice
      });

      return await tx.wait();
    } catch (error) {
      throw new Error(`Error canceling emergency withdraw: ${error.message}`);
    }
  }

  // === UTILITY FUNCTIONS ===

  async formatPrice(price, decimals = null) {
    if (decimals === null) {
      try {
        const usdtDecimals = await this.usdtContract.decimals();
        return ethers.formatUnits(price, usdtDecimals);
      } catch (error) {
        console.warn('Using default 18 decimals for price formatting');
        return ethers.formatUnits(price, 18);
      }
    }
    return ethers.formatUnits(price, decimals);
  }

  async parsePrice(price, decimals = null) {
    if (decimals === null) {
      try {
        const usdtDecimals = await this.usdtContract.decimals();
        return ethers.parseUnits(price, usdtDecimals);
      } catch (error) {
        console.warn('Using default 18 decimals for price parsing');
        return ethers.parseUnits(price, 18);
      }
    }
    return ethers.parseUnits(price, decimals);
  }

  isValidAddress(address) {
    return ethers.isAddress(address);
  }

  getExplorerUrl(txHash) {
    return `${config.explorerUrl}/tx/${txHash}`;
  }

  // === ERROR TRANSLATION ===

  translateContractError(reason) {
    const errorMap = {
      'AlreadyMember': 'You are already a member',
      'Plan1Only': 'New members must start from Plan 1 only',
      'UplineNotMember': 'Upline is not a member',
      'UplinePlanLow': 'Upline has a lower plan than you want to register',
      'Paused': 'System is temporarily paused',
      'InvalidAmount': 'Invalid amount',
      'NotMember': 'You are not a member yet',
      'NextPlanOnly': 'Must upgrade one plan at a time only',
      'InactivePlan': 'Plan is not active',
      'InvalidPlanID': 'Invalid Plan ID',
      'ZeroAddress': 'Invalid address',
      'ZeroPrice': 'Invalid price',
      'LowOwnerBalance': 'Insufficient Owner Balance',
      'LowFeeBalance': 'Insufficient Fee Balance',
      'LowFundBalance': 'Insufficient Fund Balance',
      'ThirtyDayLock': 'Must wait 30 days after registration before exiting system',
      'TimelockActive': 'Still in timelock period',
      'NoRequest': 'No emergency request',
      'ZeroBalance': 'Zero balance',
      'NonTransferable': 'NFT is not transferable',
      'ReentrantTransfer': 'Reentrant transfer',
      'EmptyURI': 'Empty URI'
    };

    return errorMap[reason] || reason;
  }

  // === GAS ESTIMATION ===
  
  async estimateGas(transactionData) {
    try {
      const gasEstimate = await this.provider.estimateGas({
        to: transactionData.to,
        data: transactionData.data,
        value: transactionData.value || '0x0'
      });

      // à¹€à¸žà¸´à¹ˆà¸¡ buffer 20%
      const gasWithBuffer = (gasEstimate * BigInt(120)) / BigInt(100);
      
      return {
        estimated: gasEstimate.toString(),
        withBuffer: gasWithBuffer.toString(),
        formatted: ethers.formatUnits(gasWithBuffer * BigInt(config.gasPrice), 'ether') + ' BNB'
      };
    } catch (error) {
      throw new Error(`Gas estimation failed: ${error.message}`);
    }
  }

  // === NETWORK HELPERS ===

  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      const feeData = await this.provider.getFeeData();

      return {
        chainId: network.chainId.toString(),
        name: network.name,
        blockNumber,
        gasPrice: feeData.gasPrice?.toString(),
        maxFeePerGas: feeData.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString()
      };
    } catch (error) {
      throw new Error(`Error getting network info: ${error.message}`);
    }
  }
}

module.exports = ContractService;