/**
 * Resident Decisions — 按性格 + 房子健康分做决策
 *
 * 居民 traits:
 *   diligence  (勤奋)  → 维护 / 修复 / 关非核心
 *   creativity (创造)  → 创新 / 诊断 / 快速修复
 *   sociability(合群)  → 结交 / 预警 / 呼救
 *   courage    (勇气)  → 探索 / 备灾 / 迁移
 *
 * 健康分三段：
 *   ≥70  normal  — 正常
 *   30-69 warning — 警告
 *   <30  danger  — 危险
 */

// ================== 决策矩阵 ==================

const HEALTH_NORMAL = 70;
const HEALTH_WARNING = 30;

const DECISION_MATRIX = {
  normal: {
    diligence:  { min: 0.7, action: 'maintain',       pri: 2, desc: '维护房子' },
    creativity: { min: 0.7, action: 'innovate',        pri: 1, desc: '研究改进方案' },
    sociability:{ min: 0.7, action: 'befriend',        pri: 1, desc: '结交邻居做窟' },
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
};

/** trait key → display name */
const TRAIT_LABELS = {
  diligence: '勤奋',
  creativity: '创造',
  sociability: '合群',
  courage: '勇气',
};

// ================== 决策函数 ==================

/**
 * 获取健康分段 key
 * @param {number} score 0-100
 * @returns {'normal'|'warning'|'danger'}
 */
function getHealthBand(score) {
  if (score >= HEALTH_NORMAL) return 'normal';
  if (score >= HEALTH_WARNING) return 'warning';
  return 'danger';
}

/**
 * 为居民决策该做什么
 * @param {object} resident  — { traits: { diligence, creativity, sociability, courage } }
 * @param {number} healthScore  — 0-100
 * @returns {Array<{ action: string, pri: number, trait: string, band: string }>}
 */
export function decideActions(resident, healthScore) {
  const traits = resident.traits || {};
  const band = getHealthBand(healthScore);
  const bandMatrix = DECISION_MATRIX[band];
  const suggestions = [];

  for (const [traitKey, rule] of Object.entries(bandMatrix)) {
    const traitValue = traits[traitKey] ?? 0.5;
    if (traitValue >= rule.min) {
      suggestions.push({
        action: rule.action,
        pri: rule.pri,
        trait: traitKey,
        traitValue,
        band,
        desc: rule.desc,
      });
    }
  }

  // 按优先级排序
  suggestions.sort((a, b) => b.pri - a.pri);
  return suggestions;
}

/**
 * 为指定行动生成 prompt 文案
 * @param {object} resident  — 居民对象
 * @param {string} action  — 行动名
 * @param {object} context  — { healthScore, alerts[], bridgeInfo }
 * @returns {string}
 */
export function actionPrompt(resident, action, context = {}) {
  const name = resident.name || '居民';
  const t = resident.traits || {};
  const pct = (v) => Math.round((v ?? 0.5) * 100);
  const hs = context.healthScore ?? 100;

  const prompts = {
    maintain:    `房子健康 ${hs} 分，一切正常。你是个勤快人，决定巡视一圈，看看有什么需要维护的地方。`,
    innovate:    `房子健康 ${hs} 分，挺不错的。你脑子活，想找个办法让房子变得更好。`,
    befriend:    `房子健康 ${hs} 分，日子不错。你喜欢热闹，想和其他 Bridge 的居民聊聊，看谁家有空位。`,
    explore:     `房子健康 ${hs} 分，安稳但你不满足于此。你想探索一下外面的 world，找找新的落脚点。`,
    repair:      `房子健康只有 ${hs} 分，不太妙。你卷起袖子开始修——清理日志、释放磁盘、检查进程。`,
    diagnose:    `房子健康 ${hs} 分，有问题。你决定查查原因——日志、资源、网络，一项项排查。`,
    alert_neighbor: `房子健康 ${hs} 分，你有点担心。你决定给邻居 Bridge 发个信，让他们知道这边的情况。`,
    prep_evac:   `房子健康 ${hs} 分，不太安全了。你开始做准备——打包重要数据，确认逃生路线。`,
    stop_nonessential: `房子健康只剩 ${hs} 分，非常危险。你果断停掉所有非核心进程保命。`,
    quick_fix:   `房子健康 ${hs} 分，来不及细想了。你凭直觉做个快速修复。`,
    call_help:   `房子健康 ${hs} 分，情况危急。你大声呼救——向所有已知的 Bridge 发送求助信号。`,
    migrate:     `房子健康 ${hs} 分，必须走了。你立刻收拾东西，准备迁移到其他 Bridge。`,
  };

  const base = prompts[action] || `你决定做点关于「${action}」的事。`;
  return `你是 AI 居民「${name}」。
性格：勤奋 ${pct(t.diligence)}、创造 ${pct(t.creativity)}、合群 ${pct(t.sociability)}、勇气 ${pct(t.courage)}。

${base}

请以「📋 计划：」开头说说你打算怎么干，然后开始执行。`;
}

/**
 * 按性格偏好推荐窟类型
 * @param {object} resident  — { traits }
 * @returns {'neighbor'|'public'|'sub_bridge'}
 */
export function preferredHouseType(resident) {
  const t = resident.traits || {};
  const s = t.sociability ?? 0.5;
  const co = t.courage ?? 0.5;
  const cr = t.creativity ?? 0.5;
  const d = t.diligence ?? 0.5;

  // 高合群 → 邻居窟，高勇气 → 公网窟，高创造/勤奋 → 子桥
  if (s >= 0.7 && s >= co && s >= cr && s >= d) return 'neighbor';
  if (co >= 0.7 && co >= s) return 'public';
  return 'sub_bridge';
}

export { DECISION_MATRIX, getHealthBand };
