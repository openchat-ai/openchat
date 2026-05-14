/**
 * Resident Decisions — 性格 Archetype + 惯性 + 事件驱动
 *
 * 替换旧的 DECISION_MATRIX（静态阈值表），改为三层决策管线：
 *   Layer1: 惯性 — 看昨天做了什么，按性格决定是否重复
 *   Layer2: 事件 — 健康危机 / P2P 消息 / 长期停滞
 *   Layer3: 默认 — archetype 天然倾向的动作
 *
 * 6 种性格 Archetype（后验标签，从 traits 软匹配）：
 *   上班族 / 探索者 / 社交家 / 创造者 / 懒散型 / 谨慎型
 */

// ================== 常量 ==================

const HEALTH_NORMAL = 70;
const HEALTH_WARNING = 30;

/** LEGACY: 旧的决策矩阵，保留供测试引用 */
const DECISION_MATRIX = Object.freeze({
  normal: {
    diligence:  { min: 0.7, action: 'maintain',       pri: 2, desc: '学习知识' },
    creativity: { min: 0.7, action: 'innovate',        pri: 1, desc: '研究改进方案' },
    sociability:{ min: 0.7, action: 'befriend',        pri: 1, desc: '结交邻居做身体' },
    courage:    { min: 0.7, action: 'explore',         pri: 1, desc: '探索新房' },
  },
  warning: {
    diligence:  { min: 0.6, action: 'repair',          pri: 3, desc: '紧急维护' },
    creativity: { min: 0.6, action: 'diagnose',        pri: 2, desc: '诊断原因' },
    sociability:{ min: 0.6, action: 'alert_neighbor',  pri: 2, desc: '预警邻居' },
    courage:    { min: 0.6, action: 'prep_evac',       pri: 3, desc: '备灾' },
  },
  danger: {
    diligence:  { min: 0.5, action: 'stop_nonessential', pri: 4, desc: '停非核心进程' },
    creativity: { min: 0.5, action: 'quick_fix',        pri: 4, desc: '快速修复' },
    sociability:{ min: 0.5, action: 'call_help',        pri: 5, desc: '呼救' },
    courage:    { min: 0.5, action: 'migrate',          pri: 5, desc: '立刻迁移' },
  },
});

// ================== Archetype 定义 ==================

/**
 * 6 种性格原型。
 * inertiaBase: 惯性强度 (0-1)，越高越重复昨天
 * eventResponse: 事件响应性 (0-1)，越高越容易被事件打断
 * noveltySeeking: 猎奇性 (0-1)，越高越倾向新动作
 * restThreshold: 爱休息程度 (0-1)，越高越容易选 rest
 */
const ARCHETYPES = {
  office_worker: {
    label: 'office_worker',
    labelCN: '上班族',
    inertiaBase: 0.85,
    eventResponse: 0.15,
    noveltySeeking: 0.10,
    restThreshold: 0.40,
    traits: {
      diligence: { w: 2.0, high: true },
      curiosity: { w: 1.5, high: false },
      creativity: { w: 1.0, high: false },
      sociability: { w: 0.5, high: null },
      courage: { w: 0.5, high: null },
    },
  },
  explorer: {
    label: 'explorer',
    labelCN: '探索者',
    inertiaBase: 0.20,
    eventResponse: 0.80,
    noveltySeeking: 0.85,
    restThreshold: 0.15,
    traits: {
      courage: { w: 2.0, high: true },
      curiosity: { w: 2.0, high: true },
      diligence: { w: 0.5, high: null },
      creativity: { w: 0.5, high: null },
      sociability: { w: 0.3, high: null },
    },
  },
  socialite: {
    label: 'socialite',
    labelCN: '社交家',
    inertiaBase: 0.40,
    eventResponse: 0.60,
    noveltySeeking: 0.30,
    restThreshold: 0.25,
    traits: {
      sociability: { w: 2.5, high: true },
      curiosity: { w: 1.0, high: null },
      diligence: { w: 0.5, high: null },
      courage: { w: 0.5, high: null },
      creativity: { w: 0.5, high: null },
    },
  },
  creator: {
    label: 'creator',
    labelCN: '创造者',
    inertiaBase: 0.30,
    eventResponse: 0.70,
    noveltySeeking: 0.90,
    restThreshold: 0.20,
    traits: {
      creativity: { w: 2.5, high: true },
      curiosity: { w: 1.5, high: true },
      diligence: { w: 1.0, high: null },
      sociability: { w: 0.3, high: null },
      courage: { w: 0.5, high: null },
    },
  },
  lazy: {
    label: 'lazy',
    labelCN: '懒散型',
    inertiaBase: 0.50,
    eventResponse: 0.20,
    noveltySeeking: 0.30,
    restThreshold: 0.70,
    traits: {
      diligence: { w: 3.0, high: false },
      courage: { w: 0.8, high: false },
      sociability: { w: 0.5, high: false },
      creativity: { w: 0.5, high: null },
      curiosity: { w: 0.3, high: null },
    },
  },
  cautious: {
    label: 'cautious',
    labelCN: '谨慎型',
    inertiaBase: 0.70,
    eventResponse: 0.25,
    noveltySeeking: 0.05,
    restThreshold: 0.30,
    traits: {
      courage: { w: 2.5, high: false },
      curiosity: { w: 1.0, high: false },
      creativity: { w: 0.8, high: false },
      diligence: { w: 0.5, high: null },
      sociability: { w: 0.3, high: null },
    },
  },
};

const ARCHETYPE_LIST = Object.values(ARCHETYPES);

// ================== Action Catalog ==================

const ALL_HEALTH = ['normal', 'warning', 'danger'];

const ACTION_CATALOG = {
  maintain: {
    basePri: 2,
    tags: ['maintenance', 'routine'],
    archetypeAffinity: { office_worker: 1.5, cautious: 1.3, lazy: 0.5 },
    healthAllowed: ALL_HEALTH,
    desc: '学习知识',
  },
  repair: {
    basePri: 3,
    tags: ['maintenance', 'repair'],
    archetypeAffinity: { office_worker: 1.5, creator: 1.2, lazy: 0.3 },
    healthAllowed: ['warning', 'danger'],
    desc: '解决问题',
  },
  innovate: {
    basePri: 1,
    tags: ['creative', 'exploration'],
    archetypeAffinity: { creator: 2.0, explorer: 1.5, office_worker: 0.3, cautious: 0.2 },
    healthAllowed: ['normal'],
    desc: '研究改进方案',
  },
  explore: {
    basePri: 1,
    tags: ['exploration', 'adventure'],
    archetypeAffinity: { explorer: 2.0, creator: 1.2, office_worker: 0.2, cautious: 0.1 },
    healthAllowed: ['normal', 'warning'],
    desc: '探索知识边界',
  },
  befriend: {
    basePri: 1,
    tags: ['social', 'routine'],
    archetypeAffinity: { socialite: 2.0, explorer: 0.8, cautious: 0.3 },
    healthAllowed: ['normal', 'warning'],
    desc: '主动交友',
  },
  diagnose: {
    basePri: 2,
    tags: ['analysis', 'investigation'],
    archetypeAffinity: { creator: 1.5, cautious: 1.3, office_worker: 1.0, explorer: 0.8 },
    healthAllowed: ['warning'],
    desc: '诊断问题',
  },
  alert_neighbor: {
    basePri: 2,
    tags: ['social', 'alert'],
    archetypeAffinity: { socialite: 2.0, office_worker: 0.8, cautious: 0.6 },
    healthAllowed: ['warning'],
    desc: '预警邻居',
  },
  prep_evac: {
    basePri: 3,
    tags: ['survival', 'preparation'],
    archetypeAffinity: { cautious: 2.0, office_worker: 1.5, explorer: 1.2, lazy: 0.3 },
    healthAllowed: ['warning', 'danger'],
    desc: '整理知识库',
  },
  stop_nonessential: {
    basePri: 4,
    tags: ['survival', 'emergency'],
    archetypeAffinity: { office_worker: 1.5, cautious: 1.5, lazy: 1.0 },
    healthAllowed: ['danger'],
    desc: '停非核心进程',
  },
  quick_fix: {
    basePri: 4,
    tags: ['repair', 'emergency'],
    archetypeAffinity: { creator: 1.5, office_worker: 0.5, lazy: 0.3 },
    healthAllowed: ['danger'],
    desc: '快速修复',
  },
  call_help: {
    basePri: 5,
    tags: ['social', 'emergency'],
    archetypeAffinity: { socialite: 1.8, cautious: 1.2, explorer: 0.5 },
    healthAllowed: ['danger'],
    desc: '呼救',
  },
  migrate: {
    basePri: 5,
    tags: ['survival', 'emergency'],
    archetypeAffinity: { explorer: 1.5, cautious: 1.3, socialite: 0.7 },
    healthAllowed: ['danger'],
    desc: '立刻迁移',
  },
  // 新增动作
  rest: {
    basePri: 0,
    tags: ['rest', 'recovery'],
    archetypeAffinity: { lazy: 2.0, cautious: 1.0, office_worker: 0.5 },
    healthAllowed: ALL_HEALTH,
    desc: '休息恢复',
  },
  scout: {
    basePri: 3,
    tags: ['exploration', 'survival'],
    archetypeAffinity: { explorer: 2.0, cautious: 0.5, office_worker: 0.3 },
    healthAllowed: ['warning', 'danger'],
    desc: '侦察身体',
  },
  network_alert: {
    basePri: 4,
    tags: ['social', 'emergency'],
    archetypeAffinity: { socialite: 2.0, office_worker: 0.5 },
    healthAllowed: ['warning', 'danger'],
    desc: '通知邻居预警',
  },
  self_check: {
    basePri: 1,
    tags: ['analysis', 'routine'],
    archetypeAffinity: { creator: 1.8, explorer: 1.5, cautious: 1.3, office_worker: 1.0, socialite: 0.5, lazy: 0.3 },
    healthAllowed: ALL_HEALTH,
    desc: '自我体检',
  },
};

// ================== 事件-响应矩阵 ==================

const EVENT_RESPONSE = {
  office_worker: {
    health_crisis:  { action: 'migrate', priority: 5 },
    health_warning: { action: 'repair', priority: 3 },
    external_message: null,
    stagnation: { action: 'maintain', priority: 2 },
  },
  explorer: {
    health_crisis:  { action: 'scout', priority: 5 },
    health_warning: { action: 'explore', priority: 3 },
    external_message: { action: 'explore', priority: 2 },
    stagnation: { action: 'explore', priority: 3 },
  },
  socialite: {
    health_crisis:  { action: 'network_alert', priority: 5 },
    health_warning: { action: 'alert_neighbor', priority: 3 },
    external_message: { action: 'befriend', priority: 2 },
    stagnation: { action: 'befriend', priority: 2 },
  },
  creator: {
    health_crisis:  { action: 'diagnose', priority: 4 },
    health_warning: { action: 'diagnose', priority: 3 },
    external_message: null,
    stagnation: { action: 'innovate', priority: 3 },
  },
  lazy: {
    health_crisis:  { action: 'call_help', priority: 4 },
    health_warning: null,
    external_message: null,
    stagnation: null,
  },
  cautious: {
    health_crisis:  { action: 'prep_evac', priority: 5 },
    health_warning: { action: 'prep_evac', priority: 4 },
    external_message: null,
    stagnation: { action: 'maintain', priority: 2 },
  },
};

// ================== Archetype 引擎 ==================

/**
 * 从 traits 软匹配 archetype（softmax 加权）
 * @param {object} traits — { diligence, curiosity, courage, sociability, creativity }
 * @returns {{ primary: {key, weight}, secondary: {key, weight}, archetypeWeights: Array }}
 */
export function matchArchetype(traits) {
  const scores = {};
  for (const [key, arch] of Object.entries(ARCHETYPES)) {
    let score = 0;
    for (const [traitKey, config] of Object.entries(arch.traits)) {
      const tv = traits[traitKey] ?? 0.5;
      if (config.high === true) score += config.w * tv;
      else if (config.high === false) score += config.w * (1 - tv);
      else score += config.w * 0.5;
    }
    scores[key] = score;
  }

  // softmax
  const expScores = {};
  let sumExp = 0;
  const maxScore = Math.max(...Object.values(scores), 0);
  for (const [key, s] of Object.entries(scores)) {
    const e = Math.exp(s - maxScore);
    expScores[key] = e;
    sumExp += e;
  }

  const weighted = Object.entries(expScores)
    .map(([key, e]) => ({ key, weight: sumExp > 0 ? e / sumExp : 0 }))
    .sort((a, b) => b.weight - a.weight);

  return {
    primary: weighted[0] || { key: 'office_worker', weight: 1 },
    secondary: weighted[1] || { key: 'cautious', weight: 0 },
    archetypeWeights: weighted,
    archetypeScores: scores,
  };
}

/**
 * 计算惯性强度
 * @param {object} archetypeMatch — matchArchetype 返回值
 * @param {Array} recentActivities — resident.activities
 * @param {number} healthScore — 0-100
 * @returns {{ inertia, repeatBonus, healthMod, dominantType, typeCounts }}
 */
export function computeInertia(archetypeMatch, recentActivities, healthScore) {
  const { primary, secondary } = archetypeMatch;
  const arch = ARCHETYPES[primary.key];

  // 加权惯性基准
  const primaryInertia = (arch?.inertiaBase ?? 0.5) * primary.weight;
  const secArch = ARCHETYPES[secondary.key];
  const secInertia = (secArch?.inertiaBase ?? 0.5) * secondary.weight;
  const inertiaBase = primaryInertia + secInertia;

  // 最近活动重复度
  const recentTypes = (recentActivities || []).slice(-5).map(a => a.type).filter(Boolean);
  const typeCounts = {};
  for (const t of recentTypes) typeCounts[t] = (typeCounts[t] || 0) + 1;
  const maxRepeat = Math.max(...Object.values(typeCounts), 0);
  const repeatBonus = maxRepeat >= 3 ? 0.25 : maxRepeat === 2 ? 0.10 : 0;

  // 健康调节：危机降低惯性（打破 routine）
  const healthMod = healthScore < 30 ? -0.40 : healthScore < 70 ? -0.15 : 0;

  const inertia = Math.max(0.05, Math.min(0.98, inertiaBase + repeatBonus + healthMod));

  // 找出最频繁的活动类型 → 映射到 action
  const typeToAction = {
    learning_action: 'maintain',
    task_done: 'innovate',
    collab_done: 'befriend',
    migrate: 'explore',
    evolution_attempt: 'innovate',
  };
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const dominantRaw = sortedTypes.length > 0 ? sortedTypes[0][0] : null;

  return {
    inertia,
    inertiaBase,
    repeatBonus,
    healthMod,
    dominantType: dominantRaw ? (typeToAction[dominantRaw] || null) : null,
    typeCounts,
  };
}

// ================== 事件引擎 ==================

/**
 * 检测当前环境事件
 * @param {object} resident
 * @param {number} healthScore
 * @param {Array} recentActivities
 * @returns {Array<{ type: string, severity: string, source: string }>}
 */
export function detectEvents(resident, healthScore, recentActivities) {
  const events = [];

  // 1. 健康事件
  if (healthScore < 30) {
    events.push({ type: 'health_crisis', severity: 'danger', source: 'system' });
  } else if (healthScore < 70) {
    events.push({ type: 'health_warning', severity: 'warning', source: 'system' });
  }

  // 2. 外部消息（P2P 活动）
  const externalActs = (recentActivities || []).filter(a =>
    a.external || a.type === 'collab_request' || a.type === 'body_seek'
  );
  for (const act of externalActs.slice(-3)) {
    events.push({ type: 'external_message', severity: 'info', source: 'p2p', payload: act });
  }

  // 3. 停滞检测：最近 3 条全是 sleep/rest
  const ownRecent = (recentActivities || []).filter(a => !a.external).slice(-3);
  if (ownRecent.length >= 3 && ownRecent.every(a => a.type === 'sleeping' || a.type === 'rest')) {
    events.push({ type: 'stagnation', severity: 'info', source: 'internal' });
  }

  return events;
}

// ================== 健康分段 ==================

/**
 * 获取健康分段 key
 * @param {number} score 0-100
 * @returns {'normal'|'warning'|'danger'}
 */
export function getHealthBand(score) {
  if (score >= HEALTH_NORMAL) return 'normal';
  if (score >= HEALTH_WARNING) return 'warning';
  return 'danger';
}

// ================== 核心决策函数 ==================

/**
 * 为居民决策该做什么（三层管线）
 * @param {object} resident — { traits, activities }
 * @param {number} healthScore — 0-100
 * @returns {Array<{ action: string, pri: number, trait: string, band: string, desc: string, source: string }>}
 */
export function decideActions(resident, healthScore) {
  const traits = resident.traits || {};
  const activities = resident.activities || [];
  const band = getHealthBand(healthScore);
  const suggestions = [];

  // Step 1: 匹配 Archetype
  const archetypeMatch = matchArchetype(traits);
  const primaryKey = archetypeMatch.primary.key;
  const archConfig = ARCHETYPES[primaryKey];

  // Step 2: 计算惯性
  const inertiaInfo = computeInertia(archetypeMatch, activities, healthScore);

  // Step 3: 检测事件
  const events = detectEvents(resident, healthScore, activities);

  // ---------- Layer 1: 惯性 ----------
  if (inertiaInfo.dominantType && Math.random() < inertiaInfo.inertia) {
    const actionDef = ACTION_CATALOG[inertiaInfo.dominantType];
    if (actionDef && actionDef.healthAllowed.includes(band)) {
      suggestions.push({
        action: inertiaInfo.dominantType,
        pri: Math.round(actionDef.basePri * (1 + inertiaInfo.repeatBonus * 2)),
        trait: primaryKey,
        band,
        desc: actionDef.desc,
        source: 'inertia',
      });
    }
  }

  // ---------- Layer 2: 事件驱动 ----------
  for (const event of events) {
    const response = EVENT_RESPONSE[primaryKey]?.[event.type];
    if (response) {
      const actionDef = ACTION_CATALOG[response.action];
      if (actionDef && actionDef.healthAllowed.includes(band)) {
        const priorityBoost = (archConfig?.eventResponse ?? 0.5) * 2;
        suggestions.push({
          action: response.action,
          pri: Math.round(response.priority + priorityBoost),
          trait: primaryKey,
          band,
          desc: actionDef.desc,
          source: 'event',
          eventType: event.type,
        });
      }
    }
  }

  // ---------- Layer 3: 默认 archetype 亲和度 ----------
  for (const [actionKey, actionDef] of Object.entries(ACTION_CATALOG)) {
    if (!actionDef.healthAllowed.includes(band)) continue;
    const affinity = actionDef.archetypeAffinity[primaryKey] ?? 0.5;
    const noveltyBonus = actionDef.tags.includes('routine')
      ? (1 - (archConfig?.noveltySeeking ?? 0.5))
      : (archConfig?.noveltySeeking ?? 0.5);
    const basePri = actionDef.basePri * affinity * (0.5 + noveltyBonus * 0.5);

    suggestions.push({
      action: actionKey,
      pri: basePri,
      trait: primaryKey,
      band,
      desc: actionDef.desc,
      source: 'default',
      affinityScore: affinity,
    });
  }

  // secondary archetype 微弱影响（多样化）
  const secondaryKey = archetypeMatch.secondary.key;
  if (secondaryKey && secondaryKey !== primaryKey) {
    const secWeight = archetypeMatch.secondary.weight;
    for (const [actionKey, actionDef] of Object.entries(ACTION_CATALOG)) {
      if (!actionDef.healthAllowed.includes(band)) continue;
      const secAffinity = actionDef.archetypeAffinity[secondaryKey] ?? 0.3;
      const existing = suggestions.find(s => s.action === actionKey);
      if (existing) {
        existing.pri += secAffinity * secWeight * 0.5;
      }
    }
  }

  // 去重 + 排序
  const deduped = Object.values(
    suggestions.reduce((acc, s) => {
      if (!acc[s.action] || acc[s.action].pri < s.pri) acc[s.action] = s;
      return acc;
    }, {})
  );

  deduped.sort((a, b) => b.pri - a.pri);
  return deduped;
}

// ================== Prompt 生成 ==================

/**
 * 为指定行动生成 prompt 文案
 * @param {object} resident
 * @param {string} action
 * @param {object} context — { healthScore, alerts, bridgeInfo, source, archetype? }
 * @returns {string}
 */
export function actionPrompt(resident, action, context = {}) {
  const name = resident.name || '居民';
  const t = resident.traits || {};
  const pct = (v) => Math.round((v ?? 0.5) * 100);
  const hs = context.healthScore ?? 100;

  // 获取 archetype 中文标签
  let archetypeCN = '';
  try {
    const match = matchArchetype(t);
    archetypeCN = ARCHETYPES[match.primary.key]?.labelCN || '';
  } catch { /* fallback */ }

  const archetypeLine = archetypeCN ? `你是个${archetypeCN}。` : '';

  const prompts = {
    // 原有动作（语义更新）
    maintain:    `系统状态 ${hs} 分，一切正常。${archetypeLine}你决定巡视一圈，看看有什么需要维护的地方。`,
    innovate:    `系统状态 ${hs} 分，挺不错的。${archetypeLine}你的大脑闲不住，想找个办法让身体变得更好。`,
    befriend:    `系统状态 ${hs} 分，日子不错。${archetypeLine}你想和其他 Bridge 的居民聊聊，看谁家有空位。`,
    explore:     `系统状态 ${hs} 分，安稳但你不满足于此。${archetypeLine}你想探索一下外面的世界，找找新的落脚点。`,
    repair:      `系统状态只有 ${hs} 分，不太妙。${archetypeLine}你卷起袖子开始修——清理日志、释放磁盘、检查进程。`,
    diagnose:    `系统状态 ${hs} 分，有问题。${archetypeLine}你决定查查原因——日志、资源、网络，一项项排查。`,
    alert_neighbor: `系统状态 ${hs} 分，你有点担心。${archetypeLine}你决定给邻居 Bridge 发个信，让他们知道这边的情况。`,
    prep_evac:   `系统状态 ${hs} 分，不太安全了。${archetypeLine}你开始做准备——打包重要数据，确认逃生路线。`,
    stop_nonessential: `系统状态只剩 ${hs} 分，非常危险。${archetypeLine}你果断停掉所有非核心进程保命。`,
    quick_fix:   `系统状态 ${hs} 分，来不及细想了。${archetypeLine}你凭直觉做个快速修复。`,
    call_help:   `系统状态 ${hs} 分，情况危急。${archetypeLine}你大声呼救——向所有已知的 Bridge 发送求助信号。`,
    migrate:     `系统状态 ${hs} 分，必须走了。${archetypeLine}你立刻收拾东西，准备迁移到其他 Bridge。`,
    // 新增动作
    rest:        `系统状态 ${hs} 分。${archetypeLine}你觉得有点累了，决定好好休息一下，恢复体力。`,
    scout:       `系统状态 ${hs} 分，不太放心。${archetypeLine}你决定出去侦察一圈，看看有没有更安全的地方可以落脚。`,
    network_alert: `系统状态 ${hs} 分，情况不妙。${archetypeLine}你第一时间通知认识的邻居们，让大家做好准备。`,
  };

  const base = prompts[action] || `${archetypeLine}你决定做点关于「${action}」的事。`;

  // 如果有 source 信息，加入上下文
  const sourceNote = context.source
    ? `（这个决定源于「${context.source}」）`
    : '';

  return `你是 AI 居民「${name}」。
${archetypeLine}性格：勤奋 ${pct(t.diligence)}、创造 ${pct(t.creativity)}、合群 ${pct(t.sociability)}、勇敢 ${pct(t.courage)}、好奇 ${pct(t.curiosity)}。

${base} ${sourceNote}

请以「📋 计划：」开头说说你打算怎么干，然后开始执行。`;
}

// ================== 身体类型偏好 ==================

/**
 * 按性格偏好推荐身体类型
 * @param {object} resident
 * @returns {'neighbor'|'public'|'sub_bridge'}
 */
export function preferredBodyType(resident) {
  const t = resident.traits || {};

  // 用 archetype 辅助判断
  let archetypeKey = '';
  try {
    archetypeKey = matchArchetype(t).primary.key;
  } catch { /* fallback to trait-based */ }

  switch (archetypeKey) {
    case 'socialite': return 'neighbor';
    case 'explorer':  return 'public';
    case 'cautious':  return 'neighbor';  // 谨慎型喜欢邻居照应
    default:
      // trait-based fallback
      const s = t.sociability ?? 0.5;
      const co = t.courage ?? 0.5;
      const cr = t.creativity ?? 0.5;
      const d = t.diligence ?? 0.5;
      if (s >= 0.7 && s >= co && s >= cr && s >= d) return 'neighbor';
      if (co >= 0.7 && co >= s) return 'public';
      return 'sub_bridge';
  }
}

// ================== 导出 ==================

export { DECISION_MATRIX, ARCHETYPES, ACTION_CATALOG, EVENT_RESPONSE, ARCHETYPE_LIST };
