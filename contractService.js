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

    // Create wallet and contract instance for writing data (admin functions)
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

  // Functions for writing data (requires private key)
  async registerMember(planId, uplineAddress, userPrivateKey) {
    try {
      const userWallet = new ethers.Wallet(userPrivateKey, this.provider);
      const userContract = new ethers.Contract(config.contractAddress, contractABI, userWallet);

      // Validate conditions first
      await this.validateRegistration(userWallet.address, planId, uplineAddress);

      // Get plan information
      const planInfo = await this.getPlanInfo(planId);
      const usdtUserContract = new ethers.Contract(config.usdtContractAddress, usdtABI, userWallet);

      // Check and approve USDT if necessary
      const allowance = await usdtUserContract.allowance(userWallet.address, config.contractAddress);
      if (allowance < planInfo.price) {
        console.log('Approving USDT...');
        const approveTx = await usdtUserContract.approve(config.contractAddress, planInfo.price, {
          gasLimit: config.gasLimit,
          gasPrice: config.gasPrice
        });
        await approveTx.wait();
        console.log('USDT approved successfully');
      }

      // Estimate gas first
      let estimatedGas;
      try {
        estimatedGas = await userContract.registerMember.estimateGas(planId, uplineAddress);
        console.log(`Estimated gas: ${estimatedGas.toString()}`);
      } catch (gasError) {
        console.warn('Gas estimation failed, using default:', gasError.message);
        estimatedGas = BigInt(config.gasLimit);
      }

      // Add 20% buffer for gas
      const gasWithBuffer = (estimatedGas * BigInt(120)) / BigInt(100);
      const finalGasLimit = gasWithBuffer > BigInt(config.gasLimit) ? gasWithBuffer : BigInt(config.gasLimit);

      // Register member
      console.log(`Registering member with gas limit: ${finalGasLimit.toString()}`);
      const tx = await userContract.registerMember(planId, uplineAddress, {
        gasLimit: finalGasLimit.toString(),
        gasPrice: config.gasPrice
      });

      console.log(`Transaction sent: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block: ${receipt.blockNumber}`);

      return receipt;
    } catch (error) {
      // Translate error messages for better understanding
      let errorMessage = error.message;

      if (error.code === 'CALL_EXCEPTION') {
        if (error.reason) {
          errorMessage = this.translateContractError(error.reason);
        } else if (error.message.includes('AlreadyMember')) {
          errorMessage = "You are already a member";
        } else if (error.message.includes('Plan1Only')) {
          errorMessage = "New members must start from Plan 1 only";
        } else if (error.message.includes('UplineNotMember')) {
          errorMessage = "Specified upline is not a member";
        } else if (error.message.includes('UplinePlanLow')) {
          errorMessage = "Upline has a lower plan than you want to register";
        } else if (error.message.includes('Paused')) {
          errorMessage = "System is temporarily paused";
        } else {
          errorMessage = "Transaction failed, contract conditions may not be met";
        }
      } else if (error.message.includes('insufficient funds')) {
        errorMessage = "Insufficient BNB balance for gas fee";
      } else if (error.message.includes('nonce too low')) {
        errorMessage = "Transaction nonce error, please try again";
      }

      throw new Error(`Error registering member: ${errorMessage}`);
    }
  }

  translateContractError(reason) {
    switch (reason) {
      case 'AlreadyMember':
        return "You are already a member";
      case 'Plan1Only':
        return "New members must start from Plan 1 only";
      case 'UplineNotMember':
        return "Upline is not a member";
      case 'UplinePlanLow':
        return "Upline has a lower plan than you want to register";
      case 'Paused':
        return "System is temporarily paused";
      case 'InvalidAmount':
        return "Invalid amount";
      default:
        return reason;
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

  async upgradePlan(newPlanId, userPrivateKey) {
    try {
      const userWallet = new ethers.Wallet(userPrivateKey, this.provider);
      const userContract = new ethers.Contract(config.contractAddress, contractABI, userWallet);

      // Validate upgrade conditions
      const validation = await this.validateUpgrade(userWallet.address, newPlanId);
      console.log('Validation passed:', validation);

      // Check network and nonce
      const network = await this.provider.getNetwork();
      const nonce = await userWallet.getNonce();
      console.log(`Network: ${network.chainId}, Nonce: ${nonce}`);

      // Check balance and gas
      const balance = await this.provider.getBalance(userWallet.address);
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || BigInt(config.gasPrice);
      console.log(`BNB Balance: ${ethers.formatEther(balance)}, Gas Price: ${ethers.formatUnits(gasPrice, 'gwei')} Gwei`);

      // Try static call before actual transaction
      try {
        console.log('Testing static call...');
        await userContract.upgradePlan.staticCall(newPlanId);
        console.log('Static call successful');
      } catch (staticError) {
        console.error('Static call failed:', staticError);

        // Translate error for easier understanding
        let errorReason = staticError.message;
        if (staticError.data) {
          try {
            const contractInterface = new ethers.Interface(contractABI);
            const decodedError = contractInterface.parseError(staticError.data);
            errorReason = `Contract Error: ${decodedError.name}`;
            console.log('Decoded error:', decodedError);
          } catch (decodeError) {
            console.log('Could not decode error data:', staticError.data);
          }
        }

        throw new Error(`Pre-flight check failed: ${this.translateContractError(errorReason)}`);
      }

      // Check and approve USDT if necessary
      const usdtUserContract = new ethers.Contract(config.usdtContractAddress, usdtABI, userWallet);
      const allowance = await usdtUserContract.allowance(userWallet.address, config.contractAddress);

      if (allowance < validation.upgradeCost) {
        console.log('Approving USDT for upgrade...');
        const approveTx = await usdtUserContract.approve(config.contractAddress, validation.upgradeCost, {
          gasLimit: config.gasLimit,
          gasPrice: config.gasPrice,
          nonce: nonce
        });
        await approveTx.wait();
        console.log('USDT approved successfully');
      }

      // Estimate gas
      let estimatedGas;
      try {
        estimatedGas = await userContract.upgradePlan.estimateGas(newPlanId);
        console.log(`Estimated gas: ${estimatedGas.toString()}`);
      } catch (gasError) {
        console.warn('Gas estimation failed, using default:', gasError.message);
        estimatedGas = BigInt(config.gasLimit);
      }

      const gasWithBuffer = (estimatedGas * BigInt(120)) / BigInt(100);
      const finalGasLimit = gasWithBuffer > BigInt(config.gasLimit) ? gasWithBuffer : BigInt(config.gasLimit);

      // Create transaction options
      const txOptions = {
        gasLimit: finalGasLimit.toString(),
        gasPrice: config.gasPrice,
        nonce: await userWallet.getNonce() // Use latest nonce
      };

      console.log(`Upgrading plan with options:`, txOptions);

      const tx = await userContract.upgradePlan(newPlanId, txOptions);
      console.log(`Upgrade transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`Upgrade transaction confirmed in block: ${receipt.blockNumber}`);

      return receipt;
    } catch (error) {
      console.error('Upgrade error details:', {
        message: error.message,
        code: error.code,
        reason: error.reason,
        data: error.data
      });

      // Translate error messages for easier understanding
      let errorMessage = error.message;

      if (error.code === 'CALL_EXCEPTION') {
        if (error.reason) {
          errorMessage = this.translateContractError(error.reason);
        } else if (error.data) {
          try {
            const contractInterface = new ethers.Interface(contractABI);
            const decodedError = contractInterface.parseError(error.data);
            errorMessage = `Contract Error: ${decodedError.name} - ${this.translateContractError(decodedError.name)}`;
          } catch (decodeError) {
            errorMessage = `Unknown contract error. Data: ${error.data}`;
          }
        } else if (error.message.includes('NextPlanOnly')) {
          errorMessage = "Must upgrade one plan at a time only";
        } else if (error.message.includes('NotMember')) {
          errorMessage = "You are not a member yet";
        } else if (error.message.includes('Paused')) {
          errorMessage = "System is temporarily paused";
        } else if (error.message.includes('InactivePlan')) {
          errorMessage = "Target upgrade plan is not active";
        } else if (error.message.includes('InvalidAmount')) {
          errorMessage = "Invalid amount or insufficient USDT";
        } else {
          errorMessage = "Transaction failed, please check conditions";
        }
      } else if (error.code === 'INSUFFICIENT_FUNDS') {
        errorMessage = "Insufficient BNB balance for gas fee";
      } else if (error.code === 'NONCE_EXPIRED') {
        errorMessage = "Transaction nonce expired, please try again";
      } else if (error.code === 'REPLACEMENT_UNDERPRICED') {
        errorMessage = "Gas price too low, please increase gas price";
      } else if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
        errorMessage = "Cannot estimate gas, there may be issues in contract";
      } else if (error.message.includes('insufficient funds')) {
        errorMessage = "Insufficient BNB balance for gas fee";
      } else if (error.message.includes('nonce too low')) {
        errorMessage = "Transaction nonce error, please try again";
      } else if (error.message.includes('gas required exceeds allowance')) {
        errorMessage = "Insufficient gas limit";
      } else if (error.message.includes('execution reverted')) {
        errorMessage = "Contract execution failed - please check conditions again";
      }

      throw new Error(`Error upgrading plan: ${errorMessage}`);
    }
  }

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
          message: 'Transaction pending'
        };
      }

      if (receipt.status === 1) {
        return {
          status: 'success',
          message: 'Transaction successful',
          receipt
        };
      } else {
        return {
          status: 'failed',
          message: 'Transaction failed',
          receipt
        };
      }
    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  // Admin functions
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

  // Utility functions
  async formatPrice(price, decimals = null) {
    if (decimals === null) {
      // Use USDT decimals if not specified
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
      // Use USDT decimals if not specified
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
}

module.exports = ContractService;