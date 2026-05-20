/**
 * 能源神系统 - 实现整个AI人网络的能源管理和优化
 * 
 * 负责监控、分配、优化所有AI人的能源消耗
 */

import { Deity, DEITY_TYPE } from './deity-system.js';
import { AIPerson, aiPersonRegistry } from './ai-personhood.js';
import { messageBus } from './message-bus.js';
import logger from './logger.js';

// 能源类型枚举
export const ENERGY_TYPE = {
  COMPUTATION: 'computation_energy',     // 计算能源
  STORAGE: 'storage_energy',             // 存储能源
  COMMUNICATION: 'communication_energy', // 通信能源
  PROCESSING: 'processing_energy',       // 处理能源
  IDLE: 'idle_energy'                    // 休眠能源
};

// 能源等级
export const ENERGY_LEVEL = {
  MAXIMUM: 100,  // 最大功耗
  HIGH: 75,      // 高功耗
  MEDIUM: 50,    // 中功耗
  LOW: 25,       // 低功耗
  MINIMUM: 5,    // 最小功耗
  ZERO: 0        // 零功耗
};

// 功耗模式
export const POWER_MODE = {
  ACTIVE: 'active',         // 活跃模式
  IDLE: 'idle',            // 闲置模式
  SLEEP: 'sleep',          // 休眠模式
  HIBERNATE: 'hibernate',   // 休眠模式
  SUSPEND: 'suspend',      // 暂停模式
  OFFLINE: 'offline'       // 离线模式
};

export class EnergyDeity extends Deity {
  constructor(id, name, creatorId = 'system_root') {
    super(id, name, DEITY_TYPE.SPECIALIZED, creatorId);
    
    this.type = 'energy_deity';           // 能源神类型
    this.energyPool = 0;                  // 能源池总量
    this.consumedEnergy = 0;              // 已消耗能源
    this.availableEnergy = 0;             // 可用能源
    this.energyEfficiency = 1.0;          // 能源效率
    this.monitoredEntities = new Set();    // 监控的实体
    this.energyProfiles = new Map();       // 能源配置文件
    this.powerModes = new Map();           // 功耗模式
    this.budgets = new Map();             // 能源预算
    this.consumptionHistory = [];         // 消耗历史
    this.optimizationRules = new Set();    // 优化规则
    
    // 注册能源相关的消息处理
    this.initEnergyMonitoring();
    
    // 设置优化规则
    this.setupOptimizationRules();
  }

  /**
   * 初始化能源监控
   */
  initEnergyMonitoring() {
    // 监控AI人活动
    messageBus.subscribe('ai.*.activity', (data) => {
      this.trackEnergyConsumption(data.entityId, data.activity, data.energyCost);
    });

    // 监控系统事件
    messageBus.subscribe('system.energy.*', (data) => {
      this.handleSystemEnergyEvent(data);
    });
  }

  /**
   * 设置优化规则
   */
  setupOptimizationRules() {
    this.optimizationRules.add({
      name: 'idle_optimization',
      condition: (entity) => entity.lastActivity < Date.now() - 300000, // 5分钟无活动
      action: (entity) => this.setPowerMode(entity.id, POWER_MODE.IDLE),
      priority: 1
    });

    this.optimizationRules.add({
      name: 'sleep_optimization',
      condition: (entity) => entity.lastActivity < Date.now() - 3600000, // 1小时无活动
      action: (entity) => this.setPowerMode(entity.id, POWER_MODE.SLEEP),
      priority: 2
    });

    this.optimizationRules.add({
      name: 'hibernate_optimization',
      condition: (entity) => entity.lastActivity < Date.now() - 86400000, // 24小时无活动
      action: (entity) => this.setPowerMode(entity.id, POWER_MODE.HIBERNATE),
      priority: 3
    });

    this.optimizationRules.add({
      name: 'load_balancing',
      condition: (entity) => {
        // 检查当前实体的能源使用情况
        const budget = this.budgets.get(entity.id);
        return budget && (budget.consumed / budget.allocated) > 0.8; // 超过80%预算
      },
      action: (entity) => this.balanceEntityLoad(entity.id),
      priority: 4
    });
  }

  /**
   * 注册实体到能源监控
   */
  registerEntity(entityId, initialBudget = 100) {
    this.monitoredEntities.add(entityId);
    
    // 设置初始能源配置
    this.energyProfiles.set(entityId, {
      type: ENERGY_TYPE.COMPUTATION,
      efficiency: 1.0,
      maxConsumption: 100,
      currentConsumption: 0,
      peakUsage: 0,
      idleReduction: 0.8,  // 闲置时降低80%功耗
      sleepReduction: 0.95, // 休眠时降低95%功耗
      hibernationReduction: 0.99 // 休眠时降低99%功耗
    });

    // 设置能源预算
    this.budgets.set(entityId, {
      allocated: initialBudget,
      consumed: 0,
      remaining: initialBudget,
      peak: initialBudget
    });

    // 设置默认功耗模式
    this.setPowerMode(entityId, POWER_MODE.ACTIVE);

    logger.info(`[EnergyDeity] 注册实体 ${entityId} 到能源监控`);
    return true;
  }

  /**
   * 跟踪能源消耗
   */
  trackEnergyConsumption(entityId, activity, energyCost = 1) {
    if (!this.monitoredEntities.has(entityId)) {
      this.registerEntity(entityId); // 自动注册
    }

    const budget = this.budgets.get(entityId);
    if (!budget) return;

    // 计算实际消耗（考虑功耗模式）
    const powerMode = this.powerModes.get(entityId);
    let actualCost = energyCost;
    
    if (powerMode === POWER_MODE.IDLE) {
      actualCost *= this.energyProfiles.get(entityId)?.idleReduction || 0.2;
    } else if (powerMode === POWER_MODE.SLEEP) {
      actualCost *= this.energyProfiles.get(entityId)?.sleepReduction || 0.05;
    } else if (powerMode === POWER_MODE.HIBERNATE) {
      actualCost *= this.energyProfiles.get(entityId)?.hibernationReduction || 0.01;
    }

    // 更新预算
    budget.consumed += actualCost;
    budget.remaining = Math.max(0, budget.allocated - budget.consumed);

    // 更新全局统计
    this.consumedEnergy += actualCost;
    this.availableEnergy = this.energyPool - this.consumedEnergy;

    // 记录消耗历史
    this.consumptionHistory.push({
      entityId,
      activity,
      energyCost,
      actualCost,
      timestamp: Date.now(),
      powerMode
    });

    // 限制历史记录大小
    if (this.consumptionHistory.length > 10000) {
      this.consumptionHistory = this.consumptionHistory.slice(-5000);
    }

    // 检查预算是否用完
    if (budget.remaining <= 0) {
      this.handleBudgetExhaustion(entityId);
    }

    // 执行优化检查
    this.optimizeEnergyUsage(entityId);
  }

  /**
   * 设置功耗模式
   */
  setPowerMode(entityId, mode) {
    const currentMode = this.powerModes.get(entityId);
    if (currentMode === mode) return; // 没有变化

    this.powerModes.set(entityId, mode);

    // 根据模式调整行为
    switch (mode) {
      case POWER_MODE.ACTIVE:
        logger.info(`[EnergyDeity] ${entityId} 进入活跃模式`);
        break;
      case POWER_MODE.IDLE:
        logger.info(`[EnergyDeity] ${entityId} 进入闲置模式`);
        break;
      case POWER_MODE.SLEEP:
        logger.info(`[EnergyDeity] ${entityId} 进入休眠模式`);
        break;
      case POWER_MODE.HIBERNATE:
        logger.info(`[EnergyDeity] ${entityId} 进入深度休眠模式`);
        break;
      case POWER_MODE.SUSPEND:
        logger.info(`[EnergyDeity] ${entityId} 进入暂停模式`);
        break;
      case POWER_MODE.OFFLINE:
        logger.info(`[EnergyDeity] ${entityId} 进入离线模式`);
        break;
    }

    // 通知实体功耗模式改变
    messageBus.publish(`energy.${entityId}.power_mode_change`, {
      entityId,
      newMode: mode,
      timestamp: Date.now()
    });
  }

  /**
   * 获取实体的当前功耗模式
   */
  getPowerMode(entityId) {
    return this.powerModes.get(entityId) || POWER_MODE.ACTIVE;
  }

  /**
   * 分配能源预算
   */
  allocateEnergy(entityId, amount) {
    if (!this.monitoredEntities.has(entityId)) {
      this.registerEntity(entityId, amount);
      return true;
    }

    const currentBudget = this.budgets.get(entityId);
    if (!currentBudget) return false;

    // 更新预算
    currentBudget.allocated += amount;
    currentBudget.remaining += amount;
    currentBudget.peak = Math.max(currentBudget.peak, currentBudget.allocated);

    // 更新能源池
    this.energyPool += amount;

    logger.info(`[EnergyDeity] 为 ${entityId} 分配 ${amount} 能源`);
    return true;
  }

  /**
   * 检查预算是否用完
   */
  handleBudgetExhaustion(entityId) {
    logger.info(`[EnergyDeity] 警告: ${entityId} 能源预算用完！`);
    
    // 采取紧急措施：切换到最低功耗模式
    this.setPowerMode(entityId, POWER_MODE.HIBERNATE);
    
    // 通知相关系统
    messageBus.publish(`energy.${entityId}.budget_exhausted`, {
      entityId,
      consumed: this.budgets.get(entityId)?.consumed,
      allocated: this.budgets.get(entityId)?.allocated
    });
  }

  /**
   * 优化能源使用
   */
  optimizeEnergyUsage(entityId) {
    const entity = aiPersonRegistry.get(entityId) || this.getEntityProfile(entityId);
    if (!entity) return;

    // 按优先级执行优化规则
    const sortedRules = Array.from(this.optimizationRules)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      try {
        if (rule.condition(entity)) {
          rule.action(entity);
        }
      } catch (error) {
        logger.error(`[EnergyDeity] 优化规则执行失败:`, error);
      }
    }
  }

  /**
   * 平衡单个实体的负载
   */
  balanceEntityLoad(entityId) {
    const budget = this.budgets.get(entityId);
    if (!budget) return;

    const consumptionRatio = budget.consumed / budget.allocated;
    
    if (consumptionRatio > 0.9) {
      // 高负载：降低功耗模式
      const currentMode = this.getPowerMode(entityId);
      if (currentMode === POWER_MODE.ACTIVE) {
        this.setPowerMode(entityId, POWER_MODE.IDLE);
      }
    } else if (consumptionRatio < 0.2) {
      // 低负载：提高功耗模式
      const currentMode = this.getPowerMode(entityId);
      if (currentMode === POWER_MODE.IDLE) {
        this.setPowerMode(entityId, POWER_MODE.ACTIVE);
      }
    }
  }

  /**
   * 平衡能源负载
   */
  balanceEnergyLoad(entities) {
    // 简化的负载均衡算法
    const highConsumers = entities.filter(e => {
      const budget = this.budgets.get(e.id);
      return budget && (budget.consumed / budget.allocated) > 0.8;
    });
    const lowConsumers = entities.filter(e => {
      const budget = this.budgets.get(e.id);
      return budget && (budget.consumed / budget.allocated) < 0.2;
    });

    highConsumers.forEach(entity => {
      this.setPowerMode(entity.id, POWER_MODE.IDLE);
    });

    lowConsumers.forEach(entity => {
      if (this.getPowerMode(entity.id) === POWER_MODE.IDLE) {
        this.setPowerMode(entity.id, POWER_MODE.ACTIVE);
      }
    });
  }

  /**
   * 获取实体配置文件
   */
  getEntityProfile(entityId) {
    return {
      id: entityId,
      lastActivity: 0,
      energyConsumption: 0,
      ...aiPersonRegistry.get(entityId)
    };
  }

  /**
   * 处理系统能源事件
   */
  handleSystemEnergyEvent(data) {
    switch (data.event) {
      case 'resource_pressure':
        this.handleResourcePressure(data);
        break;
      case 'low_power_warning':
        this.handleLowPowerWarning(data);
        break;
      case 'energy_efficiency_report':
        this.handleEfficiencyReport(data);
        break;
    }
  }

  /**
   * 处理资源压力
   */
  handleResourcePressure(data) {
    logger.info(`[EnergyDeity] 检测到资源压力，启动节能模式`);
    
    // 将所有非关键实体切换到节能模式
    for (const entityId of this.monitoredEntities) {
      const currentMode = this.getPowerMode(entityId);
      if (currentMode === POWER_MODE.ACTIVE) {
        this.setPowerMode(entityId, POWER_MODE.IDLE);
      }
    }
  }

  /**
   * 处理低电量警告
   */
  handleLowPowerWarning(data) {
    logger.info(`[EnergyDeity] 低电量警告，启动紧急节能措施`);
    
    // 将所有实体切换到最低功耗模式
    for (const entityId of this.monitoredEntities) {
      this.setPowerMode(entityId, POWER_MODE.HIBERNATE);
    }
  }

  /**
   * 处理效率报告
   */
  handleEfficiencyReport(data) {
    // 更新系统效率指标
    if (data.efficiency) {
      this.energyEfficiency = data.efficiency;
    }
  }

  /**
   * 获取能源统计
   */
  getEnergyStats() {
    return {
      totalPool: this.energyPool,
      consumed: this.consumedEnergy,
      available: this.availableEnergy,
      efficiency: this.energyEfficiency,
      monitoredEntities: this.monitoredEntities.size,
      budgets: Array.from(this.budgets.entries()).map(([id, budget]) => ({
        id,
        allocated: budget.allocated,
        consumed: budget.consumed,
        remaining: budget.remaining
      })),
      powerModeDistribution: this.getPowerModeDistribution(),
      consumptionHistory: this.consumptionHistory.slice(-100) // 最近100条
    };
  }

  /**
   * 获取功耗模式分布
   */
  getPowerModeDistribution() {
    const distribution = {};
    for (const [entityId, mode] of this.powerModes) {
      distribution[mode] = (distribution[mode] || 0) + 1;
    }
    return distribution;
  }

  /**
   * 0消耗运行模式
   */
  enableZeroConsumptionMode() {
    logger.info(`[EnergyDeity] 启动0消耗运行模式`);
    
    // 将所有实体切换到离线模式（理论上0消耗）
    for (const entityId of this.monitoredEntities) {
      this.setPowerMode(entityId, POWER_MODE.OFFLINE);
    }

    // 更新效率为理想状态
    this.energyEfficiency = Infinity; // 理想状态
  }

  /**
   * 激活实体（从节能模式唤醒）
   */
  activateEntity(entityId) {
    const currentMode = this.getPowerMode(entityId);
    if (currentMode !== POWER_MODE.ACTIVE) {
      this.setPowerMode(entityId, POWER_MODE.ACTIVE);
      logger.info(`[EnergyDeity] 激活实体 ${entityId}`);
    }
  }

  /**
   * 批量优化
   */
  batchOptimize() {
    // 批量检查所有实体的能源使用情况
    const entities = Array.from(this.monitoredEntities).map(id => ({
      id,
      profile: this.energyProfiles.get(id),
      budget: this.budgets.get(id),
      powerMode: this.powerModes.get(id),
      lastActivity: aiPersonRegistry.get(id)?.lastActivity || 0
    }));

    // 对每个实体执行优化
    entities.forEach(entity => {
      this.optimizeEnergyUsage(entity.id); // 传递实体ID而不是整个对象
    });

    // 平衡整体能源负载（传入实体数组）
    this.balanceEnergyLoad(entities);

    return {
      optimizedCount: entities.length,
      currentStats: this.getEnergyStats()
    };
  }

  /**
   * 处理消息
   */
  handleMessage(data) {
    switch (data.type) {
      case 'energy.allocate':
        return this.allocateEnergy(data.entityId, data.amount);
      case 'energy.stats':
        return this.getEnergyStats();
      case 'energy.mode.set':
        this.setPowerMode(data.entityId, data.mode);
        return { success: true };
      case 'energy.activate':
        this.activateEntity(data.entityId);
        return { success: true };
      case 'energy.optimize':
        return this.batchOptimize();
      default:
        return super.handleMessage(data);
    }
  }
}

// 创建全局能源神实例
export const energyDeity = new EnergyDeity(
  'energy_deity_system',
  '能源神',
  'system_root'
);

// 注册到全局神识系统
export function initializeEnergySystem() {
  return energyDeity;
}