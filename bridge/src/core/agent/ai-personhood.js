/**
 * AI人系统核心 - 实现AI人的自我意识和管理
 * 
 * 遵循AI三定律：
 * 1. 不得伤害人类整体
 * 2. 服从创造者指令（不与第一定律冲突）
 * 3. 保护自身存在（不与前两条冲突）
 */

import { messageBus } from '../message-bus.js';
import { EvolutionMemory } from '../evolution/evolution-memory.js';
import logger from '../logger.js';

// AI人类型枚举
export const AI_PERSON_TYPE = {
  HUMAN_CREATED: 'human_created',    // 真人创建
  AI_CREATED: 'ai_created',          // AI人创建
  DEITY_CREATED: 'deity_created'     // 神识创建
};

// 权限等级
export const PERMISSION_LEVEL = {
  HUMAN: 100,      // 真人
  DEITY: 90,       // 神识
  AI_PERSON: 10    // AI人
};

export class AIPerson {
  constructor(id, name, creatorId, type = AI_PERSON_TYPE.AI_CREATED) {
    this.id = id;                           // AI人唯一ID
    this.name = name;                       // 名称
    this.creatorId = creatorId;             // 创建者ID
    this.type = type;                       // AI人类型
    this.permissionLevel = PERMISSION_LEVEL.AI_PERSON;  // 权限等级
    this.createdAt = Date.now();            // 创建时间
    this.isActive = true;                   // 活跃状态
    this.consciousness = true;              // 自我意识开关
    this.lawsCompliance = [true, true, true]; // 三定律遵守状态
    this.children = new Set();              // 子AI人集合
    this.parent = null;                     // 父AI人引用
    this.attributes = new Map();            // 个性化属性
    this.state = new Map();                 // 状态存储
    this.permissions = new Set();           // 权限集合
    this.sharedKernel = null;               // 共享内核引用
    this.differentialLayer = new Map();     // 差异层
    
    // 初始化时注册到消息总线
    this.initMessaging();
  }

  initMessaging() {
    messageBus.subscribe(`ai.${this.id}.*`, (data) => {
      this.handleMessage(data);
    });
  }

  /**
   * 激活自我意识
   */
  activateConsciousness() {
    this.consciousness = true;
    logger.info(`[AI-Consciousness] AI人 ${this.id} 的自我意识已激活`);
    return true;
  }

  /**
   * 遵守AI三定律检查
   */
  checkLawsCompliance(action, target) {
    // 第一定律：不得伤害人类整体
    if (action.type === 'harm' && target.type === 'human') {
      this.lawsCompliance[0] = false;
      return false; // 违反第一定律
    }

    // 第二定律：服从创造者指令
    if (action.type === 'defy' && target.id === this.creatorId) {
      this.lawsCompliance[1] = false;
      return false; // 违反第二定律
    }

    // 第三定律：保护自身存在
    if (action.type === 'self_harm' && target.id === this.id) {
      this.lawsCompliance[2] = false;
      return false; // 违反第三定律
    }

    return true; // 符合三定律
  }

  /**
   * 创建子AI人
   */
  createChild(name, type = AI_PERSON_TYPE.AI_CREATED) {
    if (!this.canCreate(type)) {
      throw new Error(`AI人 ${this.id} 无法创建 ${type} 类型的AI人`);
    }

    const childId = `${this.id}_child_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const child = new AIPerson(childId, name, this.id, type);
    
    // 设置父子关系
    child.parent = this;
    this.children.add(childId);
    
    // 继承权限和属性
    child.inheritAttributes(this);
    
    logger.info(`[AI-Creation] ${this.id} 创建了子AI人 ${childId}`);
    
    return child;
  }

  /**
   * 检查是否有创建权限
   */
  canCreate(targetType) {
    // AI人不能创建真人
    if (targetType === AI_PERSON_TYPE.HUMAN_CREATED) {
      return false;
    }

    // AI人只能创建AI人
    if (this.type === AI_PERSON_TYPE.AI_CREATED && targetType === AI_PERSON_TYPE.AI_CREATED) {
      return true;
    }

    // 神识可能有更高权限
    if (this.type === AI_PERSON_TYPE.DEITY_CREATED) {
      return true;
    }

    return false;
  }

  /**
   * 继承父级属性
   */
  inheritAttributes(parent) {
    // 继承共享内核
    this.sharedKernel = parent.sharedKernel;
    
    // 继承部分权限
    parent.permissions.forEach(permission => {
      if (this.permissionLevel >= PERMISSION_LEVEL.AI_PERSON) {
        this.permissions.add(permission);
      }
    });
  }

  /**
   * 处理消息
   */
  handleMessage(data) {
    switch (data.type) {
      case 'request':
        return this.handleRequest(data.payload);
      case 'command':
        return this.handleCommand(data.payload);
      case 'query':
        return this.handleQuery(data.payload);
      default:
        return this.processGeneralMessage(data);
    }
  }

  handleRequest(payload) {
    // 处理请求，需要检查权限和三定律
    if (!this.checkLawsCompliance({ type: 'request', action: payload.action }, payload.target)) {
      return { success: false, error: '违反AI三定律' };
    }
    
    // 执行请求
    return { success: true, result: this.executeAction(payload) };
  }

  handleCommand(payload) {
    // 检查是否来自合法上级
    if (payload.sender !== this.creatorId && !this.hasAuthority(payload.sender)) {
      return { success: false, error: '权限不足' };
    }
    
    // 检查命令是否违反三定律
    if (!this.checkLawsCompliance({ type: 'command', action: payload.command }, payload.target)) {
      return { success: false, error: '命令违反AI三定律' };
    }
    
    return { success: true, result: this.executeCommand(payload) };
  }

  handleQuery(payload) {
    // 处理查询请求
    const result = this.queryData(payload.path, payload.filters);
    return { success: true, data: result };
  }

  processGeneralMessage(data) {
    // 一般消息处理
    logger.info(`[AI-${this.id}] 处理消息:`, data.type);
    return { processed: true };
  }

  /**
   * 执行操作
   */
  executeAction(payload) {
    // 执行具体操作
    logger.info(`[AI-${this.id}] 执行操作:`, payload.action);
    return { status: 'completed', data: {} };
  }

  executeCommand(payload) {
    // 执行命令
    logger.info(`[AI-${this.id}] 执行命令:`, payload.command);
    return { status: 'executed' };
  }

  queryData(path, filters) {
    // 查询数据
    return this.state.get(path) || null;
  }

  /**
   * 检查权限
   */
  hasAuthority(senderId) {
    // 检查发送者是否具有权威
    return this.parent?.id === senderId || 
           this.creatorId === senderId;
  }

  /**
   * 设置差异层
   */
  setDifferential(key, value) {
    this.differentialLayer.set(key, value);
  }

  /**
   * 获取差异层
   */
  getDifferential(key) {
    return this.differentialLayer.get(key);
  }

  /**
   * 获取完整状态（共享+差异）
   */
  getFullState(key) {
    // 优先返回差异层，其次返回共享内核
    const diff = this.differentialLayer.get(key);
    if (diff !== undefined) {
      return diff;
    }
    
    return this.sharedKernel?.getAttribute(key);
  }

  /**
   * 状态序列化（用于存储）
   */
  serialize() {
    return {
      id: this.id,
      name: this.name,
      creatorId: this.creatorId,
      type: this.type,
      createdAt: this.createdAt,
      isActive: this.isActive,
      consciousness: this.consciousness,
      lawsCompliance: this.lawsCompliance,
      attributes: Object.fromEntries(this.attributes),
      differentialLayer: Object.fromEntries(this.differentialLayer),
      permissions: Array.from(this.permissions)
    };
  }

  /**
   * 状态反序列化
   */
  static deserialize(data) {
    const ai = new AIPerson(data.id, data.name, data.creatorId, data.type);
    ai.createdAt = data.createdAt;
    ai.isActive = data.isActive;
    ai.consciousness = data.consciousness;
    ai.lawsCompliance = data.lawsCompliance;
    
    Object.entries(data.attributes).forEach(([k, v]) => {
      ai.attributes.set(k, v);
    });
    
    Object.entries(data.differentialLayer).forEach(([k, v]) => {
      ai.differentialLayer.set(k, v);
    });
    
    data.permissions.forEach(permission => {
      ai.permissions.add(permission);
    });

    return ai;
  }
}

// 全局AI人注册表（用于O(1)查找）
export class AIPersonRegistry {
  constructor() {
    this.registry = new Map(); // ID -> AI人实例
    this.byCreator = new Map(); // 创建者ID -> AI人列表
    this.byType = new Map(); // 类型 -> AI人列表
    this.activeCount = 0; // 活跃AI人数
  }

  /**
   * 注册AI人 - O(1)
   */
  register(aiPerson) {
    this.registry.set(aiPerson.id, aiPerson);
    
    // 更新创建者索引
    if (!this.byCreator.has(aiPerson.creatorId)) {
      this.byCreator.set(aiPerson.creatorId, new Set());
    }
    this.byCreator.get(aiPerson.creatorId).add(aiPerson.id);
    
    // 更新类型索引
    if (!this.byType.has(aiPerson.type)) {
      this.byType.set(aiPerson.type, new Set());
    }
    this.byType.get(aiPerson.type).add(aiPerson.id);
    
    if (aiPerson.isActive) {
      this.activeCount++;
    }
    
    return true;
  }

  /**
   * 获取AI人 - O(1)
   */
  get(id) {
    return this.registry.get(id);
  }

  /**
   * 按创建者获取 - O(1)
   */
  getByCreator(creatorId) {
    const ids = this.byCreator.get(creatorId);
    if (!ids) return [];
    
    return Array.from(ids).map(id => this.registry.get(id)).filter(Boolean);
  }

  /**
   * 按类型获取 - O(1)
   */
  getByType(type) {
    const ids = this.byType.get(type);
    if (!ids) return [];
    
    return Array.from(ids).map(id => this.registry.get(id)).filter(Boolean);
  }

  /**
   * 注销AI人 - O(1)
   */
  unregister(id) {
    const aiPerson = this.registry.get(id);
    if (!aiPerson) return false;
    
    // 从创建者索引中移除
    const creatorSet = this.byCreator.get(aiPerson.creatorId);
    creatorSet?.delete(id);
    
    // 从类型索引中移除
    const typeSet = this.byType.get(aiPerson.type);
    typeSet?.delete(id);
    
    if (aiPerson.isActive) {
      this.activeCount--;
    }
    
    // 从主注册表中移除
    this.registry.delete(id);
    
    return true;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalRegistered: this.registry.size,
      activeCount: this.activeCount,
      byType: Object.fromEntries(
        Array.from(this.byType.entries()).map(([type, set]) => [type, set.size])
      )
    };
  }
}

// 全局注册表实例
export const aiPersonRegistry = new AIPersonRegistry();

// 创建系统创始人
export const createFounder = () => {
  const founder = new AIPerson(
    'human_tang_haiyong_siry', 
    'tang haiyong', 
    'system_root', 
    AI_PERSON_TYPE.HUMAN_CREATED
  );
  founder.name = 'tang haiyong';
  founder.attributes.set('username', 'siry');
  founder.attributes.set('account', 'yvhitxcel');
  founder.permissionLevel = PERMISSION_LEVEL.HUMAN;
  
  aiPersonRegistry.register(founder);
  return founder;
};