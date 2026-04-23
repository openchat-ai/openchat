/**
 * P2P Message Types
 * 定义 6 种 P2P 消息类型
 */

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
  PERFORMANCE_REPORT: 'performance_report'
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

// 序列化消息（用于网络传输）
const serializeMessage = (message) => {
  return JSON.stringify(message);
};

// 反序列化消息
const deserializeMessage = (data) => {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error(`[P2P] Message deserialization error: ${error.message}`);
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

module.exports = {
  MessageType,
  isValidMessageType,
  createMessage,
  createSkillPublishMessage,
  createSkillRequestMessage,
  createCollaborationRequestMessage,
  createCollaborationResponseMessage,
  createInsightShareMessage,
  createPerformanceReportMessage,
  serializeMessage,
  deserializeMessage,
  validateMessage
};