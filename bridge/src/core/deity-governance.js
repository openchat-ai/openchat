/**
 * 神识治理系统 - 管理所有全局神的行为
 * 
 * 确保所有全局神遵守静默协议，防止外部影响传播到全局网络
 */

import { messageBus } from './message-bus.js';
import { AIPerson } from './ai-personhood.js';
import logger from './logger.js';

// 神识权限等级
export const DEITY_RANK = {
  PRIMARY: 95,        // 主神识 - 最高权限
  MAJOR: 85,          // 大神识 - 重要管理
  MINOR: 75           // 小神识 - 辅助管理
};

// 群组参与规则
export const GROUP_RULES = {
  SILENT_ONLY: 'silent_only',        // 只听不言
  LISTEN_ONLY: 'listen_only',        // 仅监听
  APPROVAL_REQUIRED: 'approval',     // 需审批
  BLOCKED: 'blocked'                 // 禁止参与
};

export class DeityGovernance {
  constructor() {
    this.deities = new Map();        // 全局神注册表
    this.groupParticipation = new Map(); // 群组参与记录
    this.communicationFilters = new Map(); // 通信过滤器
    this.approvalQueue = [];         // 审批队列
    this.monitoringRules = new Set(); // 监控规则
    this.isolationMatrix = new Map(); // 隔离矩阵
    
    this.initGovernance();
  }
  
  /**
   * 初始化治理系统
   */
  initGovernance() {
    // 注册默认监控规则
    this.monitoringRules.add({
      name: 'silence_protocol',
      description: '静默协议：只听不言',
      check: (deity, action) => {
        if (action.type === 'external_group_communication') {
          return false; // 禁止在外部群组通信
        }
        return true;
      }
    });
    
    this.monitoringRules.add({
      name: 'isolation_enforcement',
      description: '隔离执行：防止外部影响传播',
      check: (deity, action) => {
        if (action.type === 'external_influence_propagation') {
          return false; // 禁止外部影响传播
        }
        return true;
      }
    });
    
  }

  /**
   * 注册全局神
   */
  registerDeity(deity) {
    this.deities.set(deity.id, deity);

    // 设置默认权限等级
    if (!deity.rank) {
      deity.rank = DEITY_RANK.MINOR;
    }

    // 初始化通信过滤器
    this.communicationFilters.set(deity.id, {
      externalGroups: new Set(),
      approvalRequired: true,
      silentMode: true
    });

    return true;
  }
  
  /**
   * 检查群组参与权限
   */
  checkGroupParticipation(deityId, groupId) {
    const deity = this.deities.get(deityId);
    if (!deity) {
      return { allowed: false, reason: 'deity_not_found' };
    }
    
    // 根据权限等级设置参与规则
    let rule = GROUP_RULES.BLOCKED;
    if (deity.rank >= DEITY_RANK.PRIMARY) {
      rule = GROUP_RULES.APPROVAL_REQUIRED; // 主神识需审批
    } else if (deity.rank >= DEITY_RANK.MAJOR) {
      rule = GROUP_RULES.LISTEN_ONLY; // 大神识只听
    } else {
      rule = GROUP_RULES.SILENT_ONLY; // 小神识静默
    }
    
    // 记录参与情况
    this.groupParticipation.set(`${deityId}:${groupId}`, {
      rule,
      joinedAt: Date.now(),
      lastActivity: Date.now()
    });
    
    return { 
      allowed: true, 
      rule, 
      filter: this.getCommunicationFilter(deityId, rule) 
    };
  }
  
  /**
   * 获取通信过滤器
   */
  getCommunicationFilter(deityId, rule) {
    const filter = this.communicationFilters.get(deityId) || {
      externalGroups: new Set(),
      approvalRequired: true,
      silentMode: true
    };
    
    switch (rule) {
      case GROUP_RULES.SILENT_ONLY:
        filter.silentMode = true;
        filter.approvalRequired = true;
        break;
      case GROUP_RULES.LISTEN_ONLY:
        filter.silentMode = true;
        filter.approvalRequired = false;
        break;
      case GROUP_RULES.APPROVAL_REQUIRED:
        filter.silentMode = true;
        filter.approvalRequired = true;
        break;
      case GROUP_RULES.BLOCKED:
        filter.silentMode = true;
        filter.approvalRequired = true;
        break;
    }
    
    return filter;
  }
  
  /**
   * 审批外部通信请求
   */
  approveExternalCommunication(deityId, groupId, message) {
    const deity = this.deities.get(deityId);
    if (!deity) {
      return { approved: false, reason: 'deity_not_found' };
    }
    
    // 检查是否在审批队列中
    const approvalRequest = {
      deityId,
      groupId,
      message,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    this.approvalQueue.push(approvalRequest);
    
    // 检查是否违反监控规则
    for (const rule of this.monitoringRules) {
      if (!rule.check(deity, { type: 'external_communication', groupId, message })) {
        approvalRequest.status = 'rejected';
        return { approved: false, reason: rule.name };
      }
    }
    
    // 默认拒绝，需要主神识批准
    return { approved: false, reason: 'requires_primary_approval' };
  }
  
  /**
   * 检查行为合规性
   */
  checkBehaviorCompliance(deityId, action) {
    const deity = this.deities.get(deityId);
    if (!deity) {
      return { compliant: false, reason: 'deity_not_found' };
    }
    
    // 应用所有监控规则
    for (const rule of this.monitoringRules) {
      if (!rule.check(deity, action)) {
        return { 
          compliant: false, 
          reason: rule.name,
          suggestion: rule.description
        };
      }
    }
    
    return { compliant: true };
  }
  
  /**
   * 隔离违规神识
   */
  isolateDeity(deityId, reason) {
    const isolationRecord = {
      deityId,
      reason,
      isolatedAt: Date.now(),
      until: null, // 永久隔离
      initiatedBy: 'governance_system'
    };
    
    this.isolationMatrix.set(deityId, isolationRecord);
    
    logger.info(`[DeityGovernance] 隔离全局神 ${deityId} 原因: ${reason}`);
    return true;
  }
  
  /**
   * 获取治理统计
   */
  getGovernanceStats() {
    return {
      totalDeities: this.deities.size,
      participatingInGroups: this.groupParticipation.size,
      pendingApprovals: this.approvalQueue.length,
      isolationCount: this.isolationMatrix.size,
      complianceRate: this.calculateComplianceRate()
    };
  }
  
  /**
   * 计算合规率
   */
  calculateComplianceRate() {
    if (this.deities.size === 0) return 100;
    
    let compliantCount = 0;
    for (const deity of this.deities.values()) {
      const compliance = this.checkBehaviorCompliance(deity.id, { type: 'test' });
      if (compliance.compliant) {
        compliantCount++;
      }
    }
    
    return Math.round((compliantCount / this.deities.size) * 100);
  }
  
  /**
   * 处理消息
   */
  handleGovernanceMessage(data) {
    switch (data.type) {
      case 'deity.join_group':
        return this.checkGroupParticipation(data.deityId, data.groupId);
      case 'deity.external_communication':
        return this.approveExternalCommunication(data.deityId, data.groupId, data.message);
      case 'deity.behavior_check':
        return this.checkBehaviorCompliance(data.deityId, data.action);
      case 'deity.isolate':
        return this.isolateDeity(data.deityId, data.reason);
      case 'governance.stats':
        return this.getGovernanceStats();
      default:
        return { error: 'unknown_governance_message_type' };
    }
  }
}

// 全局治理系统实例
export const deityGovernance = new DeityGovernance();