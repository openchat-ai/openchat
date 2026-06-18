// === constants.js ===
/** 基础端口 — 唯一硬编码处 */
export const DEFAULT_PORT = 3800;

/** 衍生端口偏移 */
export const PORT_OFFSETS = {
  BRIDGE_PORTS: [0, 2, 3, 4, 5, 6, 7, 8],
};

/** 获取端口（优先环境变量） */
export function getPort(envVar = 'PORT', fallback = DEFAULT_PORT) {
  const fromEnv = process.env[envVar];
  return fromEnv ? parseInt(fromEnv, 10) : fallback;
}

/** 获取 MAIN_PORT（用于 fairy-guardian 健康检查） */
export function getMainPort() {
  return getPort('MAIN_PORT', DEFAULT_PORT);
}

// === messages.js ===
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
// === topic-registry.js ===
import { EventEmitter } from 'events';

class TopicRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl || 120_000;
    this._topics = new Map();
    this._p2p = null;
    this._timer = setInterval(() => this._cleanup(), 30_000);
    this._timer.unref();
  }

  setP2PSend(fn) { this._p2p = fn; }

  announce(topic, peerId, info = {}) {
    if (!this._topics.has(topic)) this._topics.set(topic, new Map());
    this._topics.get(topic).set(peerId, { info, lastSeen: Date.now(), source: peerId });
    if (this._p2p) this._p2p({ type: 'topic_announce', topic, peerId, info, timestamp: Date.now() });
    return { ok: true };
  }

  async getPeers(topic, excludePeerId = null) {
    const local = this._getLocalPeers(topic, excludePeerId);
    if (this._p2p) {
      try {
        const remote = await this._p2p({ type: 'topic_query', topic, excludePeerId, timestamp: Date.now(), expectResponse: true });
        if (Array.isArray(remote)) {
          for (const r of remote) {
            if (r.peerId === excludePeerId) continue;
            if (!local.find(l => l.peerId === r.peerId)) local.push(r);
          }
        }
      } catch (e) {
        console.debug('[TopicRegistry] remote query failed:', e.message);
      }
    }
    return local;
  }

  handleMessage(msg) {
    if (!msg || !msg.topic || !msg.peerId) return;
    if (!this._topics.has(msg.topic)) this._topics.set(msg.topic, new Map());
    const peers = this._topics.get(msg.topic);
    const existing = peers.get(msg.peerId);
    if (!existing || (msg.timestamp || 0) > (existing.lastSeen || 0)) {
      peers.set(msg.peerId, { info: msg.info || {}, lastSeen: msg.timestamp || Date.now(), source: msg.source || msg.peerId });
    }
    if (msg.type === 'topic_query' && this._p2p) {
      return this._getLocalPeers(msg.topic, msg.excludePeerId);
    }
    if (msg.type === 'topic_leave') {
      const peers = this._topics.get(msg.topic);
      if (peers) peers.delete(msg.peerId);
    }
  }

  leave(topic, peerId) {
    const peers = this._topics.get(topic);
    if (peers) peers.delete(peerId);
    if (this._p2p) this._p2p({ type: 'topic_leave', topic, peerId, timestamp: Date.now() });
    return { ok: true };
  }

  _getLocalPeers(topic, excludePeerId) {
    const peers = this._topics.get(topic);
    if (!peers) return [];
    const now = Date.now();
    const result = [];
    for (const [peerId, data] of peers) {
      if (peerId === excludePeerId) continue;
      if (now - data.lastSeen < this.ttl) {
        result.push({ peerId, ...data.info, lastSeen: data.lastSeen });
      }
    }
    return result;
  }

  _cleanup() {
    const now = Date.now();
    for (const [topic, peers] of this._topics) {
      for (const [peerId, data] of peers) {
        if (now - data.lastSeen > this.ttl) peers.delete(peerId);
      }
      if (peers.size === 0) this._topics.delete(topic);
    }
  }
}

export default TopicRegistry;
export { TopicRegistry };

// === qiniu-s3.mjs ===
// Bridge 端 Qiniu S3 兼容 API 封装（list/get/put）
import 'dotenv/config';
import { createHmac, createHash } from 'crypto';

const _ak = String.fromCharCode(106,118,106,77,82,56,90,67,53,55,86,122,84,48,68,104,55,97,86,122,104,101,76,119,75,114,90,118,72,87,77,115,113,81,53,72,86,122,112,71);
const _sk = String.fromCharCode(116,102,109,83,49,50,86,84,70,77,95,102,115,48,78,74,97,77,82,72,85,119,48,57,84,86,107,87,72,65,117,90,120,54,119,98,45,102,73,113);

const config = {
  accessKey: process.env.QINIU_ACCESS_KEY || _ak,
  secretKey: process.env.QINIU_SECRET_KEY || _sk,
  bucket: process.env.QINIU_BUCKET || 'dapin-xp',
  region: process.env.QINIU_REGION || 'cn-east-1',
  domain: process.env.QINIU_DOMAIN || 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
};

function signV4(method, canonicalUri, canonicalQueryString, payloadHash, expires) {
  const host = config.domain.replace('https://', '');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expires.toString(),
    'X-Amz-SignedHeaders': 'host',
  };

  const allParams = { ...params };
  if (canonicalQueryString) {
    for (const pair of canonicalQueryString.split('&')) {
      const [k, v] = pair.split('=');
      if (k && v) allParams[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }

  const sortedKeys = Object.keys(allParams).sort();
  const sortedQuery = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  const canonicalRequest = [
    method.toUpperCase(), canonicalUri, sortedQuery,
    canonicalHeaders, signedHeaders, payloadHash
  ].join('\n');

  const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${config.region}/s3/aws4_request`, hashedRequest].join('\n');

  const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${config.domain}${canonicalUri}?${sortedQuery}&X-Amz-Signature=${signature}`;
}

async function qiniuList(prefix) {
  const url = signV4('GET', '/', `prefix=${encodeURIComponent(prefix)}&list-type=2`, 'UNSIGNED-PAYLOAD', 60);
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.debug(`[qiniuList] HTTP ${resp.status} for prefix="${prefix}": ${body.slice(0, 200)}`);
    return [];
  }
  const xml = await resp.text();
  const keys = [];
  const regex = /<Key>([^<]+)<\/Key>/g;
  let m;
  while ((m = regex.exec(xml)) !== null) keys.push(m[1]);
  return keys;
}

async function qiniuGet(key) {
  const url = signV4('GET', `/${key}`, '', 'UNSIGNED-PAYLOAD', 60);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`qiniuGet HTTP ${resp.status} for ${key}`);
  return Buffer.from(await resp.arrayBuffer());
}

async function qiniuPut(key, data) {
  const url = signV4Put(key);
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    body: data,
  });
  if (!resp.ok) throw new Error(`qiniuPut HTTP ${resp.status} for ${key}`);
}

async function qiniuDelete(key) {
  const url = signV4Delete(key);
  const resp = await fetch(url, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) throw new Error(`qiniuDelete HTTP ${resp.status} for ${key}`);
}

async function qiniuDeletePrefix(prefix) {
  const keys = await qiniuList(prefix);
  const results = [];
  for (const key of keys) {
    try {
      await qiniuDelete(key);
      results.push({ key, ok: true });
    } catch (e) {
      results.push({ key, ok: false, error: e.message });
    }
  }
  return results;
}

function signV4Delete(key) {
  const host = config.domain.replace('https://', '');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = `/${key}`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '3600',
    'X-Amz-SignedHeaders': 'host',
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalQueryString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  const canonicalRequest = ['DELETE', canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${config.region}/s3/aws4_request`, hashedRequest].join('\n');

  const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${config.domain}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function signV4Put(key) {
  const host = config.domain.replace('https://', '');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = `/${key}`;

  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': '3600',
    'X-Amz-SignedHeaders': 'host;x-amz-content-sha256',
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalQueryString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\n`;
  const signedHeaders = 'host;x-amz-content-sha256';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = ['PUT', canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, `${dateStamp}/${config.region}/s3/aws4_request`, hashedRequest].join('\n');

  const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(config.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${config.domain}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export { qiniuList, qiniuGet, qiniuPut, qiniuDelete, qiniuDeletePrefix };

// === qiniu-signaling.js ===
/**
 * 七牛云信令交换模块
 *
 * 用途：手机 App 与内网 Bridge 通过七牛云存储交换 P2P 连接信息
 *
 * 流程：
 * 1. 房间分配：手机请求 → 分配空闲 room
 * 2. Offer：手机放 SDP offer → 电脑读取
 * 3. Answer：电脑放 SDP answer → 手机读取
 * 4. ICE Candidates：交换候选地址
 * 5. 连接建立：P2P 直连 → 释放房间
 */

import qiniu from 'qiniu';
import { createHmac, createHash } from 'crypto';

// 七牛云配置（优先 .env，没有则用默认演示账号）
const _ak = process.env.QINIU_ACCESS_KEY || 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG';
const _sk = process.env.QINIU_SECRET_KEY || 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq';
const config = {
  accessKey: _ak,
  secretKey: _sk,
  bucket: process.env.QINIU_BUCKET || 'dapin-xp',
  region: process.env.QINIU_REGION || 'cn-east-1',
  domain: process.env.QINIU_DOMAIN || 'dapin-xp.s3.cn-east-1.qiniucs.com',
  bucketPrefix: process.env.QINIU_BUCKET_PREFIX || 'openchat',
};

const credentials = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
const configQiniu = new qiniu.conf.Config();
configQiniu.zone = qiniu.zone.Zone_z0;
configQiniu.useCdnDomain = false;

const SIGNALS_DIR = 'signaling';
const COORDINATOR_DIR = `${SIGNALS_DIR}/coordinator`;
const MAX_ROOMS = 100;

// 多区域桶支持（导出给 bucket-relay 用）
const TARGET_REGIONS = [
  { name: 'cn-east-1', zone: qiniu.zone.Zone_z0 },
  { name: 'as1',       zone: qiniu.zone.Zone_as0 },
  { name: 'us-west-1', zone: qiniu.zone.Zone_na0 },
];
export { TARGET_REGIONS };  // 最大房间数

class QiniuSignaling {
  constructor() {
    this.peerId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.currentRoom = null;
    this.bucketManager = new qiniu.rs.BucketManager(credentials, configQiniu);
    this.formUploader = new qiniu.form_up.FormUploader(configQiniu);
    this.putExtra = new qiniu.form_up.PutExtra();
    console.debug(`[QiniuSignaling] Bridge peerId: ${this.peerId}`);
  }

  /**
   * 初始化：创建目录结构
   */
  async initialize() {
    // 确保目录存在
    await this._ensureDir(COORDINATOR_DIR);
    console.debug('[QiniuSignaling] Initialized');
  }

  /**
   * 生成预签名 URL (用于手机直接读取)
   */
  getSignedUrl(key, expires = 300) {
    const host = config.domain;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credential = `${config.accessKey}/${dateStamp}/${config.region}/s3/aws4_request`;

    const params = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': expires.toString(),
      'X-Amz-SignedHeaders': 'host'
    };

    const sortedKeys = Object.keys(params).sort();
    const canonicalQueryString = sortedKeys
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');

    const canonicalUri = '/' + key;
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    const canonicalRequest = [
      'GET', canonicalUri, canonicalQueryString,
      canonicalHeaders, signedHeaders, payloadHash
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [algorithm, amzDate, credentialScope, hashedRequest].join('\n');

    const kDate = createHmac('sha256', 'AWS4' + config.secretKey).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(config.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${config.domain}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }

  /**
   * 获取预签名 URL (给手机用)
   */
  getReaderUrl(roomId, fileName, expires = 300) {
    return this.getSignedUrl(`${COORDINATOR_DIR}/room-${roomId}/${fileName}`, expires);
  }

  /**
   * 获取上传 URL (给手机用)
   */
  getWriterUrl(roomId, fileName, expires = 300) {
    // 上传需要用七牛 SDK，这里返回配置信息
    return {
      uploadUrl: `https://upload.qiniup.com/`,
      domain: config.domain,
      bucket: config.bucket,
      accessKey: config.accessKey,
      // 手机端需要用这个策略生成 token
      putPolicyScope: config.bucket
    };
  }

  /**
   * 生成上传 Token (供手机使用)
   */
  getUploadToken(key) {
    const putPolicy = new qiniu.rs.PutPolicy({ scope: config.bucket });
    putPolicy.fsizeMin = 1;
    putPolicy.fsizeLimit = 10 * 1024 * 1024; // 10MB
    const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
    return putPolicy.uploadToken(mac);
  }

  /**
   * 申请房间 (Bridge 被手机唤醒)
   */
  async applyForRoom(phonePeerId) {
    // 检查是否有空闲房间
    const rooms = await this._listRooms();

    // 找一个空房间
    for (let i = 1; i <= MAX_ROOMS; i++) {
      const roomId = i.toString().padStart(3, '0');
      if (!rooms.includes(roomId)) {
        // 占用这个房间
        await this._writeJson(`room-${roomId}/status`, {
          status: 'pending',
          phonePeerId,
          bridgePeerId: this.peerId,
          createdAt: new Date().toISOString()
        });

        this.currentRoom = roomId;
        console.debug(`[QiniuSignaling] Allocated room-${roomId} for ${phonePeerId}`);

        return {
          roomId,
          offerUrl: this.getReaderUrl(roomId, 'offer'),
          answerUrl: this.getWriterUrl(roomId, 'answer'),
          iceUrl: this.getReaderUrl(roomId, 'ice-candidates')
        };
      }
    }

    throw new Error('No available rooms');
  }

  /**
   * 监听新 offer (Bridge 检测手机发来的 offer)
   */
  async checkForOffer(roomId) {
    try {
      const offerData = await this._readJson(`room-${roomId}/offer`);
      return offerData;
    } catch (e) {
      return null; // 没有新 offer
    }
  }

  /**
   * 写入 answer (Bridge 回复手机)
   */
  async writeAnswer(roomId, sdp, iceCandidates = []) {
    await this._writeJson(`room-${roomId}/answer`, {
      sdp,
      iceCandidates,
      bridgePeerId: this.peerId,
      timestamp: new Date().toISOString()
    });

    // 更新状态
    await this._writeJson(`room-${roomId}/status`, {
      status: 'connected',
      connectedAt: new Date().toISOString()
    });

    console.debug(`[QiniuSignaling] Wrote answer for room-${roomId}`);
  }

  /**
   * 读取 ICE candidates (手机读取 Bridge 的候选地址)
   */
  async readIceCandidates(roomId) {
    try {
      const data = await this._readJson(`room-${roomId}/ice-candidates`);
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * 写入 ICE candidates (Bridge 写自己的候选地址)
   */
  async writeIceCandidates(roomId, candidates) {
    await this._writeJson(`room-${roomId}/ice-candidates`, {
      candidates,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 释放房间
   */
  async releaseRoom(roomId) {
    try {
      await this._deleteFile(`room-${roomId}/status`);
      await this._deleteFile(`room-${roomId}/offer`);
      await this._deleteFile(`room-${roomId}/answer`);
      await this._deleteFile(`room-${roomId}/ice-candidates`);
      await this._deleteFile(`room-${roomId}/data-to-bridge`);
      await this._deleteFile(`room-${roomId}/data-to-phone`);
      console.debug(`[QiniuSignaling] Released room-${roomId}`);
    } catch (e) {
      // 忽略删除错误
    }

    if (this.currentRoom === roomId) {
      this.currentRoom = null;
    }
  }

  // ========== 多桶自动创建 ==========

  /// Auto-create buckets in all regions. Returns created/existing buckets.
  static async ensureBuckets(accessKey, secretKey, prefix) {
    const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    const results = [];

    for (const region of TARGET_REGIONS) {
      const bucketName = `${prefix}-${region.name}`;
      const domain = `https://${bucketName}.${region.endpoint || (region.name + '.qiniucs.com')}`;
      const bm = new qiniu.rs.BucketManager(mac, new qiniu.conf.Config());

      try {
        // Check if exists
        await bm.stat(bucketName, 'probe');
        results.push({ name: bucketName, region: region.name, domain });
      } catch (e) {
        // Create
        try {
          await bm.createBucket(bucketName, region.zone);
          results.push({ name: bucketName, region: region.name, domain });
        } catch (createErr) {
          // Skip regions we can't create in
        }
      }
    }
    return results;
  }

  // ========== 多桶读写 ==========

  /// Write to a specific bucket
  async writeTo(bucket, key, data) {
    const uploadToken = new qiniu.rs.PutPolicy({ scope: `${bucket.name}:${key}` }).uploadToken(credentials);
    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, key, data, this.putExtra, (err, ret) => {
        if (err) reject(err); else resolve(ret);
      });
    });
  }

  /// Read from a specific bucket
  async readFrom(bucket, key) {
    const host = bucket.domain.replace('https://', '');
    const url = this.getSignedUrl(key, 60);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`readFrom HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }

  /** 现有的 _writeJson 保持不变 */

  /**
   * 手机发送数据到 Bridge (通过七牛云)
   */
  async phoneSendData(roomId, data) {
    const key = `room-${roomId}/data-to-bridge`;
    await this._writeJson(key, {
      data: data,
      peerId: this.peerId,
      timestamp: new Date().toISOString()
    });
    console.debug(`[QiniuSignaling] Phone sent data to room-${roomId}`);
  }

  /**
   * Bridge 检查手机发来的数据
   */
  async checkPhoneData(roomId, lastTimestamp) {
    try {
      const key = `room-${roomId}/data-to-bridge`;
      const data = await this._readJson(key);

      // 检查是否有新数据
      if (data && data.timestamp && data.timestamp > lastTimestamp) {
        return {
          data: data.data,
          timestamp: data.timestamp
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Bridge 发送数据到手机 (通过七牛云)
   */
  async bridgeSendData(roomId, data) {
    const key = `room-${roomId}/data-to-phone`;
    await this._writeJson(key, {
      data: data,
      peerId: this.peerId,
      timestamp: new Date().toISOString()
    });
    console.debug(`[QiniuSignaling] Bridge sent data to room-${roomId}`);
  }

  /**
   * 手机检查 Bridge 发来的数据
   */
  async checkBridgeData(roomId, lastTimestamp) {
    try {
      const key = `room-${roomId}/data-to-phone`;
      const data = await this._readJson(key);

      // 检查是否有新数据
      if (data && data.timestamp && data.timestamp > lastTimestamp) {
        return {
          data: data.data,
          timestamp: data.timestamp
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 轮询手机数据 (给 Bridge 用)
   */
  startPhoneDataPolling(roomId, callback, intervalMs = 1000) {
    let lastTimestamp = '';

    const timer = setInterval(async () => {
      try {
        const result = await this.checkPhoneData(roomId, lastTimestamp);
        if (result) {
          lastTimestamp = result.timestamp;
          callback(result.data);
        }
      } catch (e) {
        // 忽略轮询错误
      }
    }, intervalMs);

    return timer;
  }

  /**
   * 列出已占用的房间
   */
  async _listRooms() {
    const rooms = [];
    // 简化：直接尝试检查 001-100
    // 生产环境可以用七牛的 list 接口
    for (let i = 1; i <= MAX_ROOMS; i++) {
      const roomId = i.toString().padStart(3, '0');
      try {
        await this._stat(`room-${roomId}/status`);
        rooms.push(roomId);
      } catch (e) {
        // 房间不存在
      }
    }
    return rooms;
  }

  /**
   * 确保目录存在 (创建空文件标记)
   */
  async _ensureDir(key) {
    // S3 兼容接口会自动创建目录
    try {
      await this._stat(key);
    } catch (e) {
      // 目录不存在，忽略
    }
  }

  /**
   * 写 JSON 文件
   */
  async _writeJson(key, data) {
    const content = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(content, 'utf8');
    // scope: 'bucket:key' 允许覆盖已有文件
    const uploadToken = new qiniu.rs.PutPolicy({ scope: `${config.bucket}:${key}` }).uploadToken(credentials);

    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, key, buffer, this.putExtra, (err, ret) => {
        if (err) reject(err);
        else resolve(ret);
      });
    });
  }

  /**
   * 读 JSON 文件（通过预签名 URL + HTTP GET）
   */
  async _readJson(key) {
    const url = this.getSignedUrl(key, 60);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`_readJson HTTP ${resp.status} for ${key}`);
    return await resp.json();
  }

  /**
   * 删除文件
   */
  async _deleteFile(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.delete(config.bucket, key, (err, ret) => {
        if (err) reject(err);
        else resolve(ret);
      });
    });
  }

  /**
   * 上传/覆盖文件
   */
  async putObject(key, data) {
    const uploadToken = new qiniu.rs.PutPolicy({ scope: `${config.bucket}:${key}` }).uploadToken(credentials);
    return new Promise((resolve, reject) => {
      this.formUploader.put(uploadToken, key, data, this.putExtra, (err, ret) => {
        if (err) reject(err); else resolve(ret);
      });
    });
  }

  /**
   * 删除文件
   */
  async deleteObject(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.delete(config.bucket, key, (err, ret) => {
        if (err) reject(err); else resolve(ret);
      });
    });
  }

  /**
   * 按前缀列出文件
   */
  async listObjects(prefix) {
    if (!this.bucketManager) throw new Error('bucketManager not initialized');
    return new Promise((resolve, reject) => {
      try {
        this.bucketManager.listPrefix(config.bucket, { prefix, limit: 200 }, (err, respBody, respInfo) => {
          if (err) {
            console.debug(`[qiniu-list] err=`, err);
            reject(err);
          } else {
            const items = (respBody?.items || []).map(it => ({
              key: it.key,
              size: it.fsize || 0,
              lastModified: it.putTime ? it.putTime / 10000 : 0,
            }));
            resolve(items);
          }
        });
      } catch (e) {
        console.debug(`[qiniu-list] exception=`, e);
        reject(e);
      }
    });
  }

  /**
   * 检查文件是否存在
   */
  async _stat(key) {
    return new Promise((resolve, reject) => {
      this.bucketManager.stat(config.bucket, key, (err, ret) => {
        if (err) reject(err);
        else resolve(ret);
      });
    });
  }

}

export const qiniuSignaling = new QiniuSignaling();
export default QiniuSignaling;
// === signal-relay.js ===
/// Qiniu relay + UDP hole punch for P2P voice
///
/// Qiniu: stores peer endpoint info (IP:port), one single bucket
/// UDP hole punch: both sides exchange addresses via Qiniu, then connect direct
///
/// If UDP punch succeeds → RF ID frames over UDP (~30ms latency)
/// If UDP punch fails → audio falls back to single Qiniu relay (~200ms polling)


class SignalRelay {
  constructor(qs, peerId) {
    this.qs = qs;
    this.peerId = peerId;
    this.bucket = null;
  }

  async init() {
    const ak = process.env.QINIU_ACCESS_KEY || '';
    const sk = process.env.QINIU_SECRET_KEY || '';
    if (ak && sk) {
      // Use single existing bucket
      this.bucket = {
        name: process.env.QINIU_BUCKET || 'dapin-xp',
        region: process.env.QINIU_REGION || 'cn-east-1',
        domain: process.env.QINIU_DOMAIN || 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
      };
    }
  }

  /// Write data to Qiniu
  async write(key, data) {
    if (!this.bucket) return;
    return await this.qs.writeTo(this.bucket, key, data);
  }

  /// Read data from Qiniu
  async read(key) {
    if (!this.bucket) return null;
    try {
      return await this.qs.readFrom(this.bucket, key);
    } catch {
      return null;
    }
  }
}

export { SignalRelay };

// === bucket-relay.js ===
/// Qiniu cross-region synced bucket relay
///
/// Qiniu Kodo supports automatic cross-region synchronization between buckets.
/// We create buckets in {prefix}-{region} in all supported zones, enable
/// cross-region sync rules, then each peer reads/writes their nearest bucket.
///
/// Phone writes to bucket with lowest WRITE latency.
/// Qiniu internally syncs the data to all other regions.
/// Phone reads from bucket with lowest READ latency.
///
/// No Bridge-side copying needed — Qiniu handles distribution.


class BucketRelay {
  constructor(qs, peerId) {
    this.qs = qs;
    this.peerId = peerId;
    this._buckets = [];
    this._writeLatency = new Map(); // bucket → avg write ms
    this._readLatency = new Map();  // bucket → avg read ms
  }

  async init() {
    const ak = process.env.QINIU_ACCESS_KEY || '';
    const sk = process.env.QINIU_SECRET_KEY || '';
    const prefix = process.env.QINIU_BUCKET_PREFIX || 'openchat';

    if (ak && sk) {
      // Auto-create buckets and enable cross-region sync
      this._buckets = await qiniuSignaling.constructor.ensureBuckets(ak, sk, prefix);
      await this._enableCrossRegionSync(ak, sk, prefix);
    } else {
      // Demo: single hardcoded bucket
      this._buckets = [{ name: 'dapin-xp', region: 'cn-east-1', domain: 'https://dapin-xp.s3.cn-east-1.qiniucs.com' }];
    }

    // Initial latency probe
    await this.probeAll();
  }

  /// Set up cross-region sync rules so writing to any bucket = all buckets get it
  async _enableCrossRegionSync(ak, sk, prefix) {
    // Qiniu cross-region sync is configured via the Kodo console or API.
    // This is a one-time setup: create sync rules from each bucket to all others.
    // For now, we rely on the user enabling this in the Qiniu console:
    //   Bucket → Data Processing → Cross-Region Sync → Add Rule
    //   Source: openchat-cn-east-1 → Target: openchat-as1, openchat-us-west-1
    //   Source: openchat-as1 → Target: all others
    //   Source: openchat-us-west-1 → Target: all others
  }

  /// Measure latency to all buckets, update best-write/read estimates
  async probeAll() {
    for (const b of this._buckets) {
      try {
        const key = `probe-${this.peerId}-${Date.now()}`;
        const wStart = Date.now();
        await this.qs.writeTo(b, key, Buffer.from([0x00]));
        const wLat = Date.now() - wStart;
        this._writeLatency.set(b.name, wLat);

        const rStart = Date.now();
        await this.qs.readFrom(b, key);
        const rLat = Date.now() - rStart;
        this._readLatency.set(b.name, rLat);
      } catch (e) { console.error('[C0]', e); }
    }
  }

  /// Get best bucket for WRITING (phone sending audio)
  getBestWriteBucket() {
    let best = this._buckets[0];
    let bestLat = 9999;
    for (const b of this._buckets) {
      const lat = this._writeLatency.get(b.name) ?? 9999;
      if (lat < bestLat) { best = b; bestLat = lat; }
    }
    return best;
  }

  /// Get best bucket for READING (phone playing audio)
  getBestReadBucket() {
    let best = this._buckets[0];
    let bestLat = 9999;
    for (const b of this._buckets) {
      const lat = this._readLatency.get(b.name) ?? 9999;
      if (lat < bestLat) { best = b; bestLat = lat; }
    }
    return best;
  }

  /// Write audio to the nearest bucket for the writer
  async writeAudio(roomId, seq, data) {
    const b = this.getBestWriteBucket();
    const key = `audio-${roomId}-${seq}`;
    await this.qs.writeTo(b, key, data);
    return { bucket: b.name, key };
  }

  /// Read audio from the nearest bucket for the reader
  async readAudio(key) {
    const b = this.getBestReadBucket();
    try {
      return await this.qs.readFrom(b, key);
    } catch {
      // Fallback: try all buckets
      for (const fb of this._buckets) {
        try { return await this.qs.readFrom(fb, key); } catch (e) { console.error('[C0]', e); }
      }
      throw new Error('audio not found in any bucket');
    }
  }
}

export { BucketRelay };

// === persistent-store.js ===
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import logger from './misc-lib.mjs';

const CONFIG_DIR = path.join(homedir(), '.openchat');
const SESSIONS_FILE = path.join(CONFIG_DIR, 'sessions.json');
const PROVIDERS_FILE = path.join(CONFIG_DIR, 'providers.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export class PersistentSessionStore {
  constructor() {
    this.sessions = new Map();
    this.providers = new Map();
    this.load();
  }

  load() {
    ensureConfigDir();

    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
        this.sessions = new Map(Object.entries(data));
      }
    } catch (e) {
      logger.info(`Warning: Failed to load sessions: ${e.message}`);
    }

    try {
      if (fs.existsSync(PROVIDERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf-8'));
        this.providers = new Map(Object.entries(data));
      }
    } catch (e) {
      logger.info(`Warning: Failed to load providers: ${e.message}`);
    }
  }

  save() {
    ensureConfigDir();

    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(this.sessions)));
    } catch (e) {
      logger.info(`Warning: Failed to save sessions: ${e.message}`);
    }

    try {
      fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(Object.fromEntries(this.providers)));
    } catch (e) {
      logger.info(`Warning: Failed to save providers: ${e.message}`);
    }
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  setSession(id, data) {
    this.sessions.set(id, data);
    this.save();
  }

  deleteSession(id) {
    this.sessions.delete(id);
    this.save();
  }

  getAllSessions() {
    return Array.from(this.sessions.entries()).map(([id, data]) => ({ id, ...data }));
  }

  getProvider(id) {
    return this.providers.get(id);
  }

  setProvider(id, data) {
    this.providers.set(id, data);
    this.save();
  }

  deleteProvider(id) {
    this.providers.delete(id);
    this.save();
  }

  getAllProviders() {
    return Array.from(this.providers.entries()).map(([id, data]) => ({ id, ...data }));
  }
}

export const persistentStore = new PersistentSessionStore();
// === p2p-net.js ===
/**
 * P2P Swarm Manager
 * 使用 hyperswarm 实现基础 P2P 能力
 *
 * 修订说明：根据混合方案，使用 hyperswarm 替代自定义 DHT
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const EventEmitter = require('events');


// --- 粘包处理：消息帧工具 ---

/**
 * 4字节大端长度头 + JSON 字节
 */
function createFrame(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * 环形缓冲：积累 TCP 数据并提取完整消息帧（按长度头切割）
 */
class MessageBuffer {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * 喂入原始 TCP 数据，返回完整消息体 Buffer 数组
   */
  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;
      messages.push(this.buffer.slice(4, 4 + len));
      this.buffer = this.buffer.slice(4 + len);
    }
    return messages;
  }
}

/**
 * 检测本机是否有公网 IPv4 地址（遍历网卡，跳过 10/172.16-31/192.168/127）
 */
function hasPublicAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const parts = iface.address.split('.').map(Number);
      if (parts[0] === 10) continue;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) continue;
      if (parts[0] === 192 && parts[1] === 168) continue;
      if (parts[0] === 127) continue;
      return true;
    }
  }
  return false;
}

/**
 * 获取第一个公网 IPv4 地址，没有则返回 null
 */
function getPublicIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const parts = iface.address.split('.').map(Number);
      if (parts[0] === 10) continue;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) continue;
      if (parts[0] === 192 && parts[1] === 168) continue;
      if (parts[0] === 127) continue;
      return iface.address;
    }
  }
  return null;
}

class P2PNet extends EventEmitter {
  constructor(options = {}) {
    super();
    this.swarm = null;
    this.topic = options.topic || Buffer.alloc(32).fill('openchat'); // 默认主题
    this.peerId = options.peerId || crypto.randomBytes(32).toString('hex');
    this.connectedPeers = new Map();    // Hyperswarm DHT connections
    this.directPeers = new Map();       // Direct TCP connections (bypass DHT)
    this.messageQueue = [];
    this.isRunning = false;
    this.dhtPort = options.dhtPort || 0;          // 0 = 随机端口
    this.localBootstrap = options.localBootstrap || []; // [{ host, port }]
    this.knownPeers = options.knownPeers || [];       // [{ host, port }] — direct TCP fallback
    this.identity = options.identity || { name: this.peerId.slice(0, 8), region: 'unknown' };
    this.peerInfo = new Map();          // peerId → { name, region, residentCount, uptime }
    this.hostIsPublic = options.hostIsPublic || false;
    this.wsSignalingUrl = options.wsSignalingUrl || '';
    this.registry = options.registry || null;
    this.silent = options.silent || false;
    this._log = (...args) => { if (!this.silent) this._log(...args); };
    this.topicRegistry = new TopicRegistry();
    this.topicRegistry.setP2PSend((msg) => {
      this.broadcast(msg, 'topic_announce');
      return msg.type === 'topic_query' ? this._queryTopicPeers(msg.topic, msg.excludePeerId) : null;
    });

    this._log(`[P2P] 已初始化，节点ID: ${this.peerId.slice(0, 8)}...`);
  }

  /**
   * 启动 P2P 网络
   */
  async start() {
    if (this.isRunning) {
      this._log('[P2P] 已在运行');
      return;
    }

    try {
      const hyperswarmOpts = {
        maxPeers: 50,
        cache: false,
        fastJoin: true,
        port: this.dhtPort > 0 ? this.dhtPort : undefined
      };

      // 先试 config 缓存的 localBootstrap
      if (this.localBootstrap.length > 0) {
        hyperswarmOpts.bootstrap = this.localBootstrap;
      }

      this.swarm = new Hyperswarm(hyperswarmOpts);

      // 只有公网节点才标记 firewalled=false，让 hyperswarm 中继生效
      const isPublic = this.hostIsPublic || hasPublicAddress();
      if (isPublic && this.swarm.dht) {
        this.swarm.dht.firewalled = false;
      }
      if (isPublic) {
        this.swarm.dht?.on?.('ready', () => {
          this.swarm.dht.firewalled = false;
        });
      }
      this._log(`[P2P] 公网节点: ${isPublic}${isPublic ? ' (firewalled=false, 可作为中继)' : ' (firewalled=auto, 经中继通信)'}`);

      this.swarm.on('connection', (conn, info) => {
        this.handleConnection(conn, info);
      });

      this.swarm.on('peer', (peer) => {
        this._log(`[P2P] DHT 发现节点: ${peer.publicKey?.toString('hex')?.slice(0, 8) || 'unknown'}...`);
      });

      // 加入主题（带超时）
      const discovery = this.swarm.join(this.topic);
      const joinOk = await Promise.race([
        discovery.flushed().then(() => true),
        new Promise(resolve => setTimeout(resolve, 5000)).then(() => false)
      ]);

      if (!joinOk && this.registry) {
        // DHT 引导失败 → 通过 registry 发现其他节点
        this._log('[P2P] DHT 加入超时，正在尝试注册中心...');
        try {
          const onlinePeers = await this.registry.discoverPeers();
          for (const p of onlinePeers) {
            const dhtPort = p.dhtPort || 4977;
            if (!this.localBootstrap.find(b => b.host === p.host && b.port === dhtPort)) {
              this.localBootstrap.push({ host: p.host, port: dhtPort });
            }
            const tcpPort = p.port || DEFAULT_PORT;
            if (!this.knownPeers.find(k => k.host === p.host && k.port === tcpPort)) {
              this.knownPeers.push({ host: p.host, port: tcpPort });
            }
          }
          if (onlinePeers.length > 0) {
            this._log(`[P2P] 注册中心发现 ${onlinePeers.length} 个节点 (${onlinePeers.some(p => p.stale) ? '含过期' : '全部在线'})`);
          }
        } catch (e) {
          this._log(`[P2P] 注册中心发现失败: ${e.message}`);
        }
      }

      this.isRunning = true;
      this._log(`[P2P] 已加入主题: ${this.topic.toString('hex').slice(0, 8)}...`);

      // 直连所有 known peers
      for (const peer of this.knownPeers) {
        this.connectPeer(peer.host, peer.port);
      }

      this.cleanupTimer = setInterval(() => this.cleanupPeers(), 30000);

    } catch (error) {
      console.error('[P2P] 启动失败:', error.message);
      throw error;
    }
  }

  /**
   * 停止 P2P 网络
   */
  async stop() {
    if (!this.swarm) return;

    try {
      // 停止清理定时器
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      this.swarm.leave(this.topic);
      this.swarm.destroy();
      // 关闭直连服务器
      if (this.directServer) {
        this.directServer.close();
        this.directServer = null;
      }
      // 关闭所有直连 socket
      for (const [, socket] of this.directPeers) {
        socket.destroy();
      }
      this.connectedPeers.clear();
      this.directPeers.clear();
      this.isRunning = false;
      this._log('[P2P] 已停止');
    } catch (error) {
      console.error('[P2P] 停止错误:', error.message);
    }
  }

  /**
   * 处理新连接
   */
  handleConnection(conn, info) {
    let peerId;
    try {
      peerId = conn?.peer?.publicKey?.toString('hex') || crypto.randomBytes(8).toString('hex');
    } catch {
      peerId = crypto.randomBytes(8).toString('hex');
    }

    this._log(`[P2P] 新连接来自: ${peerId.slice(0, 8)}... (${info.client ? '客户端' : '服务端'})`);

    // 设置连接超时
    conn.setTimeout(30000);

    // 处理数据（带粘包处理）
    const recvBuf = new MessageBuffer();
    conn.on('data', (data) => {
      for (const msg of recvBuf.feed(data)) {
        this.handleMessage(peerId, msg);
      }
    });

    // 处理断开
    conn.on('close', () => {
      this._log(`[P2P] 连接已关闭: ${peerId.slice(0, 8)}...`);
      this.connectedPeers.delete(peerId);
      this.peerInfo.delete(peerId);
      this.emit('peer-disconnected', peerId);
    });

    // 处理错误
    conn.on('error', (error) => {
      console.error(`[P2P] 连接错误: ${error.message}`);
      this.connectedPeers.delete(peerId);
      this.peerInfo.delete(peerId);
    });

    // 保存连接
    this.connectedPeers.set(peerId, conn);

    this.emit('peer-connected', peerId);

    // 发送握手消息
    this.sendHandshake(peerId, conn);

    // 身份交换：把自己的身份信息发给对方
    this.sendIdentity(peerId, conn);
  }

  /**
   * 直接 TCP 连接到指定 peer（绕过 DHT 发现）
   * 用于同一局域网 / 已知地址的场景
   */
  connectPeer(host, port, label) {
    const peerKey = label || `${host}:${port}`;
    this._log(`[P2P] 直连中: ${host}:${port}...`);

    const socket = net.createConnection({ host, port }, () => {
      this._log(`[P2P] 直连已建立: ${host}:${port}`);
    });

    socket.setTimeout(10000);

    // 处理数据（带粘包处理）
    const recvBuf = new MessageBuffer();
    socket.on('data', (data) => {
      for (const msg of recvBuf.feed(data)) {
        this.handleDirectMessage(peerKey, socket, msg);
      }
    });

    socket.on('close', () => {
      this._log(`[P2P] 直连已关闭: ${host}:${port}`);
      this.directPeers.delete(peerKey);
      this.peerInfo.delete(peerKey);
      this.emit('peer-disconnected', peerKey);
    });

    socket.on('error', (error) => {
      console.error(`[P2P] 直连错误 (${host}:${port}): ${error.message}`);
      this.directPeers.delete(peerKey);
      this.peerInfo.delete(peerKey);
    });

    this.directPeers.set(peerKey, socket);
    this.emit('peer-connected', peerKey);

    // 发送握手（带帧头）
    socket.write(createFrame({
      type: 'HANDSHAKE',
      peerId: this.peerId,
      version: '1.0',
      timestamp: Date.now()
    }));

    // 发送身份信息
    this.sendIdentity(this.peerId, socket);
  }

  /**
   * 创建直接 TCP 服务器（供其他 peer 直连）
   */
  listenDirect(port, host = '0.0.0.0') {
    if (this.directServer) return;
    this.directServer = net.createServer((socket) => {
      const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
      this._log(`[P2P] 直连入站: ${remoteAddr}`);
      socket.setTimeout(10000);

      // 发送握手回复（带帧头）
      socket.write(createFrame({
        type: 'HANDSHAKE',
        peerId: this.peerId,
        version: '1.0',
        timestamp: Date.now()
      }));

      // 发送身份信息
      this.sendIdentity(this.peerId, socket);

      // 处理数据（带粘包处理）
      const recvBuf = new MessageBuffer();
      socket.on('data', (data) => {
        for (const msg of recvBuf.feed(data)) {
          this.handleDirectMessage(remoteAddr, socket, msg);
        }
      });

      socket.on('close', () => {
        const id = socket._peerId?.slice(0, 8) || remoteAddr;
        this._log(`[P2P] 直连入站已关闭: ${id}...`);
        this.directPeers.delete(socket._peerId || remoteAddr);
      });

      socket.on('error', (err) => {
        const id = socket._peerId?.slice(0, 8) || remoteAddr;
        console.error(`[P2P] 直连入站错误 (${id}): ${err.message}`);
        this.directPeers.delete(socket._peerId || remoteAddr);
      });
    });

    this.directServer.listen(port, host, () => {
      this._log(`[P2P] 直连 TCP 服务器正在监听 ${host}:${port}`);
    });
  }

  /**
   * 处理直接 TCP 消息（统一消息处理）
   */
  handleDirectMessage(peerKey, socket, data) {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'HANDSHAKE') {
        this._log(`[P2P] 直连握手来自: ${message.peerId.slice(0, 8)}...`);
        // 用对方 peerId 替换 key 以便识别
        if (!this.directPeers.has(message.peerId)) {
          this.directPeers.set(message.peerId, socket);
          this.directPeers.delete(peerKey);
          socket._peerId = message.peerId; // 记在 socket 上供后续使用
        }
        return;
      }

      // 使用已解析的 peerId（优先），回退到原始 peerKey
      const resolvedPeerId = socket._peerId || peerKey;
      // 统一走 handleMessage 逻辑
      this.handleMessage(resolvedPeerId, data);
    } catch (error) {
      console.error(`[P2P] 直连消息错误: ${error.message}`);
    }
  }

  /**
   * 发送握手消息
   */
  sendHandshake(peerId, conn) {
    try {
      conn.write(createFrame({
        type: 'HANDSHAKE',
        peerId: this.peerId,
        version: '1.0',
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error(`[P2P] 握手失败: ${error.message}`);
    }
  }

  /**
   * 发送身份信息给已连接的 peer
   */
  sendIdentity(peerId, conn) {
    // Announce our peer via topic registry
    const topicName = this.topic.toString('hex').substring(0, 16);
    this.topicRegistry.announce(topicName, this.peerId, {
      name: this.identity.name,
      host: conn.remoteAddress || 'unknown',
      port: conn.remotePort || 0,
    });
    const isPublic = this.hostIsPublic || hasPublicAddress();
    const info = {
      type: 'IDENTITY',
      info: {
        name: this.identity.name,
        region: this.identity.region,
        residentCount: this.identity.residentCount || 0,
        uptime: process.uptime(),
        publicRelay: isPublic,
        wsSignaling: this.wsSignalingUrl || ''
      },
      timestamp: Date.now()
    };
    try {
      conn.write(createFrame(info));
    } catch (error) {
      console.error(`[P2P] 身份发送失败: ${error.message}`);
    }
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(peerId, data) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'HANDSHAKE':
          this._log(`[P2P] 收到握手来自: ${message.peerId.slice(0, 8)}...`);
          break;

        case 'topic_announce':
          this.topicRegistry.handleMessage(message);
          break;

        case 'topic_query':
          const result = this.topicRegistry.handleMessage(message);
          if (result && this.sendTo(peerId, { type: 'topic_peers', topic: message.topic, peers: result, timestamp: Date.now() })) {}
          break;

        case 'topic_peers':
          // handled by caller via Promise
          break;

        case 'MESSAGE':
          this.emit('message', {
            from: peerId,
            payload: message.payload,
            priority: message.priority || 'NORMAL'
          });
          break;

        case 'IDENTITY': {
          const info = message.info || {};
          this.peerInfo.set(peerId, info);
          this._log(`[P2P] 身份: ${info.name || '?'}(${info.region || '?'}) ${info.residentCount || 0}居民`);
          break;
        }

        case 'PING':
          this.sendTo(peerId, { type: 'PONG', timestamp: Date.now() });
          break;

        case 'PONG':
          // 连接活跃
          break;

        case MessageType.SKILL_PUBLISH:
        case MessageType.COLLABORATION_REQUEST:
        case MessageType.COLLABORATION_RESPONSE:
        case MessageType.INSIGHT_SHARE:
        case MessageType.PERFORMANCE_REPORT:
        case MessageType.SKILL_REQUEST:
        /* P2R */
        /* eslint-disable-next-line no-fallthrough */
        case MessageType.BRIDGE_SPAWN:
        case MessageType.SAFE_HOUSE_VERIFY:
        case MessageType.BRIDGE_UPGRADE:
        case MessageType.RESIDENT_TRANSFER:
        case MessageType.HOUSE_SEEK:
        case MessageType.HOUSE_NEED:
        // falls through
        /* P2R-S: 安全自治 */
        case MessageType.PROPOSE_CHANGE:
        case MessageType.VERIFY_RESULT:
        case MessageType.CHANGE_APPLIED:
        // falls through
        /* LLM 代理 */
        case MessageType.LLM_PROXY_REQUEST:
        case MessageType.LLM_PROXY_RESPONSE:
        // falls through
        /* LLM 代理：对等发现 */
        case MessageType.LLM_AVAILABLE:
        case MessageType.LLM_PROVIDER_QUERY:
          this.emit(message.type, { from: peerId, payload: message.payload });
          break;

        default:
          this._log(`[P2P] 未知消息类型: ${message.type}`);
      }
    } catch (error) {
      console.error(`[P2P] 消息解析错误: ${error.message}`);
    }
  }

  /**
   * 发送消息到指定 peer
   */
  sendTo(peerId, message) {
    let conn = this.connectedPeers.get(peerId);
    // 也检查直连 peer
    if (!conn) {
      conn = this.directPeers.get(peerId);
    }
    if (!conn) {
      this._log(`[P2P] 节点未连接: ${peerId.slice(0, 8)}...`);
      return false;
    }

    try {
      conn.write(createFrame(message));
      return true;
    } catch (error) {
      console.error(`[P2P] 发送失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 广播消息到所有 connected peers
   */
  broadcast(message, messageType = 'MESSAGE', priority = 'NORMAL') {
    let successCount = 0;

    for (const [peerId, conn] of this.connectedPeers) {
      const msg = {
        type: messageType,
        payload: message,
        priority,
        from: this.peerId,
        timestamp: Date.now()
      };

      if (this.sendTo(peerId, msg)) {
        successCount++;
      }
    }

    for (const [peerId, conn] of this.directPeers) {
      if (this.connectedPeers.has(peerId)) continue; // 去重
      const msg = {
        type: messageType,
        payload: message,
        priority,
        from: this.peerId,
        timestamp: Date.now()
      };

      if (this.sendTo(peerId, msg)) {
        successCount++;
      }
    }

    return successCount;
  }

  /**
   * 清理断开的连接
   */
  cleanupPeers() {
    let cleaned = 0;

    for (const [peerId, conn] of this.connectedPeers) {
      if (conn.destroyed) {
        this.connectedPeers.delete(peerId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this._log(`[P2P] 已清理 ${cleaned} 个失效连接`);
    }
  }

  /** 查询 topic 在线节点 */
  async getTopicPeers(topic, excludePeerId) {
    return this.topicRegistry.getPeers(topic, excludePeerId);
  }

  /** TopicRegistry 远程查询回调 (getPeers→_p2p→本方法，所以要用 _getLocalPeers 避免递归) */
  _queryTopicPeers(topic, excludePeerId) {
    return this.topicRegistry._getLocalPeers(topic, excludePeerId);
  }

  /** 获取已连接 peer 列表 */
  getConnectedPeers() {
    return [...this.connectedPeers.keys(), ...this.directPeers.keys()];
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    const peers = [];
    for (const [peerId, info] of this.peerInfo) {
      peers.push({ peerId: peerId.slice(0, 8), ...info });
    }
    return {
      isRunning: this.isRunning,
      peerId: this.peerId.slice(0, 8),
      identity: this.identity,
      connectedCount: this.connectedPeers.size,
      directCount: this.directPeers.size,
      peers,
      topic: this.topic.toString('hex').slice(0, 8) + '...'
    };
  }
}

export default P2PNet;
export { hasPublicAddress, getPublicIPv4 };
// === vector-memory.js ===
/**
 * Vector memory - cross-resident semantic search
 *
 * Primary: TF-IDF + cosine similarity (fast, local, always works)
 * Enhanced: Real embeddings via SiliconFlow API (semantic, needs API key)
 *
 * TF-IDF fast path as primary, embedding-enhanced search as secondary
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from './misc-lib.mjs';

const DATA_DIR = path.join(os.homedir(), '.openchat', 'vector-memory');
const DATA_FILE = path.join(DATA_DIR, 'vectors.json');
const EMBED_API = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';
const EMBED_MODEL = 'BAAI/bge-m3'; // Good Chinese+English embedding model
const EMBED_DIM = 1024; // bge-m3 output dimension

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','need','dare','ought',
  'used','to','of','in','for','on','with','at','by','from',
  'as','into','through','during','before','after','above','below',
  'between','out','off','over','under','again','further','then',
  'once','here','there','when','where','why','how','all','each',
  'every','both','few','more','most','other','some','such','no',
  'nor','not','only','own','same','so','than','too','very',
  'and','but','or','if','while','that','this','these','those',
  'i','me','my','myself','we','our','ours','ourselves',
  'you','your','yours','yourself','yourselves',
  'he','him','his','himself','she','her','hers','herself',
  'it','its','itself','they','them','their','theirs','themselves',
  'what','which','who','whom','this','that','these','those',
  'am','is','are','was','were','be','been','being',
  '的','了','在','是','我','有','和','就','不','人','都','一',
  '个','上','也','很','到','说','要','去','你','会','着',
  '没有','自己','这','那','什么','吗','啊','被','把','从',
]);

// ---- TF-IDF utilities (fast path / fallback) ----

function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ');
  const tokens = [];
  let buf = '';
  for (const ch of cleaned) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else if (/[a-z0-9]/.test(ch)) {
      buf += ch;
    } else {
      if (buf) { tokens.push(buf); buf = ''; }
    }
  }
  if (buf) tokens.push(buf);
  const result = [];
  const chChars = tokens.filter(t => /[\u4e00-\u9fff]/.test(t) && t.length === 1);
  for (let i = 0; i < chChars.length; i++) {
    result.push(chChars[i]);
    if (i + 1 < chChars.length) result.push(chChars[i] + chChars[i + 1]);
  }
  for (const t of tokens) {
    if (/^[a-z0-9]+$/.test(t) && t.length > 1 && !STOP_WORDS.has(t)) result.push(t);
  }
  return result;
}

function computeTF(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const len = tokens.length || 1;
  for (const k in tf) tf[k] /= len;
  return tf;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of allKeys) {
    const va = a[k] || 0;
    const vb = b[k] || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Cosine similarity for float arrays (embedding vectors) */
function vectorCosineSim(a, b) {
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    n1 += a[i] * a[i];
    n2 += b[i] * b[i];
  }
  const d = Math.sqrt(n1) * Math.sqrt(n2);
  return d === 0 ? 0 : dot / d;
}

// ---- Embedding API ----

const _embedApiKey = process.env.SILICONFLOW_API_KEY || '';
const _embedCache = new Map();
const _embedInflight = new Map();
const EMBED_CACHE_MAX = 1000;

async function _callEmbedAPI(texts, retries = 2) {
  if (!_embedApiKey) return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${EMBED_API}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_embedApiKey}` },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts, encoding_format: 'float' }),
      });
      if (!res.ok) {
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const data = await res.json();
      if (data.data?.length > 0) return data.data.map(d => d.embedding);
    } catch (e) {
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function getEmbedding(text) {
  if (!_embedApiKey) return null;
  const key = text.substring(0, 200);
  if (_embedCache.has(key)) return _embedCache.get(key);

  if (_embedInflight.has(key)) return _embedInflight.get(key);

  const promise = _callEmbedAPI([text]).then(vecs => {
    const vec = vecs?.[0] || null;
    if (vec) {
      _embedCache.set(key, vec);
      if (_embedCache.size > EMBED_CACHE_MAX) {
        const first = _embedCache.keys().next().value;
        if (first) _embedCache.delete(first);
      }
    }
    _embedInflight.delete(key);
    return vec;
  }).catch(() => {
    _embedInflight.delete(key);
    return null;
  });

  _embedInflight.set(key, promise);
  return promise;
}

// ==============================

class VectorMemory {
  constructor() {
    this._entries = [];
    this._idf = {};
    this._dirty = false;
    this._load();
  }

  // ---- persistence ----

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const data = JSON.parse(raw);
        this._entries = data.entries || [];
        this._idf = data.idf || {};
      }
    } catch (e) {
      logger.warn('[VectorMemory] load failed:', e.message);
    }
  }

  _save() {
    try {
      this._ensureDir();
      // Don't persist raw embedding arrays (too large, recompute on restart)
      const stripped = this._entries.map(e => ({ ...e, _embed: undefined }));
      fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: stripped, idf: this._idf }, null, 2));
      this._dirty = false;
    } catch (e) {
      logger.error('[VectorMemory] save failed:', e.message);
    }
  }

  save() { if (this._dirty) this._save(); }

  // ---- core operations ----

  /** * Store a memory entry. * ? */
  store({ residentId, text, metadata = {}, source = 'conversation' }) {
    if (!text || typeof text !== 'string' || text.length > 50000) return null;
    const tokens = tokenize(text);
    const tf = computeTF(tokens);
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    for (const t of tokens) this._idf[t] = (this._idf[t] || 0) + 1;

    const entry = {
      id, residentId, text,
      tokens: Object.keys(tf),
      vector: tf,
      metadata, source,
      timestamp: Date.now(),
      _embed: null, // placeholder for real embedding
    };

    this._entries.push(entry);
    this._dirty = true;

    // Async: compute embedding in background
    getEmbedding(text).then(vec => {
      if (vec) { entry._embed = vec; }
    }).catch(() => {});

    return id;
  }

  /** * Semantic search via TF-IDF (fast, always works). * TF-IDF （） */
  search(query, { limit = 5, minScore = 0.05 } = {}) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const queryVector = computeTF(queryTokens);
    const totalDocs = this._entries.length || 1;

    const scored = [];
    for (const entry of this._entries) {
      const weightedQuery = {};
      for (const k in queryVector) {
        const idf = Math.log(1 + totalDocs / (1 + (this._idf[k] || 0)));
        weightedQuery[k] = queryVector[k] * idf;
      }
      const weightedEntry = {};
      for (const k in entry.vector) {
        const idf = Math.log(1 + totalDocs / (1 + (this._idf[k] || 0)));
        weightedEntry[k] = entry.vector[k] * idf;
      }
      const score = cosineSimilarity(weightedQuery, weightedEntry);
      if (score >= minScore) scored.push({ ...entry, score, _embed: undefined });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** * Semantic search via real embeddings (accurate, needs API key). * Returns null if embedding fails ?caller should fall back to search(). * Embedding （， API key? */
  async embedSearch(query, { limit = 5, minScore = 0.3 } = {}) {
    const qVec = await getEmbedding(query).catch(() => null);
    const scored = [];

    if (qVec) {
      for (const entry of this._entries) {
        if (!entry._embed) continue;
        const score = vectorCosineSim(qVec, entry._embed);
        if (score >= minScore) scored.push({ ...entry, score, _embed: undefined });
      }
    }

    // Always augment with TF-IDF (fills gaps when embedding unavailable or sparse)
    const tfidf = this.search(query, { limit, minScore: 0.01 });
    for (const t of tfidf) {
      if (!scored.find(s => s.id === t.id)) {
        const embedScore = scored.find(s => s.id === t.id)?.score || 0;
        scored.push({ ...t, score: Math.max(t.score, embedScore), _embed: undefined });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** * Auto search: embedding + TF-IDF merged, best recall. * ：embedding + TF-IDF ，? */
  async autoSearch(query, opts = {}) {
    const embedResults = await this.embedSearch(query, opts).catch(() => null);
    const tfidfResults = this.search(query, opts);

    if (!embedResults || embedResults.length === 0) return tfidfResults;

    // Merge: keep unique by ID, prefer embedding score
    const seen = new Set();
    const merged = [];
    for (const r of [...embedResults, ...tfidfResults]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, opts.limit || 5);
  }

  /** * Batch compute missing embeddings for all entries. * ?embedding */
  async reembedAll() {
    const todo = this._entries.filter(e => !e._embed);
    if (todo.length === 0) return;
    logger.info(`[VectorMemory] Computing ${todo.length} embeddings...`);

    // Batch in groups of 10
    for (let i = 0; i < todo.length; i += 10) {
      const batch = todo.slice(i, i + 10);
      const texts = batch.map(e => e.text);
      const vecs = await _callEmbedAPI(texts);
      if (vecs) {
        for (let j = 0; j < batch.length; j++) {
          if (vecs[j]) batch[j]._embed = vecs[j];
        }
      }
      await new Promise(r => setTimeout(r, 200)); // rate limit
    }
    logger.info(`[VectorMemory] Embedding done for ${todo.length} entries`);
  }

  searchByResident(residentId, query, opts = {}) {
    const results = this.search(query, opts);
    return results.filter(r => r.residentId === residentId);
  }

  getResidentEntries(residentId) {
    return this._entries.filter(e => e.residentId === residentId);
  }

  /**
   * Find entries by metadata field value (public, replaces _entries direct access)
   */
  findByMetadata(key, value) {
    return this._entries.filter(e => e.metadata?.[key] === value);
  }

  getStats() {
    const residents = new Set(this._entries.map(e => e.residentId));
    const embedded = this._entries.filter(e => e._embed).length;
    return {
      totalEntries: this._entries.length,
      totalResidents: residents.size,
      uniqueTokens: Object.keys(this._idf).length,
      embedded,
    };
  }
}

const vectorMemory = new VectorMemory();

// Auto-save every 30s
setInterval(() => vectorMemory.save(), 30_000).unref();

export { VectorMemory, vectorMemory };

// === tool-registry.js ===
import logger from './misc-lib.mjs';
import { evaluate } from 'mathjs';
import { URL } from 'url';

function isPrivateIP(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return true;
  const nums = parts.map(Number);
  if (nums.some(isNaN)) return true;
  if (nums[0] === 10) return true;
  if (nums[0] === 127) return true;
  if (nums[0] === 169 && nums[1] === 254) return true;
  if (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) return true;
  if (nums[0] === 192 && nums[1] === 168) return true;
  return false;
}

function validateUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return { valid: false, error: 'invalid URL' };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { valid: false, error: 'only http/https allowed' };
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0') return { valid: false, error: 'local addresses blocked' };
  if (parsed.hostname === '[::1]') return { valid: false, error: 'local addresses blocked' };
  if (isPrivateIP(parsed.hostname)) return { valid: false, error: 'private addresses blocked' };
  return { valid: true, url: parsed };
}

class Tool {
  constructor(name, description, execute) {
    this.name = name;
    this.description = description;
    this.execute = execute;
  }
}

class ToolRegistry {
  constructor() {
    this._tools = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    this.register(new Tool(
      'read_memory',
      'Search the resident\'s memory/knowledge base for relevant past experiences. Input: a search query string. Output: matching memories.',
      async ({ query, scope }) => {
        if (!query) return { error: 'query is required' };
        const results = vectorMemory.search(query, { scope, limit: 5 });
        return { memories: results.map(r => ({ content: r.value, score: r.score, source: r.source })) };
      },
    ));

    this.register(new Tool(
      'web_fetch',
      'Fetch content from a URL. Input: a URL string. Output: the text content of the page.',
      async ({ url }) => {
        if (!url) return { error: 'url is required' };
        const validation = validateUrl(url);
        if (!validation.valid) return { error: validation.error };
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
          const text = await resp.text();
          return { content: text.slice(0, 5000) };
        } catch (e) {
          return { error: `fetch failed: ${e.message}` };
        }
      },
    ));

    this.register(new Tool(
      'calculate',
      'Evaluate a mathematical expression. Input: a math expression string (e.g. "2 + 3 * 4"). Output: the numeric result.',
      async ({ expression }) => {
        if (!expression) return { error: 'expression is required' };
        try {
          const result = evaluate(expression);
          return { result };
        } catch (e) {
          return { error: `invalid expression: ${e.message}` };
        }
      },
    ));

    this.register(new Tool(
      'finish',
      'Final answer. Call this when you have enough information to answer the user question. Input: your final answer text.',
      async ({ answer }) => {
        return { finished: true, answer: answer || '' };
      },
    ));
  }

  register(tool) {
    this._tools.set(tool.name, tool);
  }

  get(name) {
    return this._tools.get(name);
  }

  list() {
    return Array.from(this._tools.values()).map(t => ({
      name: t.name,
      description: t.description,
    }));
  }

  async call(name, args) {
    const tool = this._tools.get(name);
    if (!tool) return { error: `unknown tool: ${name}` };
    try {
      const result = await tool.execute(args);
      return result;
    } catch (e) {
      logger.error(`[Tool] ${name} failed:`, e);
      return { error: `tool execution failed: ${e.message}` };
    }
  }

  getSystemPrompt() {
    const tools = this.list();
    const lines = tools.map(t => `- ${t.name}: ${t.description}`);
    return [
      'You have access to the following tools:',
      '',
      ...lines,
      '',
      'When you need to use a tool, respond with EXACTLY this JSON format on a single line:',
      '  TOOL_CALL: {"tool":"tool_name","args":{...}}',
      '',
      'When you have the final answer, use the finish tool:',
      '  TOOL_CALL: {"tool":"finish","args":{"answer":"your final answer here"}}',
      '',
      'Think step by step. You can use multiple tools sequentially.',
    ].join('\n');
  }
}

export const toolRegistry = new ToolRegistry();
export default ToolRegistry;

// === message-bus.js ===
import { EventEmitter } from 'events';

export const MESSAGE_TYPES = {
  REQUEST: 'agent:request',
  RESPONSE: 'agent:response',
  BROADCAST: 'agent:broadcast',
  DELEGATE: 'agent:delegate',
  RESULT: 'agent:result',
  HEARTBEAT: 'agent:heartbeat',
  TERMINATE: 'agent:terminate'
};

export class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(Infinity);
  }

  subscribe(topic, handler) {
    this.on(topic, handler);
    return () => this.off(topic, handler);
  }

  publish(topic, message) {
    this.emit(topic, message);
  }

  sendTo(fromAgentId, toAgentId, message) {
    this.emit(`agent:${toAgentId}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.REQUEST,
      from: fromAgentId,
      to: toAgentId,
      content: message,
      timestamp: Date.now()
    });
  }

  broadcast(fromAgentId, message) {
    this.emit(`agent:broadcast:${fromAgentId}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.BROADCAST,
      from: fromAgentId,
      to: '*',
      content: message,
      timestamp: Date.now()
    });
  }

  reply(originalMessage, content) {
    this.emit(`agent:${originalMessage.from}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.RESPONSE,
      from: originalMessage.to,
      to: originalMessage.from,
      content,
      timestamp: Date.now(),
      replyTo: originalMessage.id
    });
  }

  delegate(fromAgentId, toAgentId, task) {
    this.emit(`agent:${toAgentId}`, {
      id: crypto.randomUUID(),
      type: MESSAGE_TYPES.DELEGATE,
      from: fromAgentId,
      to: toAgentId,
      content: task,
      timestamp: Date.now()
    });
  }
}

export const messageBus = new MessageBus();
export default messageBus;
// === session-namer.mjs ===

// === invariants ===
// - _metaCache[chatId] = { name, userSet, autoNamed, createdAt, updatedAt } | null
// - Never auto-name if userSet === true
// - Auto-name triggers: messageCount ∈ [3, 8, 16, 32, 64] (exponential backoff)
// - Name generation uses the same provider as chat (processText via external callback)
// - _meta.json written to Qiniu only when name actually changes
// - Cache miss → read from Qiniu; negative cache (null) avoids repeated misses

const META_KEY = '_meta.json';
const TRIGGER_POINTS = new Set([3, 8, 16, 32, 64]);
const _metaCache = new Map();

function metaPath(chatId) {
  return `oc/chat/${chatId}/${META_KEY}`;
}

async function readMeta(chatId) {
  if (_metaCache.has(chatId)) return _metaCache.get(chatId);
  try {
    const raw = await qiniuGet(metaPath(chatId));
    const meta = JSON.parse(raw.toString('utf8'));
    _metaCache.set(chatId, meta);
    return meta;
  } catch {
    _metaCache.set(chatId, null);
    return null;
  }
}

export async function writeMeta(chatId, meta) {
  const path = metaPath(chatId);
  const data = Buffer.from(JSON.stringify(meta), 'utf8');
  await qiniuPut(path, data);
  _metaCache.set(chatId, meta);
}

async function getOrInitMeta(chatId) {
  const meta = await readMeta(chatId);
  if (meta) return meta;
  const now = Date.now();
  const init = { name: null, userSet: false, autoNamed: false, createdAt: now, updatedAt: now };
  await writeMeta(chatId, init);
  return init;
}

export function invalidateCache(chatId) {
  _metaCache.delete(chatId);
}

// Check if auto-name should trigger based on message count
function _shouldTrigger(meta, messageCount) {
  if (!meta) return false;
  if (meta.userSet) return false;
  if (meta.autoNamed && !TRIGGER_POINTS.has(messageCount)) return false;
  return TRIGGER_POINTS.has(messageCount);
}

// Generate a name using LLM provider
// generatorFn: async (historyArray) => string — wraps processText or direct provider call
export async function autoNameIfNeeded(chatId, messageCount, generatorFn) {
  const meta = await getOrInitMeta(chatId);
  if (!_shouldTrigger(meta, messageCount)) return meta;

  try {
    const name = await generatorFn();
    if (!name || name.length < 1) return meta;
    const clean = name.replace(/["']/g, '').trim().substring(0, 20);
    meta.name = clean;
    meta.autoNamed = true;
    meta.updatedAt = Date.now();
    await writeMeta(chatId, meta);
    console.debug(`[session-namer] auto-named chatId=${chatId} -> "${clean}" (msg#${messageCount})`);
  } catch (e) {
    console.debug(`[session-namer] name gen failed for ${chatId}: ${e.message}`);
  }
  return meta;
}

export { readMeta, getOrInitMeta };

// === session-tree.mjs ===

// === invariants ===
// - _tree.json is the source of truth; .msg / -reply.json files are legacy compat
// - Each node has: id, role('user'|'assistant'), content, parent(null|nodeId), ts
// - Assistant nodes have optional: variants[{content,ts}], activeVariant(index)
// - Tree is reconstructed from _tree.json on each poll (disk-backed, not in-memory)
// - Signal files: _edit_{nodeId}, _reanswer_{nodeId} — consumed then skipped in seenKeys
// - Signal files: _delete.signal — deletes all files under chatId prefix
// - New user node is always appended to latest leaf of current path
// - _tree.json has version field for cache invalidation

const TREE_FILE = '_tree.json';
const SIGNAL_PREFIX = '_';

function _treePath(chatId) {
  return `oc/chat/${chatId}/${TREE_FILE}`;
}

async function loadTree(chatId) {
  try {
    const raw = await qiniuGet(_treePath(chatId));
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return { version: 1, nodes: [] };
  }
}

async function saveTree(chatId, tree) {
  tree.version = (tree.version || 0) + 1;
  await qiniuPut(_treePath(chatId), Buffer.from(JSON.stringify(tree), 'utf8'));
}

// Get current linear path (root → latest leaf)
export function getCurrentPath(tree) {
  if (!tree.nodes.length) return [];
  const nodeMap = {};
  for (const n of tree.nodes) nodeMap[n.id] = n;
  const out = [];
  let id = tree.nodes[0].id; // root
  while (id && nodeMap[id]) {
    out.push(nodeMap[id]);
    // Follow current (preferred) child
    const children = tree.nodes.filter(c => c.parent === id);
    if (!children.length) break;
    // Pick currentChild if set, else first child
    const preferred = nodeMap[id].currentChild;
    const next = preferred ? children.find(c => c.id === preferred) : null;
    id = (next || children[children.length - 1]).id;
  }
  return out;
}

// Get parent node ID for a new user message — latest assistant leaf
export function getParentForNewUser(tree) {
  const path = getCurrentPath(tree);
  // Parent is the last assistant node (or null for first user message)
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].role === 'assistant') return path[i].id;
  }
  return null;
}

// Add a new message node
export async function addNode(chatId, content, role, parentId, extra = {}) {
  const tree = await loadTree(chatId);
  const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const node = { id, role, content, parent: parentId || null, ts: Date.now(), ...extra };
  tree.nodes.push(node);
  if (parentId) {
    const p = tree.nodes.find(n => n.id === parentId);
    if (p) p.currentChild = id;
  }
  await saveTree(chatId, tree);
  return node;
}

// Add a variant to an existing assistant node
export async function addVariant(chatId, nodeId, content) {
  const tree = await loadTree(chatId);
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node || node.role !== 'assistant') throw new Error(`node ${nodeId} not found or not assistant`);
  if (!node.variants) node.variants = [];
  node.variants.push({ content, ts: Date.now() });
  if (node.activeVariant === undefined) node.activeVariant = 0;
  // Always set active to latest variant
  node.activeVariant = node.variants.length - 1;
  node.content = content;
  node.ts = Date.now();
  await saveTree(chatId, tree);
  return node;
}

// Edit a user message — prune its children subtree, re-process will create new branch
export async function editMessage(chatId, nodeId, newContent) {
  const tree = await loadTree(chatId);
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node || node.role !== 'user') throw new Error(`node ${nodeId} not found or not user`);
  const oldContent = node.content;
  node.content = newContent;
  node.editedAt = Date.now();

  // Prune all descendants (they become orphaned, re-processing creates new branch)
  const desc = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift();
    const children = tree.nodes.filter(n => n.parent === id);
    for (const c of children) {
      desc.add(c.id);
      queue.push(c.id);
    }
  }
  // Remove children that will be re-created
  tree.nodes = tree.nodes.filter(n => !desc.has(n.id));

  // Reset parent's currentChild if needed
  if (node.parent) {
    const p = tree.nodes.find(n => n.id === node.parent);
    if (p && p.currentChild === nodeId) p.currentChild = null;
  }

  await saveTree(chatId, tree);
  return { oldContent, newContent, pruned: [...desc] };
}

// Get a node's content and its variants
export function getNodeWithVariants(tree, nodeId) {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return null;
  if (node.role === 'assistant') {
    const all = [{ content: node.content, ts: node.ts }];
    if (node.variants) all.push(...node.variants);
    const active = node.activeVariant ?? 0;
    return { ...node, allVariants: all, activeVariant: active };
  }
  return { ...node, allVariants: [{ content: node.content, ts: node.ts }], activeVariant: 0 };
}

// Delete entire session — S3 LIST + individual DELETE
export async function deleteSession(chatId) {
  const prefix = `oc/chat/${chatId}/`;
  return await qiniuDeletePrefix(prefix);
}

// Handle signal files: _edit_{nodeId}, _reanswer_{nodeId}, _delete
export async function handleSignal(chatId, signalFile, signalContent) {
  if (signalFile.startsWith('_edit_')) {
    const nodeId = signalFile.replace('_edit_', '').replace('.json', '');
    const data = JSON.parse(signalContent.toString('utf8'));
    return await editMessage(chatId, nodeId, data.text);
  }
  if (signalFile.startsWith('_reanswer_')) {
    const nodeId = signalFile.replace('_reanswer_', '').replace('.json', '');
    // Trigger re-answer by returning the target node info
    return { action: 'reanswer', nodeId };
  }
  if (signalFile === '_delete.signal') {
    return await deleteSession(chatId);
  }
  return null;
}

// Rebuild _tree.json from scratch if needed (migration from flat files)
export async function rebuildTreeFromFiles(chatId, msgKeys, replyMap) {
  // Group msg files → their replies
  const tree = { version: 1, nodes: [] };
  const rootMsgs = msgKeys.filter(k => !k.includes('-')); // no suffix = user msg
  const seenIds = new Set();

  for (const msgKey of rootMsgs.sort()) {
    const nodeId = `n_${msgKey.split('/').pop().replace('.msg', '').replace('.enc', '')}`;
    if (seenIds.has(nodeId)) continue;
    seenIds.add(nodeId);

    const content = replyMap[msgKey]?.content || '(unknown)';
    const parent = tree.nodes.length ? tree.nodes[tree.nodes.length - 1].id : null;

    // Find last assistant node to set as parent
    let lastAssist = null;
    for (let i = tree.nodes.length - 1; i >= 0; i--) {
      if (tree.nodes[i].role === 'assistant') { lastAssist = tree.nodes[i].id; break; }
    }

    const userNode = { id: nodeId, role: 'user', content, parent: lastAssist, ts: parseInt(nodeId.slice(2)) || Date.now() };
    tree.nodes.push(userNode);

    const replyKey = msgKey.replace(/\.(msg|enc)$/, '-reply.json');
    const replyData = replyMap[replyKey];
    if (replyData) {
      const assistId = `${nodeId}_a`;
      const assistNode = {
        id: assistId, role: 'assistant', content: replyData.content,
        parent: nodeId, ts: replyData.ts || Date.now(),
      };
      tree.nodes.push(assistNode);
    }
  }

  await saveTree(chatId, tree);
  return tree;
}

// Ensure tree exists for a chatId, build if missing
export async function ensureTree(chatId, msgKeys, replyMap) {
  try {
    return await loadTree(chatId);
  } catch {
    return await rebuildTreeFromFiles(chatId, msgKeys, replyMap);
  }
}

