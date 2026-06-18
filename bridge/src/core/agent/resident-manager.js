/**
 * Resident Manager — AI 居民管理
 *
 * 居民是 OpenChat 社区的永久成员。
 * 家族系统：parentId（谁生的）、traits（性格遗传）、sageId（智者，预留）
 * 数据持久化到 ~/.openchat/residents.json，Bridge 重启不丢失。
 */

import { EventEmitter } from 'events';
import { configRepo } from '../repositories/config-repo.js';
import { MessageType, createLLMProxyRequest } from '../../experiments/lib/storage-lib.mjs';
import { toolRegistry } from '../tool-registry.js';
import { ensureFile, readAll, writeAll } from './resident-io.js';
import { TRAIT_POOL, TRAIT_KEYS, createTraits, randomTraits, inheritTraits, traitsToLabels } from './resident-traits.js';
import logger from '../monitoring/logger.js';
const MAX_ACTIVITIES = 0;

// ================== safeHouse 迁移工具 ==================

/**
 * 将旧格式 safeHouse 补齐新字段（houseId, hostId）
 * 旧格式: { bridgeId, host, port, lastVerified, health }
 * 新格式: { houseId, bridgeId, hostId, host, port, lastVerified, health }
 */
function migrateSafeHouse(house) {
  if (!house) return house;
  const migrated = { ...house };
  if (!migrated.houseId) {
    migrated.houseId = `${migrated.bridgeId || 'unknown'}_${migrated.port || '0'}`;
  }
  if (!migrated.hostId) {
    migrated.hostId = migrated.host || migrated.bridgeId || 'unknown';
  }
  return migrated;
}

// ================== ResidentManager ==================

export class ResidentManager extends EventEmitter {
  constructor(deviceId = 'bridge-1') {
    super();
    this.deviceId = deviceId;
    this._nextId = 1;
    this._externalFeed = [];
    this._pendingProxyRequests = new Map();
    this._llmProviders = new Map(); // peerId → { bridgeId, hostId, models, provider, since }
    this._initNextId();
  }

  _initNextId() {
    const residents = readAll();
    const maxId = residents.reduce((max, r) => Math.max(max, r.id || 0), 0);
    this._nextId = maxId + 1;
  }

  /** 注入 P2P 实例（用于 LLM 代理通信） */
  setP2P(p2p) {
    this._p2p = p2p;
    if (p2p) {
      if (!this._proxyListenerRegistered) {
        p2p.on(MessageType.LLM_PROXY_RESPONSE, (data) => {
          const payload = data.payload || {};
          const requestId = payload.requestId;
          if (requestId && this._pendingProxyRequests.has(requestId)) {
            this._pendingProxyRequests.get(requestId).resolve(payload);
            this._pendingProxyRequests.delete(requestId);
          }
        });

        // 监听 LLM 提供方广播，维护可用提供方列表
        p2p.on(MessageType.LLM_AVAILABLE, (data) => {
          const p = data.payload || {};
          if (p.bridgeId) {
            this._llmProviders.set(p.bridgeId, {
              bridgeId: p.bridgeId,
              hostId: p.hostId || '',
              models: p.models || [],
              provider: p.provider || '',
              since: p.since || Date.now(),
            });
          }
        });

        // 新 peer 连接时主动查询 LLM 提供方
        p2p.on('peer-connected', (peerId) => {
          const { createLLMProviderQueryMessage } = require || {};
          try {
            const queryMsg = createLLMProviderQueryMessage({ from: p2p.peerId || '' });
            p2p.sendTo(peerId, queryMsg);
          } catch (_) { console.debug(`[resident] P2P send provider query failed`); }
        });

        this._proxyListenerRegistered = true;
      }
    }
  }

  /** 获取发现的 LLM 提供方列表 */
  getLLMProviders() {
    return [...this._llmProviders.values()];
  }

  /** 清理过期 LLM 提供方（超过 120s 未更新） */
  _cleanLLMProviders() {
    const cutoff = Date.now() - 120000;
    for (const [peerId, info] of this._llmProviders) {
      if ((info.since || 0) < cutoff) {
        this._llmProviders.delete(peerId);
      }
    }
  }

  /**
   * 思考 — 调用 LLM（本地或经 P2P 代理）
   * @param {object} options
   * @param {Array}  options.messages       — [{ role, content }]
   * @param {string} options.model          — 模型名，默认 configRepo.getCurrentModel()
   * @param {number} options.residentId     — 居民 ID（可选，仅代理模式使用）
   * @param {number} options.temperature    — 温度（可选）
   * @param {number} options.maxTokens      — 最大 token 数（可选）
   * @param {number} options.timeout        — 超时 ms，默认 30000
   * @returns {Promise<{ content: string, model: string, tokens: object }>}
   */
  async think(options = {}) {
    const { messages = [], model, residentId, temperature, maxTokens, timeout = 30000 } = options;
    if (messages.length === 0) {
      throw new Error('think() 缺少 messages');
    }

    const bridgeConfig = configRepo.getBridgeConfig();
    const llmMode = bridgeConfig?.llmMode || 'local';

    if (llmMode === 'proxy' && this._p2p) {
      // 从发现的提供方列表中随机选一个
      this._cleanLLMProviders();
      if (this._llmProviders.size === 0) {
        throw new Error('未发现可用的 LLM 提供方，检查 P2P 连接');
      }
      const entries = [...this._llmProviders.entries()];
      const [bridgeId, info] = entries[Math.floor(Math.random() * entries.length)];
      return this._thinkViaProxy({ messages, model, residentId, temperature, maxTokens, timeout, targetBridgeId: bridgeId, providerInfo: info });
    }

    return this._thinkLocal({ messages, model, temperature, maxTokens, timeout });
  }

  /** 通过 P2P 代理调用 LLM */
  async _thinkViaProxy(options) {
    const { messages, model, residentId, temperature, maxTokens, timeout, targetBridgeId, providerInfo } = options;

    const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    const requestMsg = createLLMProxyRequest({
      requestId,
      model: model || configRepo.getCurrentModel() || '',
      messages,
      residentId: String(residentId || ''),
      residentName: '',
      temperature: temperature ?? 0.7,
      maxTokens: maxTokens || 2048,
      tracing: {},
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingProxyRequests.delete(requestId);
        reject(new Error(`LLM 代理调用超时 (${timeout}ms)`));
      }, timeout);

      this._pendingProxyRequests.set(requestId, {
        resolve: (payload) => {
          clearTimeout(timer);
          if (payload.ok) {
            resolve({
              content: payload.content || '',
              model: payload.model || model || '',
              tokens: payload.tokens || { prompt: 0, completion: 0, total: 0 },
              duration: payload.duration || 0,
            });
          } else {
            reject(new Error(payload.error || 'LLM 代理返回错误'));
          }
        },
      });

      this._p2p.sendTo(targetBridgeId, requestMsg);
    });
  }

  /** 本地调用 LLM（通过事件让外部协调者注入 provider），附带 CoT + tool-use */
  async _thinkLocal(options) {
    const { messages, model, temperature, maxTokens, timeout } = options;
    const enableCot = options.cot !== false;

    const providerName = configRepo.getCurrentProvider();
    if (!providerName) {
      throw new Error('未配置 LLM provider');
    }

    if (!enableCot) {
      return this._llmCall(messages, model, temperature, maxTokens, timeout);
    }

    const systemPrompt = toolRegistry.getSystemPrompt();
    const cotMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const MAX_ITERATIONS = 10;
    const ITERATION_TIMEOUT = Math.max(Math.floor((timeout || 30000) / MAX_ITERATIONS), 5000);
    const MAX_ACCUMULATED_TOKENS = (maxTokens || 2048) * MAX_ITERATIONS;
    const accumulatedTokens = { prompt: 0, completion: 0, total: 0 };

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this._llmCall(cotMessages, model, temperature, Math.min(maxTokens || 2048, MAX_ACCUMULATED_TOKENS - accumulatedTokens.total), ITERATION_TIMEOUT);
      accumulatedTokens.prompt += response.tokens?.prompt || 0;
      accumulatedTokens.completion += response.tokens?.completion || 0;
      accumulatedTokens.total += response.tokens?.total || 0;
      const content = (response.content || '').trim();

      const toolCallMatch = content.match(/TOOL_CALL:\s*(\{.*\})/s);
      if (!toolCallMatch) {
        return { ...response, cotIterations: i + 1 };
      }

      let parsed;
      try {
        parsed = JSON.parse(toolCallMatch[1]);
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return { ...response, cotIterations: i + 1 };
      }

      const { tool, args } = parsed;
      if (tool === 'finish') {
        return {
          content: args?.answer || '',
          model: response.model,
          tokens: accumulatedTokens,
          cotIterations: i + 1,
          finished: true,
        };
      }

      const result = await toolRegistry.call(tool, args || {});
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      cotMessages.push({ role: 'assistant', content });
      cotMessages.push({ role: 'user', content: `Tool "${tool}" returned:\n${resultStr}\n\nContinue with your reasoning or call finish when done.` });
    }

    return {
      content: 'Reached maximum reasoning iterations without a final answer.',
      model: model || '',
      cotIterations: MAX_ITERATIONS,
      finished: false,
    };
  }

  /** Raw LLM call via event emitter */
  _llmCall(messages, model, temperature, maxTokens, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`LLM 调用超时 (${timeout}ms)`)), timeout);

      this.emit('llm-request', {
        messages,
        model: model || configRepo.getCurrentModel() || '',
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens || 2048,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  /**
   * 初始化 — Bridge 启动时调用，确保至少有一个居民
   */
  initialize() {
    const residents = readAll();
    const hasActive = residents.some(r => r.status === 'active');
    if (!hasActive) {
      logger.info('[居民] 首次启动，创建首批居民');
      const dominants = ['diligence', 'curiosity', 'courage', 'creativity'];
      const butler = this.create('管家', { traits: createTraits('diligence') });
      // 陆续出生（父母=管家），每个有不同的主导特质
      const firstGen = [
        { name: '小明', trait: 'courage' },
        { name: '小红', trait: 'creativity' },
        { name: '小刚', trait: 'sociability' },
      ];
      for (const p of firstGen) {
        this.create(p.name, { parentId: butler.id, traits: createTraits(p.trait) });
      }
      logger.info(`[居民] 已创建 ${1 + firstGen.length} 人 (管家 + ${firstGen.map(p => p.name).join(', ')})`);
      return butler;
    }
    return null;
  }

  /**
   * 出生 — 创建新居民
   * @param {string} name 名字
   * @param {object} options { parentId?, traits? }
   * @returns {object} 居民对象
   */
  create(name, options = {}) {
    const { parentId, traits: explicitTraits, id: customId } = options;
    const id = customId || this._nextId++;

    // 确定性格
    let traits;
    let parentName = null;

    if (explicitTraits) {
      traits = { ...explicitTraits };
    } else if (parentId != null) {
      const parent = this.get(parentId);
      if (parent) {
        traits = inheritTraits(parent.traits || randomTraits());
        parentName = parent.name;
      } else {
        traits = randomTraits();
      }
    } else {
      traits = randomTraits();
    }

    const resident = {
      id,
      name: name || `居民-${id}`,
      createdAt: new Date().toISOString(),
      status: 'active',
      home: this.deviceId,
      parentId: parentId || null,
      traits,
      sageId: null,          // 预留：智者
      energy: 80,
      maxEnergy: 100,
      safeHouses: [],        // [{ houseId, bridgeId, hostId, host, port, bridgeName, lastVerified, health }]
      activities: [],
    };

    const residents = readAll();
    residents.push(resident);
    writeAll(residents);

    // 出生活动
    const bornMsg = parentName
      ? `生在 ${parentName} 的家`
      : '来到了这个世界';
    this.addActivity(id, { type: 'born', message: bornMsg });

    return resident;
  }

  /**
   * 全体名单 — 列出所有居民
   */
  list(statusFilter) {
    const residents = readAll();
    const filtered = statusFilter
      ? residents.filter(r => r.status === statusFilter)
      : residents;
    return filtered.map(({ activities, ...rest }) => ({
      ...rest,
      energy: rest.energy ?? 80,
      maxEnergy: rest.maxEnergy ?? 100,
      activityCount: (activities || []).length,
    }));
  }

  /**
   * 查看档案 — 获取单个居民
   */
  get(id) {
    const residents = readAll();
    const resident = residents.find(r => r.id === id);
    if (!resident) return null;
    // 附上父居民名字方便显示
    let parentName = null;
    if (resident.parentId != null) {
      const parent = residents.find(r => r.id === resident.parentId);
      parentName = parent ? parent.name : null;
    }
    return {
      ...resident,
      parentName,
      energy: resident.energy ?? 80,
      maxEnergy: resident.maxEnergy ?? 100,
      traits: resident.traits || {},
      activities: (resident.activities || []).slice().reverse(),
    };
  }

  /**
   * 查子孙列表 — 递归查找所有后代
   * @param {number} id 居民 ID
   * @param {number} maxDepth 最大深度，默认 5
   * @returns {Array} 子孙列表，每项含 depth
   */
  getChildren(id, maxDepth = 5) {
    const residents = readAll();
    const result = [];

    function findChildren(parentId, depth) {
      if (depth > maxDepth) return;
      const children = residents.filter(r => r.parentId === parentId);
      for (const child of children) {
        result.push({
          id: child.id,
          name: child.name,
          status: child.status,
          createdAt: child.createdAt,
          depth,
          traits: child.traits || {},
          activityCount: (child.activities || []).length,
        });
        findChildren(child.id, depth + 1);
      }
    }

    findChildren(id, 1);
    return result;
  }

  /**
   * 注销 — 标记删除
   */
  delete(id) {
    const residents = readAll();
    const resident = residents.find(r => r.id === id);
    if (!resident) return false;
    resident.status = 'deleted';
    resident.deletedAt = new Date().toISOString();
    writeAll(residents);
    return true;
  }

  /**
   * 追加活动记录
   */
  addActivity(residentId, activity) {
    const residents = readAll();
    const resident = residents.find(r => r.id === residentId);
    if (!resident) return;

    if (!resident.activities) {
      resident.activities = [];
    }
    const entry = {
      id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...activity,
    };
    resident.activities.push(entry);
    if (resident.activities.length > MAX_ACTIVITIES) {
      resident.activities = resident.activities.slice(-MAX_ACTIVITIES);
    }
    writeAll(residents);
    this.emit('activity', { residentId, residentName: resident.name, entry });
  }

  evolveTraits(residentId, thinkingStyle, success) {
    const residents = readAll();
    const resident = residents.find(r => r.id === residentId);
    if (!resident || !resident.traits) return;

    const growthRate = success ? 0.02 : -0.01;
    const styleToTrait = {
      curiosity: 'curiosity',
      courage: 'courage',
      creativity: 'creativity',
      diligence: 'diligence',
      sociability: 'sociability'
    };

    const traitKey = styleToTrait[thinkingStyle];
    if (!traitKey) return;

    const oldVal = resident.traits[traitKey] || 0.5;
    resident.traits[traitKey] = Math.round(Math.min(1, Math.max(0, oldVal + growthRate)) * 100) / 100;

    

    writeAll(residents);
    
  }

  /**
   * 记录来自其他 Bridge 的外部活动
   */
  addExternalActivity(activity) {
    this._externalFeed.push({
      ...activity,
      id: `ext_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: activity.timestamp || new Date().toISOString(),
      external: true
    });
    if (this._externalFeed.length > 200) {
      this._externalFeed = this._externalFeed.slice(-200);
    }
  }

  /**
   * 注册安全屋
   * @param {number} residentId
   * @param {object} houseInfo  — { houseId?, bridgeId, hostId?, host, port, lastVerified, health }
   */
  registerSafeHouse(residentId, houseInfo) {
    const residents = readAll();
    const resident = residents.find(r => r.id === residentId);
    if (!resident) return false;
    if (!resident.safeHouses) resident.safeHouses = [];

    // 通过 houseId 匹配，回退到 bridgeId（兼容旧数据）
    const matchKey = houseInfo.houseId || houseInfo.bridgeId;
    const idx = resident.safeHouses.findIndex(h => {
      const hk = h.houseId || h.bridgeId;
      return hk === matchKey;
    });

    if (idx !== -1) {
      resident.safeHouses[idx] = { ...resident.safeHouses[idx], ...houseInfo };
    } else {
      resident.safeHouses.push({ ...houseInfo, registeredAt: Date.now() });
    }
    writeAll(residents);
    return true;
  }

  /**
   * 调整精力值（正数恢复，负数消耗）
   * @returns {number} 调整后的精力
   */
  updateEnergy(id, delta) {
    const residents = readAll();
    const resident = residents.find(r => r.id === id);
    if (!resident) return 0;
    const max = resident.maxEnergy || 100;
    resident.energy = Math.min(max, Math.max(0, (resident.energy || 80) + delta));
    writeAll(residents);
    return resident.energy;
  }

  /**
   * 设置状态（调度器用：active ↔ sleeping）
   */
  setStatus(id, status) {
    const residents = readAll();
    const resident = residents.find(r => r.id === id);
    if (!resident) return false;
    resident.status = status;
    writeAll(residents);
    return true;
  }

  /**
   * 获取性格标签（可读形式）
   */
  getTraitLabels(residentId) {
    const resident = this.get(residentId);
    if (!resident) return [];
    return traitsToLabels(resident.traits);
  }

  getStats() {
    const residents = readAll();
    return {
      total: residents.length,
      active: residents.filter(r => r.status === 'active').length,
      sleeping: residents.filter(r => r.status === 'sleeping').length,
      deleted: residents.filter(r => r.status === 'deleted').length,
    };
  }

  /**
   * 社区动态流 — 聚合所有非注销居民的最新活动
   * @param {number} limit 返回条数，默认 20
   * @returns {Array} 活动列表，每条带 residentId + residentName
   */
  getCommunityFeed(limit = 20) {
    const residents = readAll();
    const feed = [];

    for (const r of residents) {
      if (r.status === 'deleted') continue;
      const activities = r.activities || [];
      for (const act of activities) {
        feed.push({
          ...act,
          residentId: r.id,
          residentName: r.name,
        });
      }
    }

    // 合并外部活动
    for (const act of this._externalFeed) {
      feed.push(act);
    }

    // 按时间倒序，最新在前
    feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return feed.slice(0, limit);
  }
}

// 导出单例 + 工具函数（给 Flutter 端映射用）
export { migrateSafeHouse };
export { TRAIT_POOL, TRAIT_KEYS, traitsToLabels } from './resident-traits.js';
export const residentManager = new ResidentManager();
