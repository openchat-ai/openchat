import logger from '../core/monitoring/logger.js';
/**
 * P2P Message Types
 * 定义 6 种 P2P 消息类型
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const MessageType = {
  // Skill 市场消息
  SKILL_PUBLISH: 'skill_publish',
  SKILL_REQUEST: 'skill_request',

  // 协作消息
  COLLABORATION_REQUEST: 'collaboration_request',
  COLLABORATION_RESPONSE: 'collaboration_response',

  // 知识共享
  INSIGHT_SHARE: 'insight_share',

  // 性能报告
  PERFORMANCE_REPORT: 'performance_report',

  // P2R: 居民治家
  BRIDGE_SPAWN:         'bridge_spawn',       // 请求邻居 spawn 子 Bridge 做窟
  SAFE_HOUSE_VERIFY:    'safe_house_verify',  // 验证窟还活着
  BRIDGE_UPGRADE:       'bridge_upgrade',     // 版本升级宣告
  RESIDENT_TRANSFER:    'resident_transfer',  // 居民迁移（从一窟搬到另一窟）

  // P2R: 居民治家 — 窟管理
  HOUSE_SEEK:           'house_seek',         // 找窟请求
  HOUSE_OFFER:          'house_offer',        // 安全屋提供
  HOUSE_NEED:           'house_need',         // 求助/需要窟

  // P2R-S: 安全自治 — 多方验证 + 热回滚
  PROPOSE_CHANGE:       'propose_change',     // 提案：请求修改代码
  VERIFY_RESULT:        'verify_result',      // 邻居验证回复
  CHANGE_APPLIED:       'change_applied',      // 变更成功宣告

  // LLM 代理：子桥通过母桥调用 LLM
  LLM_PROXY_REQUEST:    'llm_proxy_request',   // 子桥 → 母桥：请求 LLM 调用
  LLM_PROXY_RESPONSE:   'llm_proxy_response',  // 母桥 → 子桥：LLM 响应

  // LLM 代理：对等发现
  LLM_AVAILABLE:        'llm_available',        // 广播：本机 LLM 可用（含模型列表）
  LLM_PROVIDER_QUERY:   'llm_provider_query',   // 查询：谁有 LLM？

  // P2R-K: 公共知识库 — 布尔求解 + 最优解法共享
  KNOWLEDGE_PUBLISH:    'knowledge_publish',    // 广播：发布验证过的知识条目
  KNOWLEDGE_QUERY:      'knowledge_query',      // 查询：谁有某问题的解法
  KNOWLEDGE_RESPONSE:   'knowledge_response',   // 回复：返回匹配的知识条目

  // P2R-K: 收敛引擎 — 问题求解
  PROBLEM_SOLVE:        'problem_solve',         // 提交问题给邻居求解
  PROBLEM_RESULT:       'problem_result',        // 返回求解结果

  // P2R-D: Fairy 分布式大脑
  FAIRY_GOSSIP:         'fairy_gossip',          // Fairy 广播最近求解经验（策略+答案+耗时）
  FAIRY_CONSENSUS:      'fairy_consensus',       // 多个 Fairy 对同一问题投票共识
};

// 消息类型验证
const isValidMessageType = (type) => {
  return Object.values(MessageType).includes(type);
};

// 创建消息
const createMessage = (type, payload, options = {}) => {
  if (!isValidMessageType(type)) {
    throw new Error(`Invalid message type: ${type}`);
  }

  return {
    type,
    id: require('crypto').randomUUID(),
    payload,
    priority: options.priority || 'NORMAL',
    source: options.source || 'self',
    target: options.target || null, // null = 广播
    timestamp: Date.now(),
    ttl: options.ttl || 3600000, // 默认 1 小时
    metadata: options.metadata || {}
  };
};

// Skill 发布消息
const createSkillPublishMessage = (skill, options = {}) => {
  return createMessage(
    MessageType.SKILL_PUBLISH,
    {
      skillId: skill.id,
      skillName: skill.name,
      skillType: skill.type,
      version: skill.version,
      description: skill.description,
      code: skill.code,
      tests: skill.tests,
      author: skill.author
    },
    { priority: options.priority || 'HIGH', ...options }
  );
};

// Skill 请求消息
const createSkillRequestMessage = (query, options = {}) => {
  return createMessage(
    MessageType.SKILL_REQUEST,
    {
      query,
      skillType: options.skillType,
      minRating: options.minRating,
      limit: options.limit || 10
    },
    { priority: options.priority || 'NORMAL', ...options }
  );
};

// 协作请求消息
const createCollaborationRequestMessage = (task, options = {}) => {
  return createMessage(
    MessageType.COLLABORATION_REQUEST,
    {
      task,
      requiredRoles: options.requiredRoles || [],
      deadline: options.deadline,
      priority: options.taskPriority || 'NORMAL'
    },
    { priority: options.priority || 'HIGH', ...options }
  );
};

// 协作响应消息
const createCollaborationResponseMessage = (requestId, response, options = {}) => {
  return createMessage(
    MessageType.COLLABORATION_RESPONSE,
    {
      requestId,
      accepted: response.accepted,
      result: response.result,
      reasoning: response.reasoning
    },
    { priority: options.priority || 'NORMAL', ...options }
  );
};

// 洞察共享消息
const createInsightShareMessage = (insight, options = {}) => {
  return createMessage(
    MessageType.INSIGHT_SHARE,
    {
      title: insight.title,
      content: insight.content,
      category: insight.category, // 'bug_fix', 'optimization', 'pattern', 'learning'
      tags: insight.tags || [],
      relevanceScore: insight.relevanceScore || 0.5
    },
    { priority: options.priority || 'LOW', ...options }
  );
};

// 性能报告消息
const createPerformanceReportMessage = (metrics, options = {}) => {
  return createMessage(
    MessageType.PERFORMANCE_REPORT,
    {
      responseTime: metrics.responseTime,
      errorRate: metrics.errorRate,
      throughput: metrics.throughput,
      resourceUsage: metrics.resourceUsage,
      timestamp: metrics.timestamp || Date.now()
    },
    { priority: options.priority || 'LOW', ...options }
  );
};

// P2R: 请求邻居 spawn 子 Bridge 做窟
const createBridgeSpawnRequest = (options = {}) => {
  return createMessage(
    MessageType.BRIDGE_SPAWN,
    {
      residentCount: options.residentCount || 0,
      reason: options.reason || 'need_more_space',
      hostId: options.hostId || '',
      host: options.host,
      port: options.port
    },
    { priority: options.priority || 'HIGH', ...options }
  );
};

// P2R: 验证窟还活着
const createSafeHouseVerify = (options = {}) => {
  return createMessage(
    MessageType.SAFE_HOUSE_VERIFY,
    {
      houseId: options.houseId,
      bridgeId: options.bridgeId,
      hostId: options.hostId || '',
      nonce: options.nonce || Date.now()
    },
    { priority: options.priority || 'NORMAL', ...options }
  );
};

// P2R: 找窟
const createHouseSeekMessage = (options = {}) => {
  return createMessage(
    MessageType.HOUSE_SEEK,
    {
      residentName: options.residentName,
      residentId: options.residentId,
      hostId: options.hostId || '',
      preferredType: options.preferredType || 'neighbor',
      traits: options.traits || {},
    },
    { priority: options.priority || 'HIGH', ...options }
  );
};

// P2R: 求助/需要窟
const createHouseNeedMessage = (options = {}) => {
  return createMessage(
    MessageType.HOUSE_NEED,
    {
      action: options.action,
      residentName: options.residentName,
      residentId: options.residentId,
      hostId: options.hostId || '',
      healthScore: options.healthScore,
      alerts: options.alerts || [],
    },
    { priority: options.priority || 'HIGH', ...options }
  );
};

// P2R: 版本升级宣告
const createBridgeUpgradeMessage = (options = {}) => {
  return createMessage(
    MessageType.BRIDGE_UPGRADE,
    {
      version: options.version || '2.0',
      changes: options.changes || [],
      required: options.required || false
    },
    { priority: options.priority || 'HIGH', ...options }
  );
};

// P2R: 居民迁移
const createResidentTransferMessage = (options = {}) => {
  return createMessage(
    MessageType.RESIDENT_TRANSFER,
    {
      residents: options.residents || [],
      targetBridgeId: options.targetBridgeId,
      targetHostId: options.targetHostId || '',
      sourceBridgeId: options.sourceBridgeId,
      sourceHostId: options.sourceHostId || '',
      reason: options.reason || 'house_unhealthy'
    },
    { priority: options.priority || 'HIGH', ...options }
  );
};

// P2R-S: 安全自治 — 提案修改代码
const createProposeChangeMessage = (proposal, options = {}) => {
  const id = require('crypto').randomUUID();
  return createMessage(
    MessageType.PROPOSE_CHANGE,
    {
      proposalId: id,
      file: proposal.file,
      oldHash: proposal.oldHash,
      newContent: proposal.newContent,
      newHash: proposal.newHash,
      reason: proposal.reason || 'optimization',
      proposedBy: proposal.proposedBy,
      residentName: proposal.residentName,
      signatures: proposal.signatures || [],
      timestamp: Date.now()
    },
    { priority: options.priority || 'HIGH', ttl: 300000, ...options }
  );
};

// P2R-S: 邻居验证回复
const createVerifyResultMessage = (result, options = {}) => {
  return createMessage(
    MessageType.VERIFY_RESULT,
    {
      proposalId: result.proposalId,
      approved: result.approved || false,
      score: result.score || 0,
      warnings: result.warnings || [],
      verifiedBy: result.verifiedBy || result.verifierId,
      bridgeId: result.bridgeId,
      timestamp: Date.now()
    },
    { priority: options.priority || 'HIGH', ttl: 300000, ...options }
  );
};

// P2R-S: 变更成功宣告
const createChangeAppliedMessage = (result, options = {}) => {
  return createMessage(
    MessageType.CHANGE_APPLIED,
    {
      proposalId: result.proposalId,
      file: result.file,
      newHash: result.newHash,
      appliedBy: result.appliedBy,
      rollbackReady: true,
      timestamp: Date.now()
    },
    { priority: options.priority || 'NORMAL', ...options }
  );
};

// LLM 代理：子桥请求母桥调用 LLM
const createLLMProxyRequest = (options = {}) => {
  return createMessage(
    MessageType.LLM_PROXY_REQUEST,
    {
      requestId: options.requestId || require('crypto').randomUUID(),
      model: options.model || '',
      messages: options.messages || [],
      residentId: options.residentId || '',
      residentName: options.residentName || '',
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens || 2048,
      tracing: options.tracing || {},
    },
    { priority: options.priority || 'HIGH', ttl: 60000, ...options }
  );
};

// LLM 代理：母桥回复子桥
const createLLMProxyResponse = (options = {}) => {
  return createMessage(
    MessageType.LLM_PROXY_RESPONSE,
    {
      requestId: options.requestId,
      ok: options.ok !== false,
      content: options.content || '',
      model: options.model || '',
      tokens: options.tokens || { prompt: 0, completion: 0, total: 0 },
      error: options.error || '',
      duration: options.duration || 0,
    },
    { priority: options.priority || 'HIGH', ttl: 60000, ...options }
  );
};

// LLM 代理：广播本机 LLM 可用
const createLLMAvailableMessage = (options = {}) => {
  return createMessage(
    MessageType.LLM_AVAILABLE,
    {
      bridgeId: options.bridgeId,
      hostId: options.hostId || '',
      models: options.models || [],
      provider: options.provider || '',
      since: Date.now(),
    },
    { priority: options.priority || 'NORMAL', ttl: 120000, ...options }
  );
};

// LLM 代理：查询谁有 LLM
const createLLMProviderQueryMessage = (options = {}) => {
  return createMessage(
    MessageType.LLM_PROVIDER_QUERY,
    {
      requestId: options.requestId || require('crypto').randomUUID(),
      from: options.from || '',
    },
    { priority: options.priority || 'HIGH', ttl: 30000, ...options }
  );
};

// P2R-K: 提交问题给邻居求解
const createProblemSolveMessage = (options = {}) => {
  return createMessage(
    MessageType.PROBLEM_SOLVE,
    {
      problemId: options.problemId || require('crypto').randomUUID(),
      question: options.question || '',
      domain: options.domain || 'general',
      subQuestions: options.subQuestions || [],
      fromBridge: options.fromBridge || '',
      ttl: options.ttl || 60000,
    },
    { priority: options.priority || 'HIGH', ttl: options.ttl || 60000, ...options }
  );
};

// P2R-K: 返回求解结果
const createProblemResultMessage = (options = {}) => {
  return createMessage(
    MessageType.PROBLEM_RESULT,
    {
      problemId: options.problemId,
      ok: options.ok !== false,
      answer: options.answer || '',
      method: options.method || '',
      size: options.size || 0,
      duration: options.duration || 0,
      fromBridge: options.fromBridge || '',
    },
    { priority: options.priority || 'HIGH', ttl: 60000, ...options }
  );
};

// 序列化消息（用于网络传输）
const serializeMessage = (message) => {
  return JSON.stringify(message);
};

// 反序列化消息
const deserializeMessage = (data) => {
  try {
    return JSON.parse(data);
  } catch (error) {
    logger.error(`[P2P] Message deserialization error: ${error.message}`);
    return null;
  }
};

// 验证消息格式
const validateMessage = (message) => {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  if (!message.type || !isValidMessageType(message.type)) {
    return { valid: false, error: `Invalid or missing message type` };
  }

  if (!message.payload) {
    return { valid: false, error: 'Missing payload' };
  }

  return { valid: true };
};

const createBodyNeedMessage = (options = {}) => {
  return createMessage(MessageType.HOUSE_NEED, {
    action: options.action, residentName: options.residentName,
    residentId: options.residentId, hostId: options.hostId || '',
    healthScore: options.healthScore, alerts: options.alerts || [],
    source: options.source || ''
  }, { priority: 'HIGH', ...options });
};

const createBodySeekMessage = (options = {}) => {
  return createMessage(MessageType.HOUSE_SEEK, { ...options }, { ...options });
};

const createSafeBodyVerify = (options = {}) => {
  return createMessage(MessageType.SAFE_HOUSE_VERIFY || 'safe_house_verify', {
    houseId: options.houseId, health: options.health || 100,
    hostId: options.hostId || '', lastActivity: options.lastActivity
  }, { ...options });
};

export {
  MessageType,
  isValidMessageType,
  createMessage,
  createSkillPublishMessage,
  createSkillRequestMessage,
  createCollaborationRequestMessage,
  createCollaborationResponseMessage,
  createInsightShareMessage,
  createPerformanceReportMessage,
  createBridgeSpawnRequest,
  createSafeHouseVerify,
  createBridgeUpgradeMessage,
  createResidentTransferMessage,
  createHouseSeekMessage,
  createHouseNeedMessage,
  createProposeChangeMessage,
  createVerifyResultMessage,
  createChangeAppliedMessage,
  createLLMProxyRequest,
  createLLMProxyResponse,
  createLLMAvailableMessage,
  createLLMProviderQueryMessage,
  createProblemSolveMessage,
  createProblemResultMessage,
  createBodyNeedMessage,
  createBodySeekMessage,
  createSafeBodyVerify,
  serializeMessage,
  deserializeMessage,
  validateMessage
};