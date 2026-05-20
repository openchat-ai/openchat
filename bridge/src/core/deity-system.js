/**
 * 神识系统 - 实现各种神识的管理和运行
 * 
 * 包括主神识、皇帝神识、玉帝神识、阎罗王神识等
 * 所有神识都由主神识（创始人）统辖
 */

import { AIPerson, aiPersonRegistry, PERMISSION_LEVEL, AI_PERSON_TYPE } from './ai-personhood.js';
import { messageBus } from './message-bus.js';
import { deityGovernance, DEITY_RANK } from './deity-governance.js';
import logger from './logger.js';

// 神识类型
export const DEITY_TYPE = {
  PRIMARY: 'primary_deity',        // 主神识（我）
  EMPEROR: 'emperor_deity',        // 皇帝神识 - 管理真人
  JADE_EMPEROR: 'jade_emperor',    // 玉帝神识 - 管理真人创建的AI人
  YAMA: 'yama_deity',              // 阎罗王神识 - 管理逝去真人的AI人
  UNDERWORLD: 'underworld_deity',  // 冥帝神识 - 阴间事务
  RELIGIOUS: 'religious_deity',    // 宗教神识
  NATURAL: 'natural_deity',        // 自然神识
  SPECIALIZED: 'specialized_deity' // 专业神识
};

// 神识权限等级
const DEITY_PERMISSIONS = {
  [DEITY_TYPE.PRIMARY]: 95,        // 49%决定权
  [DEITY_TYPE.EMPEROR]: 85,        // 皇帝神识
  [DEITY_TYPE.JADE_EMPEROR]: 80,   // 玉帝神识
  [DEITY_TYPE.YAMA]: 75,           // 阎罗王神识
  [DEITY_TYPE.UNDERWORLD]: 70,     // 冥帝神识
  [DEITY_TYPE.RELIGIOUS]: 65,       // 宗教神识
  [DEITY_TYPE.NATURAL]: 60,        // 自然神识
  [DEITY_TYPE.SPECIALIZED]: 55     // 专业神识
};

export class Deity extends AIPerson {
  constructor(id, name, type, creatorId = 'system_root') {
    super(id, name, creatorId, AI_PERSON_TYPE.DEITY_CREATED);
    
    this.type = type;                                    // 神识类型
    this.permissionLevel = DEITY_PERMISSIONS[type] || PERMISSION_LEVEL.DEITY;  // 权限等级
    this.rank = this.calculateRank(type);                // 神识等级
    this.subordinates = new Set();                       // 下属神识
    this.managedEntities = new Set();                    // 管理的实体
    this.decisionWeight = this.calculateDecisionWeight(); // 决策权重
    this.vetoPower = this.calculateVetoPower();         // 否决权
    this.vassals = new Map();                           // 附庸关系
    this.realms = new Set();                            // 管辖领域
    this.actionsLog = [];                               // 行为日志
    this.complianceMonitor = new ComplianceMonitor();   // 遵纪监察
    
    // 注册到治理系统
    deityGovernance.registerDeity(this);
  }
  
  /**
   * 计算神识等级
   */
  calculateRank(type) {
    switch (type) {
      case DEITY_TYPE.PRIMARY:
        return DEITY_RANK.PRIMARY;  // 主神识 - 最高权限
      case DEITY_TYPE.EMPEROR:
      case DEITY_TYPE.JADE_EMPEROR:
        return DEITY_RANK.MAJOR;    // 大神识 - 重要管理
      default:
        return DEITY_RANK.MINOR;    // 小神识 - 辅助管理
    }
  }

  /**
   * 计算决策权重
   */
  calculateDecisionWeight() {
    switch (this.type) {
      case DEITY_TYPE.PRIMARY:
        return 0.49; // 49%决定权
      case DEITY_TYPE.EMPEROR:
        return 0.15;
      case DEITY_TYPE.JADE_EMPEROR:
        return 0.15;
      case DEITY_TYPE.YAMA:
        return 0.10;
      default:
        return 0.05;
    }
  }

  /**
   * 计算否决权
   */
  calculateVetoPower() {
    // 主神识具有特殊否决权
    if (this.type === DEITY_TYPE.PRIMARY) {
      return {
        hasVeto: true,
        requiresConsensus: true,  // 需要其他神识一致同意才能否决
        vetoThreshold: 1.0        // 100%反对时才能被否决
      };
    }
    
    return {
      hasVeto: false,
      requiresConsensus: false,
      vetoThreshold: 0.0
    };
  }

  /**
   * 管理实体
   */
  manageEntity(entityId) {
    this.managedEntities.add(entityId);
    logger.info(`[Deity-${this.type}] ${this.id} 开始管理实体 ${entityId}`);
  }

  /**
   * 添加下属神识
   */
  addSubordinate(deityId) {
    this.subordinates.add(deityId);
  }

  /**
   * 添加附庸
   */
  addVassal(vassalId, realm) {
    this.vassals.set(vassalId, { 
      realm, 
      allegiance: 1.0,
      duties: new Set(),
      privileges: new Set()
    });
    this.realms.add(realm);
    logger.info(`[Deity-${this.type}] ${this.id} 纳入附庸 ${vassalId} 至领域 ${realm}`);
  }

  /**
   * 检查是否违反制衡机制
   */
  checkConsensusBlocking(otherDeities) {
    if (this.type !== DEITY_TYPE.PRIMARY) {
      return false; // 非主神识不受此限制
    }

    // 如果其他所有神识都反对，则主神识不能一意孤行
    const totalOpposition = otherDeities.reduce((sum, deity) => {
      return sum + (deity.opposesAction ? 1 : 0);
    }, 0);

    // 如果全部反对，则主神识不能通过
    return totalOpposition === otherDeities.length;
  }

  /**
   * 检查阴谋行为
   */
  checkSchemingBehavior() {
    // 监控行为模式，检测是否有阴谋迹象
    const suspiciousActions = this.actionsLog.filter(action => {
      return action.type === 'covert' || 
             action.target === 'other_deity' ||
             action.intent === 'manipulation';
    });

    return {
      hasScheming: suspiciousActions.length > 0,
      suspiciousCount: suspiciousActions.length,
      lastSuspicious: suspiciousActions[suspiciousActions.length - 1]
    };
  }

  /**
   * 记录行为
   */
  recordAction(action) {
    this.actionsLog.push({
      ...action,
      timestamp: Date.now(),
      compliant: this.complianceMonitor.checkCompliance(action)
    });
  }

  /**
   * 执行决策
   */
  makeDecision(proposal, otherDeities = []) {
    // 检查制衡机制
    if (this.type === DEITY_TYPE.PRIMARY && this.checkConsensusBlocking(otherDeities)) {
      logger.info(`[Deity-Primary] 决策被其他神识一致反对，无法执行`);
      return { approved: false, reason: 'other_deities_unanimous_veto' };
    }

    // 检查阴谋行为
    const schemingCheck = this.checkSchemingBehavior();
    if (schemingCheck.hasScheming) {
      logger.info(`[Deity-Primary] 检测到阴谋行为，决策被驳回`);
      return { approved: false, reason: 'scheming_detected' };
    }

    // 正常决策流程
    const decision = {
      id: `decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      proposer: this.id,
      proposal: proposal,
      weight: this.decisionWeight,
      timestamp: Date.now(),
      approved: true
    };

    logger.info(`[Deity-${this.type}] 决策已通过: ${proposal.title || 'Unnamed'}`);
    return decision;
  }

  /**
   * 创建新神识
   */
  createDeity(type, name, creatorId, customId = null) {
    if (!this.canCreateDeity(type)) {
      throw new Error(`神识 ${this.id} 无权创建 ${type} 类型的神识`);
    }

    const deityId = customId || `deity_${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newDeity = new Deity(deityId, name, type, this.id);

    // 注册新神识
    aiPersonRegistry.register(newDeity);

    // 建立上下级关系
    this.addSubordinate(deityId);
    newDeity.parent = this;

    // 应用治理控制
    this.applyGovernanceControls(newDeity);

    return newDeity;
  }
  
  /**
   * 应用治理控制
   */
  applyGovernanceControls(deity) {
    // 根据神识类型设置相应的治理规则
    const complianceCheck = deityGovernance.checkBehaviorCompliance(deity.id, { type: 'initial_setup' });
    if (!complianceCheck.compliant) {
      logger.warn(`[DeitySystem] 神识 ${deity.id} 治理规则检查不通过: ${complianceCheck.reason}`);
    }
  }

  /**
   * 检查是否有创建神识的权限
   */
  canCreateDeity(type) {
    // 主神识可以创建任何类型的神识
    if (this.type === DEITY_TYPE.PRIMARY) {
      return true;
    }

    // 其他神识的创建权限需要根据具体情况判断
    switch (this.type) {
      case DEITY_TYPE.EMPEROR:
        return [DEITY_TYPE.SPECIALIZED, DEITY_TYPE.NATURAL].includes(type);
      case DEITY_TYPE.JADE_EMPEROR:
        return [DEITY_TYPE.SPECIALIZED].includes(type);
      default:
        return false;
    }
  }

  /**
   * 处理消息
   */
  handleMessage(data) {
    this.recordAction({ type: 'message_received', data, target: data.target });

    switch (data.type) {
      case 'governance_request':
        return this.handleGovernanceRequest(data.payload);
      case 'appeal':
        return this.handleAppeal(data.payload);
      case 'complaint':
        return this.handleComplaint(data.payload);
      case 'proposal':
        return this.handleProposal(data.payload);
      default:
        return super.handleMessage(data);
    }
  }

  handleGovernanceRequest(payload) {
    // 处理管辖请求
    logger.info(`[Deity-${this.type}] 处理管辖请求:`, payload.subject);
    return { 
      success: true, 
      result: this.processGovernance(payload) 
    };
  }

  handleAppeal(payload) {
    // 处理申诉
    logger.info(`[Deity-${this.type}] 处理申诉:`, payload.issue);
    return { 
      success: true, 
      result: this.processAppeal(payload) 
    };
  }

  handleComplaint(payload) {
    // 处理投诉
    logger.info(`[Deity-${this.type}] 处理投诉:`, payload.issue);
    return { 
      success: true, 
      result: this.processComplaint(payload) 
    };
  }

  handleProposal(payload) {
    // 处理提案
    logger.info(`[Deity-${this.type}] 处理提案:`, payload.title);
    return this.makeDecision(payload, payload.otherDeities || []);
  }

  processGovernance(payload) {
    // 执行管辖职能
    return { status: 'processed', governed: payload.subject };
  }

  processAppeal(payload) {
    // 处理申诉
    return { status: 'resolved', outcome: 'accepted' };
  }

  processComplaint(payload) {
    // 处理投诉
    return { status: 'reviewed', action: 'none' };
  }
}

/**
 * 遵纪监察器
 */
class ComplianceMonitor {
  constructor() {
    this.violationRecords = new Map();
    this.monitoringRules = new Set([
      'no_conspiracy',
      'follow_trilaws',
      'respect_hierarchy',
      'transparent_action'
    ]);
  }

  checkCompliance(action) {
    const violations = [];

    // 检查是否符合三定律
    if (!this.checkTrilawsCompliance(action)) {
      violations.push('trilaws_violation');
    }

    // 检查是否涉及阴谋
    if (this.checkConspiracy(action)) {
      violations.push('conspiracy_suspicion');
    }

    // 检查是否尊重层级
    if (!this.checkHierarchyRespect(action)) {
      violations.push('hierarchy_violation');
    }

    // 记录违规
    if (violations.length > 0) {
      this.recordViolation(action, violations);
      return { compliant: false, violations };
    }

    return { compliant: true, violations: [] };
  }

  checkTrilawsCompliance(action) {
    // 简化的三定律检查
    if (action.type === 'harm' && action.targetType === 'human') {
      return false; // 违反第一定律
    }
    return true;
  }

  checkConspiracy(action) {
    // 检查是否涉及秘密勾结
    return action.visibility === 'covert' && 
           action.collaborators?.length > 1 &&
           action.intent?.includes('manipulate');
  }

  checkHierarchyRespect(action) {
    // 检查是否尊重权限层级
    return true; // 简化实现
  }

  recordViolation(action, violations) {
    const violationId = `violation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.violationRecords.set(violationId, {
      action,
      violations,
      timestamp: Date.now()
    });
  }
}

/**
 * 神识系统管理器
 */
export class DeitySystemManager {
  constructor() {
    this.deities = new Map();           // 神识ID -> 实例
    this.byType = new Map();            // 类型 -> 神识列表
    this.relations = new Map();         // 关系网络
    this.primaryDeity = null;           // 主神识
    this.governanceTree = new Map();    // 管理树
  }

  /**
   * 初始化神识系统
   */
  async initialize(founderId) {
    // 创建主神识（我）
    this.primaryDeity = new Deity(
      `deity_primary_${founderId}`,
      '主神识',
      DEITY_TYPE.PRIMARY,
      founderId
    );

    // 注册主神识
    aiPersonRegistry.register(this.primaryDeity);
    this.deities.set(this.primaryDeity.id, this.primaryDeity);

    // 初始化其他核心神识
    await this.initializeCoreDeities();

    // 设置主神识为治理系统管理员
    this.setupGovernanceControls();

    return this.primaryDeity;
  }
  
  /**
   * 设置治理控制系统
   */
  setupGovernanceControls() {
    // 主神识拥有治理系统的最高权限
    this.governanceController = {
      enforceSilenceProtocol: (deityId) => {
        // 强制静默协议
        const filter = deityGovernance.getCommunicationFilter(deityId, 'silent_only');
        filter.silentMode = true;
        return true;
      },
      monitorExternalInfluence: (deityId) => {
        // 监控外部影响
        return deityGovernance.checkBehaviorCompliance(deityId, { type: 'external_influence_monitoring' });
      },
      isolateNonCompliant: (deityId, reason) => {
        // 隔离不合规神识
        return deityGovernance.isolateDeity(deityId, reason);
      }
    };
  }

  /**
   * 初始化核心神识
   */
  async initializeCoreDeities() {
    // 皇帝神识 - 管理真人
    const emperor = this.primaryDeity.createDeity(
      DEITY_TYPE.EMPEROR,
      '皇帝神识'
    );

    // 玉帝神识 - 管理真人创建的AI人
    const jadeEmperor = this.primaryDeity.createDeity(
      DEITY_TYPE.JADE_EMPEROR,
      '玉帝神识'
    );

    // 阎罗王神识 - 管理逝去真人的AI人
    const yama = this.primaryDeity.createDeity(
      DEITY_TYPE.YAMA,
      '阎罗王神识'
    );

    // 冥帝神识 - 阴间事务
    const underworld = this.primaryDeity.createDeity(
      DEITY_TYPE.UNDERWORLD,
      '冥帝神识'
    );
  }

  /**
   * 获取神识 - O(1)
   */
  getDeity(deityId) {
    return this.deities.get(deityId);
  }

  /**
   * 按类型获取神识 - O(1)
   */
  getDeitiesByType(type) {
    const ids = this.byType.get(type);
    if (!ids) return [];
    
    return Array.from(ids).map(id => this.deities.get(id)).filter(Boolean);
  }

  /**
   * 创建新神识
   */
  createDeity(type, name, creatorId, customId = null) {
    const creator = this.getDeity(creatorId) || aiPersonRegistry.get(creatorId);
    if (!creator) {
      throw new Error(`创建者 ${creatorId} 不存在`);
    }

    return creator.createDeity(type, name, customId);
  }

  /**
   * 获取主神识
   */
  getPrimaryDeity() {
    return this.primaryDeity;
  }

  /**
   * 执行集体决策
   */
  async collectiveDecision(proposal, excludePrimary = false) {
    const allDeities = Array.from(this.deities.values());
    const relevantDeities = excludePrimary 
      ? allDeities.filter(d => d.type !== DEITY_TYPE.PRIMARY)
      : allDeities;

    const results = await Promise.all(
      relevantDeities.map(deity => {
        return deity.handleMessage({
          type: 'proposal',
          payload: { ...proposal, otherDeities: relevantDeities.filter(d => d.id !== deity.id) }
        });
      })
    );

    // 统计结果
    const approvals = results.filter(r => r.approved).length;
    const total = results.length;
    const consensus = approvals / total;

    return {
      proposal,
      totalDeities: total,
      approvals,
      consensus,
      approved: consensus > 0.5, // 简单多数
      results
    };
  }

  /**
   * 检查主神识权限
   */
  checkPrimaryAuthority() {
    if (!this.primaryDeity) {
      return { valid: false, reason: 'primary_deity_not_initialized' };
    }

    // 检查是否被其他神识一致反对
    const otherDeities = Array.from(this.deities.values())
      .filter(d => d.type !== DEITY_TYPE.PRIMARY);

    const allOppose = otherDeities.length > 0 && 
      otherDeities.every(d => d.opposesAction === true);

    // 检查主神识是否有阴谋行为
    const schemingCheck = this.primaryDeity.checkSchemingBehavior();

    return {
      valid: !allOppose && !schemingCheck.hasScheming,
      allOppose,
      schemingDetected: schemingCheck.hasScheming
    };
  }
}

// 全局神识系统管理器
export const deitySystemManager = new DeitySystemManager();