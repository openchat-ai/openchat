// digest.mjs — 分析最近 N 次运行，输出退化/趋势/建议
// Phase 1: 结构化统计
// Phase 2: LLM 自然语言报告（通过实验 42）

// === invariants ===
// - 只读操作，不修改历史
// - stats 全为 0 时输出 "no data"
// - LLM 报告靠实验 42，失败降级为纯统计

import { listHistory } from './history.mjs';

export function computeDigest(N = 20) {
  const all = listHistory();
  if (all.length === 0) return { ok: false, reason: 'no history data', experiments: [], summary: null };

  const recent = all.slice(-N);
  const older = all.length > N ? all.slice(-N * 2, -N) : [];

  // 按实验分组
  const groups = {};
  for (const r of recent) {
    const desc = r.description || 'unknown';
    if (!groups[desc]) groups[desc] = { runs: [], total: 0, success: 0, failed: 0, totalDurationMs: 0 };
    groups[desc].runs.push(r);
    groups[desc].total++;
    if (r.status === 'done') groups[desc].success++;
    else groups[desc].failed++;
    groups[desc].totalDurationMs += (r.durationMs || 0);
  }

  // 旧周期统计（趋势对比）
  const oldGroups = {};
  for (const r of older) {
    const desc = r.description || 'unknown';
    if (!oldGroups[desc]) oldGroups[desc] = { total: 0, success: 0 };
    oldGroups[desc].total++;
    if (r.status === 'done') oldGroups[desc].success++;
  }

  const experiments = Object.entries(groups).map(([desc, g]) => {
    const old = oldGroups[desc];
    const oldRate = old ? old.success / old.total : null;
    const recentRate = g.success / g.total;
    const trend = oldRate !== null ? (recentRate - oldRate) : null;
    return {
      description: desc,
      total: g.total,
      success: g.success,
      failed: g.failed,
      successRate: g.total > 0 ? +(g.success / g.total).toFixed(3) : 0,
      avgDurationMs: g.total > 0 ? Math.round(g.totalDurationMs / g.total) : 0,
      trend: trend !== null ? +(trend * 100).toFixed(1) : null, // 百分比变化
      oldSuccessRate: oldRate !== null ? +oldRate.toFixed(3) : null,
    };
  });

  experiments.sort((a, b) => a.successRate - b.successRate); // 最差在前

  const totalRecent = recent.length;
  const totalSuccess = recent.filter(r => r.status === 'done').length;
  const totalFailed = recent.filter(r => r.status === 'failed').length;
  const overallRate = totalRecent > 0 ? +(totalSuccess / totalRecent).toFixed(3) : 0;
  const oldOverallRate = older.length > 0 ? +(older.filter(r => r.status === 'done').length / older.length).toFixed(3) : null;

  const summary = {
    totalRuns: totalRecent,
    success: totalSuccess,
    failed: totalFailed,
    successRate: overallRate,
    oldSuccessRate: oldOverallRate,
    trend: oldOverallRate !== null ? +((overallRate - oldOverallRate) * 100).toFixed(1) : null,
    degradedExperiments: experiments.filter(e => e.trend !== null && e.trend < -10),
    improvedExperiments: experiments.filter(e => e.trend !== null && e.trend > 10),
  };

  return { ok: true, experiments, summary, totalRuns: all.length };
}

export function formatDigestText(digest) {
  if (!digest.ok) return `digest: ${digest.reason}`;
  const { summary, experiments } = digest;
  let out = `📊 Digest (last ${summary.totalRuns} runs)\n`;
  out += `  Pass: ${summary.success}/${summary.totalRuns} (${(summary.successRate * 100).toFixed(0)}%)\n`;
  if (summary.oldSuccessRate !== null) {
    const arrow = summary.trend > 0 ? '↑' : summary.trend < 0 ? '↓' : '→';
    out += `  Trend: ${arrow} ${Math.abs(summary.trend).toFixed(1)}% (was ${(summary.oldSuccessRate * 100).toFixed(0)}%)\n`;
  }
  if (summary.degradedExperiments.length > 0) {
    out += `\n  🔴 Degraded:\n`;
    for (const e of summary.degradedExperiments) {
      out += `    ${e.description.slice(0, 50)}: ${e.successRate * 100}% (${e.trend > 0 ? '+' : ''}${e.trend}%)\n`;
    }
  }
  if (summary.improvedExperiments.length > 0) {
    out += `\n  🟢 Improved:\n`;
    for (const e of summary.improvedExperiments) {
      out += `    ${e.description.slice(0, 50)}: ${e.successRate * 100}% (${e.trend > 0 ? '+' : ''}${e.trend}%)\n`;
    }
  }
  out += `\n  Bottom 5 (lowest pass rate):\n`;
  for (const e of experiments.slice(0, 5)) {
    const t = e.trend !== null ? ` (${e.trend > 0 ? '+' : ''}${e.trend}%)` : '';
    out += `    ${(e.successRate * 100).toFixed(0)}% ${e.description.slice(0, 45)}${t}\n`;
  }
  return out;
}

// LLM 增强 digest
export async function llmDigest(N = 20) {
  const digest = computeDigest(N);
  if (!digest.ok) return digest;
  const text = formatDigestText(digest);
  return { ok: true, text, digest };
}

export const META = { id: 'digest' };
