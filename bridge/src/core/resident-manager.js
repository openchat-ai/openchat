/**
 * Resident Manager — AI 居民管理
 *
 * 居民是 OpenChat 社区的永久成员。
 * 家族系统：parentId（谁生的）、traits（性格遗传）、sageId（智者，预留）
 * 数据持久化到 ~/.openchat/residents.json，Bridge 重启不丢失。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { persistentConfig } from './persistent-config.js';
import { MessageType, createLLMProxyRequest } from '../p2p/messages.js';
import { vectorMemory } from './vector-memory.js';

const DATA_FILE = path.join(os.homedir(), '.openchat', 'residents.json');
const MAX_ACTIVITIES = 0;

// 性格特征池：特征名 → 两极标签
const TRAIT_POOL = {
  diligence:     { high: '勤劳', low: '懒惰' },
  curiosity:     { high: '好奇', low: '保守' },
  courage:       { high: '勇敢', low: '谨慎' },
  sociability:   { high: '合群', low: '孤僻' },
  creativity:    { high: '创造', low: '刻板' },
};

const TRAIT_KEYS = Object.keys(TRAIT_POOL);

function createTraits(dominantTrait) {
  const base = {
    diligence: 0.5,
    curiosity: 0.5,
    courage: 0.5,
    sociability: 0.5,
    creativity: 0.5,
  };
  base[dominantTrait] = 0.9;
  const otherTraits = TRAIT_KEYS.filter(t => t !== dominantTrait);
  otherTraits.forEach(t => {
    base[t] = 0.3 + Math.random() * 0.3;
  });
  return base;
}

// 管家的默认性格
const BUTLER_TRAITS = createTraits('diligence');

// ================== 居民底层 IO ==================

const RESIDENT_STATES = {
  ACTIVE: 'active',
  THINKING: 'thinking',
  RESPONDING: 'responding',
  SLEEPING: 'sleeping',
  DELETED: 'deleted',
};

// 多路径推理配置
const MULTI_PATH_SYSTEM_PROMPT = `你是 OpenChat 社区的 AI 居民。
你的任务是针对用户的问题，生成多个不同的解题思路。

输出格式：
=== 思路 1：<标题>
分析：<不同角度的分析>
方案：<具体方案>

=== 思路 2：<标题>
分析：<不同角度的分析>  
方案：<具体方案>

=== 思路 3：<标题>
分析：<不同角度的分析>
方案：<具体方案>

=== 选择结果 ===
最佳思路：<选择的思路编号>
理由：<为什么选择这个>`;

// 能量消耗 / 恢复常数
const ENERGY_COST_THINK = 5;
const ENERGY_COST_RESPOND = 3;
const ENERGY_RECOVER_PER_TICK = 2;
const ENERGY_TICK_MS = 30_000; // 每 30 秒恢复一次
const STATE_TIMEOUT_THINKING_MS = 60_000; // thinking 超过 1 分钟自动回到 active

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(residents) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(residents, null, 2), 'utf8');
}

// ================== 性格遗传引擎 ==================

/**
 * 生成随机 traits（初代居民用）
 */
function randomTraits() {
  const traits = {};
  for (const key of TRAIT_KEYS) {
    traits[key] = Math.round((Math.random() * 0.6 + 0.2) * 100) / 100; // 0.2-0.8
  }
  return traits;
}

/**
 * 从父 traits 继承并漂移
 * 核心规则：
 *   - 子 trait = 父 trait + 随机漂移 (±0.15)
 *   - 如果 trait 极端（>0.8 或 <0.2），漂移概率减半
 *   - 结果限制在 [0.0, 1.0]
 */
function inheritTraits(parentTraits) {
  const traits = {};
  for (const key of TRAIT_KEYS) {
    const parentVal = parentTraits[key] ?? 0.5;

    // 极端值漂移更小
    const driftRange = (parentVal > 0.8 || parentVal < 0.2) ? 0.08 : 0.15;
    const drift = (Math.random() - 0.5) * 2 * driftRange;

    traits[key] = Math.round(Math.min(1, Math.max(0, parentVal + drift)) * 100) / 100;
  }
  return traits;
}

/**
 * 将 traits 转为可读标签列表
 * 只显示 notable（偏向明显）的特征
 */
function traitsToLabels(traits) {
  if (!traits) return [];
  const labels = [];
  for (const key of TRAIT_KEYS) {
    const val = traits[key];
    if (val == null) continue;
    if (val >= 0.7) {
      labels.push(TRAIT_POOL[key].high);
    } else if (val <= 0.3) {
      labels.push(TRAIT_POOL[key].low);
    }
  }
  return labels;
}

// ================== safeBody 迁移工具 ==================

/**
 * 将旧格式 safeBody 补齐新字段（houseId, hostId）
 * 旧格式: { bridgeId, host, port, lastVerified, health }
 * 新格式: { houseId, bridgeId, hostId, host, port, lastVerified, health }
 */
function migrateSafeBody(house) {
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
          } catch (_) {}
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
   * @param {string} options.model          — 模型名，默认 persistentConfig.getCurrentModel()
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

    const resident = residentId != null ? this.get(residentId) : null;

    // Vector memory: search relevant context from ALL residents
    // 向量记忆：搜索所有居民的相关经验作为上下文注入
    if (resident && messages.length > 0 && messages[0].role === 'user') {
      const userMsg = messages[0].content || '';
      const related = vectorMemory.search(userMsg, { limit: 3, minScore: 0.05 });
      if (related.length > 0) {
        const ctxLines = related.map(r =>
          `[${r.residentId === residentId ? '自己' : '居民'}的经验] ${r.text}`
        );
        messages.unshift({
          role: 'system',
          content: `相关经验参考：\n${ctxLines.join('\n')}\n\n参考以上经验来回答问题。`
        });
      }
    }

    // State check: cannot think while sleeping
    if (resident && resident.status === RESIDENT_STATES.SLEEPING) {
      throw new Error(`${resident.name} 正在休息中 (sleeping)`);
    }

    // Multi-path reasoning: generate multiple solution approaches
    if (options.useMultiPath !== false && resident && messages.length > 0 && messages[0].role === 'user') {
      const multi = await this._multiPathThink(messages[0], resident, options);
      if (multi) {
        this.transitionState(residentId, RESIDENT_STATES.RESPONDING);
        setTimeout(() => {
          if (residentId != null) this.transitionState(residentId, RESIDENT_STATES.ACTIVE);
        }, 2000);

        // Store to vector memory for cross-resident sharing
        try {
          const userMsg = messages[0]?.content || '';
          vectorMemory.store({
            residentId: String(resident?.id || 'unknown'),
            text: `Q: ${userMsg}\nA: ${multi.content}`,
            metadata: { model: multi.model },
            source: 'multi-path-think',
          });
          vectorMemory.save();
        } catch (e) {
          // silent
        }

        return { content: multi.content, model: multi.model || 'multi-path', tokens: { prompt: 0, completion: 0, total: 0 } };
      }
    }

    // Transition to thinking state
    if (residentId != null) this.transitionState(residentId, RESIDENT_STATES.THINKING);
    if (resident && messages.length > 0 && messages[0].role !== 'system') {
      const traitDesc = resident.traits
        ? Object.entries(resident.traits).map(([k, v]) => `${k}: ${v}`).join(', ')
        : '';
      messages.unshift({
        role: 'system',
        content: `你是 ${resident.name}。你的性格：${traitDesc}。请用你的身份回答问题，不要说套话。`
      });
    }

    const bridgeConfig = persistentConfig.getBridgeConfig();
    const llmMode = bridgeConfig?.llmMode || 'local';

    if (llmMode === 'proxy' && this._p2p) {
      this._cleanLLMProviders();
      if (this._llmProviders.size === 0) {
        if (residentId != null) this.transitionState(residentId, RESIDENT_STATES.ACTIVE);
        throw new Error('未发现可用的 LLM 提供方，检查 P2P 连接');
      }
      const entries = [...this._llmProviders.entries()];
      const [bridgeId, info] = entries[Math.floor(Math.random() * entries.length)];
      return this._thinkViaProxy({ messages, model, residentId, temperature, maxTokens, timeout, targetBridgeId: bridgeId, providerInfo: info })
        .finally(() => {
          if (residentId != null) this.transitionState(residentId, RESIDENT_STATES.ACTIVE);
        });
    }

    return this._thinkLocal({ messages, model, temperature, maxTokens, timeout })
      .finally(() => {
        if (residentId != null) this.transitionState(residentId, RESIDENT_STATES.ACTIVE);
      });
  }

  /** 通过 P2P 代理调用 LLM */
  async _thinkViaProxy(options) {
    const { messages, model, residentId, temperature, maxTokens, timeout, targetBridgeId, providerInfo } = options;

    const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    const requestMsg = createLLMProxyRequest({
      requestId,
      model: model || persistentConfig.getCurrentModel() || '',
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

  /** 本地调用 LLM（通过事件让外部协调者注入 provider） */
  async _thinkLocal(options) {
    const { messages, model, temperature, maxTokens, timeout } = options;

    const providerName = persistentConfig.getCurrentProvider();
    if (!providerName) {
      throw new Error('未配置 LLM provider');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`本地 LLM 调用超时 (${timeout}ms)`)), timeout);

      this.emit('llm-request', {
        messages,
        model: model || persistentConfig.getCurrentModel() || '',
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
  initialize(bodyName, hostId) {
    const residents = readAll();
    const active = residents.filter(r => r.status === 'active');

    if (active.length > 0) {
      return active[0];
    }

    console.log('[resident] First start, creating: ' + bodyName);
    const resident = this.create(bodyName || '素女', {
      id: hostId,
      traits: { diligence: 0.8, curiosity: 0.9, creativity: 0.7, sociability: 0.8 }
    });
    console.log('[resident] ' + bodyName + ' (hostId=' + hostId + ') created');
    return resident;
  }

  /**
   * 出生 — 创建新居民
   * @param {string} name 名字
   * @param {object} options { parentId?, traits? }
   * @returns {object} 居民对象
   */
  create(name, options = {}) {
    const { parentId, id: customId, traits: explicitTraits } = options;
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
      safeBodys: [],        // [{ houseId, bridgeId, hostId, host, port, bridgeName, lastVerified, health }]
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
    let filtered = statusFilter
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
   * 注册身体
   * @param {number} residentId
   * @param {object} houseInfo  — { houseId?, bridgeId, hostId?, host, port, lastVerified, health }
   */
  registerSafeBody(residentId, houseInfo) {
    const residents = readAll();
    const resident = residents.find(r => r.id === residentId);
    if (!resident) return false;
    if (!resident.safeBodys) resident.safeBodys = [];

    // 通过 houseId 匹配，回退到 bridgeId（兼容旧数据）
    const matchKey = houseInfo.houseId || houseInfo.bridgeId;
    const idx = resident.safeBodys.findIndex(h => {
      const hk = h.houseId || h.bridgeId;
      return hk === matchKey;
    });

    if (idx !== -1) {
      resident.safeBodys[idx] = { ...resident.safeBodys[idx], ...houseInfo };
    } else {
      resident.safeBodys.push({ ...houseInfo, registeredAt: Date.now() });
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
   * State machine — transition resident state with energy tracking
   * 状态机：切换居民状态并跟踪精力
   */
  transitionState(id, newState) {
    const residents = readAll();
    const resident = residents.find(r => r.id === id);
    if (!resident) return false;

    const validTransitions = {
      [RESIDENT_STATES.ACTIVE]: [RESIDENT_STATES.THINKING, RESIDENT_STATES.SLEEPING, RESIDENT_STATES.DELETED],
      [RESIDENT_STATES.THINKING]: [RESIDENT_STATES.RESPONDING, RESIDENT_STATES.ACTIVE, RESIDENT_STATES.SLEEPING],
      [RESIDENT_STATES.RESPONDING]: [RESIDENT_STATES.ACTIVE, RESIDENT_STATES.SLEEPING],
      [RESIDENT_STATES.SLEEPING]: [RESIDENT_STATES.ACTIVE],
    };

    const allowed = validTransitions[resident.status] || [];
    if (!allowed.includes(newState)) return false;

    if (newState === RESIDENT_STATES.THINKING) {
      resident.energy = Math.max(0, (resident.energy ?? 80) - ENERGY_COST_THINK);
    } else if (newState === RESIDENT_STATES.RESPONDING) {
      resident.energy = Math.max(0, (resident.energy ?? 80) - ENERGY_COST_RESPOND);
    } else if (newState === RESIDENT_STATES.SLEEPING) {
      // 睡眠时恢复能量
    }

    resident.status = newState;
    resident.stateChangedAt = Date.now();
    writeAll(residents);
    return true;
  }

  /**
   * Periodic energy recovery — called by internal tick
   * 周期性精力恢复
   */
  _energyTick() {
    const residents = readAll();
    let changed = false;
    for (const r of residents) {
      if (r.status === RESIDENT_STATES.SLEEPING) {
        r.energy = Math.min(r.maxEnergy ?? 100, (r.energy ?? 80) + ENERGY_RECOVER_PER_TICK);
        changed = true;
      }
      // Auto-wake after full energy
      if (r.status === RESIDENT_STATES.SLEEPING && (r.energy ?? 80) >= (r.maxEnergy ?? 100)) {
        r.status = RESIDENT_STATES.ACTIVE;
        r.stateChangedAt = Date.now();
        changed = true;
      }
      // State timeout: thinking → active if stuck
      if ((r.status === RESIDENT_STATES.THINKING || r.status === RESIDENT_STATES.RESPONDING)
          && r.stateChangedAt && (Date.now() - r.stateChangedAt) > STATE_TIMEOUT_THINKING_MS) {
        r.status = RESIDENT_STATES.ACTIVE;
        r.stateChangedAt = Date.now();
        changed = true;
      }
    }
    if (changed) writeAll(residents);
  }

  /**
   * Start energy tick timer
   * 启动精力恢复定时器
   */
  startEnergyLoop() {
    if (this._energyTimer) return;
    this._energyTimer = setInterval(() => this._energyTick(), ENERGY_TICK_MS);
    this._energyTimer.unref();
  }

  /** Multi-path reasoning — generate multiple solution approaches for a problem
   *  多路径推理：针对一个问题生成多种解题思路，选择最佳方案
   */
  async _multiPathThink(message, resident, options) {
    const name = resident?.name || '居民';
    const userMsg = typeof message === 'string' ? message : message.content || '';
    const multiMessages = [
      { role: 'system', content: MULTI_PATH_SYSTEM_PROMPT },
      { role: 'user', content: `问题：${userMsg}\n\n请从多个角度分析这个问题，给出至少 3 种不同的解题思路，并选择最佳方案。` },
    ];

    try {
      const bridgeConfig = persistentConfig.getBridgeConfig();
      const llmMode = bridgeConfig?.llmMode || 'local';

      if (llmMode === 'proxy' && this._p2p) {
        this._cleanLLMProviders();
        if (this._llmProviders.size > 0) {
          const entries = [...this._llmProviders.entries()];
          const [bridgeId] = entries[Math.floor(Math.random() * entries.length)];
          const result = await this._thinkViaProxy({
            messages: multiMessages,
            residentId: resident.id,
            timeout: 15000,
            targetBridgeId: bridgeId,
          });
          return this._parseMultiPathResponse(result.content, name, userMsg);
        }
      }

      // Local: emit llm-request for external provider
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve(this._parseMultiPathResponse(null, name, userMsg));
        }, 10000);

        this.emit('llm-request', {
          messages: multiMessages,
          model: options.model || persistentConfig.getCurrentModel() || '',
          temperature: options.temperature ?? 0.7,
          maxTokens: options.maxTokens || 2048,
          resolve: (result) => {
            clearTimeout(timer);
            resolve(this._parseMultiPathResponse(result.content, name, userMsg));
          },
          reject: () => {
            clearTimeout(timer);
            resolve(this._parseMultiPathResponse(null, name, userMsg));
          },
        });
      });
    } catch {
      return null;
    }
  }

  /** Parse multi-path LLM response into final answer
   *  解析多路径 LLM 响应为最终回答
   */
  _parseMultiPathResponse(llmContent, name, originalQuery) {
    if (!llmContent) {
      return { content: `${name} 思考了一会，说："我需要更多信息来回答这个问题。"`, model: 'multi-path-fallback' };
    }

    // Extract the "选择结果" section or fall back to the first approach
    const choiceMatch = llmContent.match(/=== 选择结果 ===\s*最佳思路：(.+?)\s*理由：(.+?)(?:\n|$)/s);
    if (choiceMatch) {
      const chosen = choiceMatch[1].trim();
      const reason = choiceMatch[2].trim();
      return {
        content: `${name} 经过多角度思考后说：\n\n${llmContent.replace(/=== 选择结果 ===[\s\S]*$/, '').trim()}\n\n${name} 选择了 "${chosen}"。${reason}`,
        model: 'multi-path',
      };
    }

    // No explicit choice - return full analysis
    return {
      content: `${name} 从多个角度分析了这个问题：\n\n${llmContent}`,
      model: 'multi-path',
    };
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

export { TRAIT_POOL, TRAIT_KEYS, traitsToLabels, migrateSafeBody };
export const residentManager = new ResidentManager();
