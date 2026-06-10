// calendar-parse: 施工日历解析 + 阈值动态调整
// 纯函数, 无外部依赖

// === invariants ===
// - phase 枚举: concrete 浇筑, lifting 吊装, finishing 收尾, rest 休整, unknown
// - 默认 thresholds: { leakMa: 30, arcEnergy: 0.15, overloadKw: 50 }
// - currentDate 不传 = calendar 最后一天
// - 调整百分比硬编码
// - 同一日期同 phase 只输出一条 (合并)

const PHASE_RULES = {
  concrete:  { name: '浇筑',  leakMaFactor: 1.0,  arcEnergyFactor: 1.0,  overloadKwFactor: 1.5,  reason: '浇筑期大功率设备集中, 过载阈值上调 50%' },
  lifting:   { name: '吊装',  leakMaFactor: 0.9,  arcEnergyFactor: 1.0,  overloadKwFactor: 1.0,  reason: '吊装期人员高空作业, 漏电阈值下调 10% 严防触电' },
  finishing: { name: '收尾',  leakMaFactor: 1.0,  arcEnergyFactor: 0.8,  overloadKwFactor: 1.0,  reason: '收尾期临时线路多, 电弧敏感度上调, 阈值下调 20%' },
  rest:      { name: '休整',  leakMaFactor: 1.0,  arcEnergyFactor: 1.0,  overloadKwFactor: 1.0,  reason: '休整期无人施工, 阈值恢复默认' },
  unknown:   { name: '未知',  leakMaFactor: 1.0,  arcEnergyFactor: 1.0,  overloadKwFactor: 1.0,  reason: '未识别 phase, 保守采用默认阈值' },
};

const DEFAULT_THRESHOLDS = { leakMa: 30, arcEnergy: 0.15, overloadKw: 50 };

function normalizePhase(p) {
  if (!p || typeof p !== 'string') return 'unknown';
  const s = p.trim().toLowerCase();
  if (s.includes('浇筑') || s === 'concrete' || s === 'pour') return 'concrete';
  if (s.includes('吊装') || s === 'lifting' || s === 'crane') return 'lifting';
  if (s.includes('收尾') || s === 'finishing' || s === 'finish') return 'finishing';
  if (s.includes('休整') || s === 'rest' || s === 'idle') return 'rest';
  return 'unknown';
}

function parse(calendar) {
  if (!Array.isArray(calendar)) throw new RangeError('calendar must be array');
  const phases = {};
  let minDate = null, maxDate = null;
  for (const day of calendar) {
    if (!day || typeof day !== 'object' || !day.date) continue;
    const ph = normalizePhase(day.phase);
    phases[ph] = (phases[ph] || 0) + 1;
    if (!minDate || day.date < minDate) minDate = day.date;
    if (!maxDate || day.date > maxDate) maxDate = day.date;
  }
  return {
    days: calendar.filter(d => d && d.date).length,
    phases,
    dateRange: minDate && maxDate ? [minDate, maxDate] : null,
  };
}

function suggest(calendar, thresholds, currentDate) {
  if (!Array.isArray(calendar)) throw new RangeError('calendar must be array');
  const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
  const targetDate = currentDate || (calendar.length ? calendar[calendar.length - 1].date : null);
  const target = calendar.find(d => d && d.date === targetDate);
  if (!target) {
    return { currentPhase: 'unknown', currentDate: targetDate, suggestions: [] };
  }
  const ph = normalizePhase(target.phase);
  const rule = PHASE_RULES[ph];
  const adjusted = {
    leakMa: Math.round(t.leakMa * rule.leakMaFactor * 10) / 10,
    arcEnergy: Math.round(t.arcEnergy * rule.arcEnergyFactor * 1000) / 1000,
    overloadKw: Math.round(t.overloadKw * rule.overloadKwFactor * 10) / 10,
  };
  const action = [];
  if (rule.leakMaFactor !== 1) action.push(`漏电 ${t.leakMa}→${adjusted.leakMa}mA`);
  if (rule.arcEnergyFactor !== 1) action.push(`电弧 ${t.arcEnergy}→${adjusted.arcEnergy}`);
  if (rule.overloadKwFactor !== 1) action.push(`过载 ${t.overloadKw}→${adjusted.overloadKw}kW`);

  const suggestions = [{
    date: target.date,
    phase: ph,
    phaseName: rule.name,
    action: action.length ? action.join('; ') : '保持默认',
    reason: rule.reason,
    adjusted,
  }];

  // 顺便给出未来 7 天的预告
  const targetIdx = calendar.findIndex(d => d && d.date === targetDate);
  for (let i = targetIdx + 1; i < Math.min(calendar.length, targetIdx + 8); i++) {
    const next = calendar[i];
    if (!next || !next.date) continue;
    const nextPh = normalizePhase(next.phase);
    if (nextPh === ph) continue; // 相同 phase 跳过
    const nextRule = PHASE_RULES[nextPh];
    suggestions.push({
      date: next.date,
      phase: nextPh,
      phaseName: nextRule.name,
      action: '预告',
      reason: `未来切换到 ${nextRule.name}, 届时调整: ${nextRule.reason}`,
      adjusted: {
        leakMa: Math.round(t.leakMa * nextRule.leakMaFactor * 10) / 10,
        arcEnergy: Math.round(t.arcEnergy * nextRule.arcEnergyFactor * 1000) / 1000,
        overloadKw: Math.round(t.overloadKw * nextRule.overloadKwFactor * 10) / 10,
      },
    });
  }

  return { currentPhase: ph, currentDate: target.date, suggestions };
}

export { parse, suggest, normalizePhase, PHASE_RULES, DEFAULT_THRESHOLDS };
export default { parse, suggest, normalizePhase };
