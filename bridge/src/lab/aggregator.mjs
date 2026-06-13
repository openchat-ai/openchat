// aggregator.mjs — 把 history 按 description 分组, 给每个 "experiment" 算 pass rate
//
// 假设: 相同 description = 同一个 experiment
// (如果 description 变体多, 后续 P2 可以加 normalization / experimentId 字段)
//
// 输出: per-experiment 统计: total, success, failed, successRate, avgDurationMs, last5Success, lastRunAt

import { listHistory } from './history.mjs';

export function getExperimentStats() {
  const all = listHistory();
  if (all.length === 0) return [];

  // group by description
  const groups = new Map();
  for (const r of all) {
    if (!groups.has(r.description)) groups.set(r.description, []);
    groups.get(r.description).push(r);
  }

  // calc stats per group
  const stats = [];
  for (const [desc, runs] of groups) {
    const total = runs.length;
    const success = runs.filter(r => r.status === 'done').length;
    const failed = total - success;
    const totalDuration = runs.reduce((s, r) => s + (r.durationMs || 0), 0);
    const sortedByTime = [...runs].sort((a, b) => b.finishedAt - a.finishedAt);
    const last5 = sortedByTime.slice(0, 5);
    const last5Success = last5.filter(r => r.status === 'done').length;

    stats.push({
      description: desc,
      total,
      success,
      failed,
      successRate: success / total,
      avgDurationMs: totalDuration / total,
      last5Success,
      lastRunAt: sortedByTime[0]?.finishedAt,
    });
  }

  // sort by description
  stats.sort((a, b) => a.description.localeCompare(b.description));
  return stats;
}
