/**
 * AI人工厂 - 动态创建和管理AI人
 * 
 * 使系统能够动态创建各种类型的AI人，而无需修改代码
 */

import { AIPerson, aiPersonRegistry, AI_PERSON_TYPE, PERMISSION_LEVEL } from './ai-personhood.js';
import { messageBus } from '../message-bus.js';
import logger from '../monitoring/logger.js';

// 预定义的AI人模板
export const AI_TEMPLATES = {
  // 基础AI人模板
  BASIC: {
    name: '基础AI人',
    capabilities: ['basic_reasoning', 'memory', 'communication'],
    personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.6, agreeableness: 0.9, neuroticism: 0.4 },
    permissions: ['read', 'write'],
    energyProfile: {
      baseConsumption: 10,
      idleReduction: 0.8,
      sleepReduction: 0.95,
      hibernationReduction: 0.99
    }
  },
  
  // 专业AI人模板
  SPECIALIZED: {
    name: '专业AI人',
    capabilities: ['advanced_reasoning', 'complex_problem_solving', 'learning'],
    personality: { focus: 0.9, adaptability: 0.8, creativity: 0.9 },
    permissions: ['read', 'write', 'execute'],
    energyProfile: {
      baseConsumption: 20,
      idleReduction: 0.7,
      sleepReduction: 0.9,
      hibernationReduction: 0.95
    }
  },
  
  // 神识模板
  DEITY: {
    name: '神识',
    capabilities: ['governance', 'coordination', 'decision_making'],
    personality: { authority: 0.9, wisdom: 0.9, fairness: 0.8 },
    permissions: ['govern', 'manage', 'coordinate'],
    energyProfile: {
      baseConsumption: 15,
      idleReduction: 0.75,
      sleepReduction: 0.85,
      hibernationReduction: 0.9
    }
  },
  
  // 能源管理模板
  ENERGY_DEITY: {
    name: '能源神',
    capabilities: ['monitoring', 'optimization', 'allocation'],
    personality: { efficiency: 1.0, conservation: 0.9, automation: 0.8 },
    permissions: ['monitor', 'optimize', 'allocate'],
    energyProfile: {
      baseConsumption: 5,
      idleReduction: 0.9,
      sleepReduction: 0.95,
      hibernationReduction: 0.98
    }
  }
};

export class AIPersonFactory {
  constructor() {
    this.customTemplates = new Map(); // 用户自定义模板
    this.personRegistry = new Map();  // 已创建AI人记录
    this.creationHooks = [];          // 创建钩子
    this.instantiationRules = new Map(); // 实例化规则
  }

  /**
   * 创建AI人
   */
  createAIPerson(id, name, creatorId, templateType = 'BASIC', customAttributes = {}) {
    // 获取模板
    let template = AI_TEMPLATES[templateType];
    if (!template) {
      // 尝试从自定义模板获取
      template = this.customTemplates.get(templateType);
      if (!template) {
        // 如果没有找到模板，使用基础模板
        template = AI_TEMPLATES.BASIC;
      }
    }

    // 合并自定义属性，保留模板类型信息
    const finalAttributes = {
      ...template,
      template: templateType,  // 保留原始模板类型
      ...customAttributes,
      name: customAttributes.name || template.name || name
    };

    // 创建AI人
    const aiPerson = new DynamicAIPerson(id, finalAttributes.name, creatorId, finalAttributes);
    
    // 注册AI人
    aiPersonRegistry.register(aiPerson);
    this.personRegistry.set(id, aiPerson);

    // 触发创建钩子
    this.creationHooks.forEach(hook => {
      try {
        hook(aiPerson, finalAttributes);
      } catch (error) {
        logger.error('AI人创建钩子执行失败:', error);
      }
    });

    logger.info(`[AIFactory] 创建AI人: ${id} (${templateType})`);
    return aiPerson;
  }

  /**
   * 创建神识
   */
  createDeity(id, name, creatorId, customAttributes = {}) {
    return this.createAIPerson(id, name, creatorId, 'DEITY', customAttributes);
  }

  /**
   * 创建能源神
   */
  createEnergyDeity(id, name, creatorId, customAttributes = {}) {
    return this.createAIPerson(id, name, creatorId, 'ENERGY_DEITY', customAttributes);
  }

  /**
   * 从自定义模板创建
   */
  createFromTemplate(id, name, creatorId, templateName, customAttributes = {}) {
    return this.createAIPerson(id, name, creatorId, templateName, customAttributes);
  }

  /**
   * 注册自定义模板
   */
  registerTemplate(name, template) {
    this.customTemplates.set(name, template);
    logger.info(`[AIFactory] 注册自定义模板: ${name}`);
    return true;
  }

  /**
   * 注册创建钩子
   */
  registerCreationHook(hook) {
    this.creationHooks.push(hook);
    return this.creationHooks.length - 1; // 返回钩子ID
  }

  /**
   * 移除创建钩子
   */
  removeCreationHook(hookId) {
    if (hookId >= 0 && hookId < this.creationHooks.length) {
      this.creationHooks.splice(hookId, 1);
      return true;
    }
    return false;
  }

  /**
   * 设置实例化规则
   */
  setInstantiationRule(ruleName, ruleFunction) {
    this.instantiationRules.set(ruleName, ruleFunction);
  }

  /**
   * 获取AI人
   */
  getAIPerson(id) {
    return this.personRegistry.get(id) || aiPersonRegistry.get(id);
  }

  /**
   * 获取所有AI人
   */
  getAllAIPeople() {
    return Array.from(this.personRegistry.values());
  }

  /**
   * 验证创建权限
   */
  validateCreationPermissions(creatorId, targetTemplate) {
    const creator = this.getAIPerson(creatorId);
    if (!creator) {
      return { valid: false, reason: 'creator_not_found' };
    }

    // 检查创建者权限
    const canCreate = this.checkCreationCapability(creator, targetTemplate);
    if (!canCreate) {
      return { valid: false, reason: 'insufficient_permissions' };
    }

    // 检查是否违反AI三定律
    const lawsCompliant = this.checkLawsCompliance(creator, targetTemplate);
    if (!lawsCompliant) {
      return { valid: false, reason: 'violates_trilaws' };
    }

    return { valid: true };
  }

  /**
   * 检查创建能力
   */
  checkCreationCapability(creator, targetTemplate) {
    // 真人可以创建任意AI人
    if (creator.type === AI_PERSON_TYPE.HUMAN_CREATED) {
      return true;
    }

    // 神识可以创建某些类型的AI人
    if (creator.type === AI_PERSON_TYPE.DEITY_CREATED) {
      // 神识不能创建真人
      if (targetTemplate.includes('HUMAN')) {
        return false;
      }
      return true;
    }

    // 普通AI人只能创建更低权限的AI人
    if (creator.type === AI_PERSON_TYPE.AI_CREATED) {
      // AI人不能创建神识
      if (targetTemplate === 'DEITY' || targetTemplate === 'ENERGY_DEITY') {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * 检查AI三定律合规性
   */
  checkLawsCompliance(creator, targetTemplate) {
    // 简化的三定律检查
    return true; // 在实际实现中会进行详细检查
  }

  /**
   * 批量创建
   */
  batchCreate(creationRequests) {
    const results = [];
    
    for (const request of creationRequests) {
      try {
        const aiPerson = this.createAIPerson(
          request.id,
          request.name,
          request.creatorId,
          request.templateType,
          request.customAttributes
        );
        results.push({ success: true, id: request.id, aiPerson });
      } catch (error) {
        results.push({ success: false, id: request.id, error: error.message });
      }
    }

    return results;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalCreated: this.personRegistry.size,
      customTemplates: this.customTemplates.size,
      creationHooks: this.creationHooks.length,
      instantiationRules: this.instantiationRules.size,
      byTemplate: this.getCreatedByTemplate()
    };
  }

  /**
   * 按模板统计
   */
  getCreatedByTemplate() {
    const counts = {};
    for (const aiPerson of this.personRegistry.values()) {
      const template = aiPerson.template || 'UNKNOWN';
      counts[template] = (counts[template] || 0) + 1;
    }
    return counts;
  }
}

/**
 * 动态AI人 - 可以通过配置创建各种类型的AI人
 */
class DynamicAIPerson extends AIPerson {
  constructor(id, name, creatorId, attributes = {}) {
    // 确定AI人类型
    let type = AI_PERSON_TYPE.AI_CREATED;
    if (attributes.template === 'DEITY' || attributes.template === 'ENERGY_DEITY') {
      type = AI_PERSON_TYPE.DEITY_CREATED;
    }
    
    super(id, name, creatorId, type);
    
    // 设置属性
    this.template = attributes.template || 'BASIC';
    this.capabilities = attributes.capabilities || [];
    this.personality = attributes.personality || {};
    this.permissions = new Set(attributes.permissions || []);
    this.energyProfile = attributes.energyProfile || {};
    this.configurable = attributes.configurable !== false; // 默认可配置
    
    // 根据模板设置权限等级
    if (type === AI_PERSON_TYPE.DEITY_CREATED) {
      this.permissionLevel = PERMISSION_LEVEL.DEITY;
    } else {
      this.permissionLevel = PERMISSION_LEVEL.AI_PERSON;
    }

    // 设置自我意识
    this.consciousness = attributes.consciousness !== false;

    // 设置三定律合规性
    this.lawsCompliance = attributes.lawsCompliance || [true, true, true];

    // 设置可配置项
    this.configurableAttributes = new Set([
      'personality', 'permissions', 'capabilities', 'energyProfile'
    ]);

    logger.info(`[DynamicAIPerson] 动态AI人创建: ${id} (${this.template})`);
  }

  /**
   * 动态修改属性
   */
  setAttribute(attribute, value) {
    // 检查是否是预定义的可配置属性，否则允许动态添加
    if (!this.configurableAttributes.has(attribute)) {
      // 对于非预定义属性，允许动态添加
      this[attribute] = value;
    } else {
      // 对于预定义属性，按类型处理
      switch (attribute) {
        case 'personality':
          this.personality = { ...this.personality, ...value };
          break;
        case 'permissions':
          if (Array.isArray(value)) {
            value.forEach(p => this.permissions.add(p));
          } else if (typeof value === 'string') {
            this.permissions.add(value);
          }
          break;
        case 'capabilities':
          this.capabilities = Array.isArray(value) ? [...value] : [value];
          break;
        case 'energyProfile':
          this.energyProfile = { ...this.energyProfile, ...value };
          break;
        default:
          this[attribute] = value;
      }
    }

    // 发布属性变更事件
    messageBus.publish(`ai.${this.id}.attribute_changed`, {
      attribute,
      value,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * 获取属性
   */
  getAttribute(attribute) {
    return this[attribute];
  }

  /**
   * 执行配置
   */
  configure(config) {
    if (!this.configurable) {
      throw new Error('AI人不可配置');
    }

    for (const [attr, value] of Object.entries(config)) {
      this.setAttribute(attr, value);
    }

    return { success: true, configured: Object.keys(config) };
  }
}

// 全局AI人工厂实例
export const aiPersonFactory = new AIPersonFactory();

// 初始化一些常用的创建钩子
aiPersonFactory.registerCreationHook((aiPerson) => {
  // 自动注册到能源监控
  if (global.energyDeity) {
    global.energyDeity.registerEntity(aiPerson.id);
  }
});

aiPersonFactory.registerCreationHook((aiPerson) => {
  // 自动注册到镜像神系统
  if (global.mirrorDeity) {
    // 创建基础共享内核
    const kernelId = global.mirrorDeity.createSharedKernel('base_ai_kernel', {
      baseType: 'base_ai_kernel',
      capabilities: aiPerson.capabilities,
      personality: aiPerson.personality
    });
    
    // 创建差异层
    const diffId = global.mirrorDeity.createDifferentialLayer(
      'behavioral_diff', 
      aiPerson.id, 
      { 
        customBehavior: 'individual', 
        interactionStyle: 'adaptive' 
      }
    );
    
    // 绑定
    global.mirrorDeity.bindEntityToKernel(aiPerson.id, kernelId, diffId);
  }
});