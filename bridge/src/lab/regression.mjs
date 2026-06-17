// regression.mjs — 把 history 按时间分两半, 找 regression
//
// 思路:
//   - 全部 run 按 finishedAt 排序
//   - 前 50% = baseline, 后 50% = recent
//   - 按 description 分组, 比 baseline vs recent 的 success rate / duration
//
// 阈值:
//   - success rate 跌 > 20% (绝对值) → regression
//   - success rate 涨 > 20% → improvement
//   - duration > 2x baseline 且 baseline > 1s → regression (避免小数字抖动)
//   - 至少 4 条 run 才检测 (否则 baseline / recent 太少没意义)

import { listHistory } from './history.mjs';

// === invariants ===
// - 事件发射使用 fire-and-forget，不阻塞调用方

const SUCCESS_RATE_DROP_THRESHOLD = 0.2;
const DURATION_MULTIPLIER_THRESHOLD = 2.0;
const MIN_BASELINE_DURATION_MS = 1000;
const MIN_RUNS_FOR_DETECTION = 4;
const BASELINE_SPLIT = 0.5;

function isPass(r) {
  return r.status === 'done' && r.exitCode === 0;
}

function groupByDescription(runs) {
  const groups = new Map();
  for (const r of runs) {
    if (!groups.has(r.description)) groups.set(r.description, []);
    groups.get(r.description).push(r);
  }
  return groups;
}

export function detectRegressions() {
  const all = listHistory();
  if (all.length < MIN_RUNS_FOR_DETECTION) {
    return {
      regressions: [],
      improvements: [],
      message: `need >= ${MIN_RUNS_FOR_DETECTION} runs (have ${all.length})`,
    };
  }

  // sort by time, split
  const sorted = [...all].sort((a, b) => a.finishedAt - b.finishedAt);
  const splitIdx = Math.max(1, Math.floor(sorted.length * BASELINE_SPLIT));
  const baseline = sorted.slice(0, splitIdx);
  const recent = sorted.slice(splitIdx);

  if (baseline.length === 0 || recent.length === 0) {
    return { regressions: [], improvements: [], message: 'baseline or recent empty after split' };
  }

  const baselineByDesc = groupByDescription(baseline);
  const recentByDesc = groupByDescription(recent);

  const regressions = [];
  const improvements = [];

  for (const [desc, recentRuns] of recentByDesc) {
    const baselineRuns = baselineByDesc.get(desc) || [];
    if (baselineRuns.length === 0 || recentRuns.length === 0) continue;

    const baselinePass = baselineRuns.filter(isPass).length;
    const recentPass = recentRuns.filter(isPass).length;
    const baselineSuccess = baselinePass / baselineRuns.length;
    const recentSuccess = recentPass / recentRuns.length;
    const baselineDur = baselineRuns.reduce((s, r) => s + (r.durationMs || 0), 0) / baselineRuns.length;
    const recentDur = recentRuns.reduce((s, r) => s + (r.durationMs || 0), 0) / recentRuns.length;

    const drop = baselineSuccess - recentSuccess;

    if (drop > SUCCESS_RATE_DROP_THRESHOLD) {
      regressions.push({
        description: desc,
        type: 'success-rate-drop',
        baselineRuns: baselineRuns.length,
        recentRuns: recentRuns.length,
        baseline: `${(baselineSuccess * 100).toFixed(0)}%`,
        recent: `${(recentSuccess * 100).toFixed(0)}%`,
        message: `${desc}: success rate ${(baselineSuccess * 100).toFixed(0)}% → ${(recentSuccess * 100).toFixed(0)}% (over ${baselineRuns.length}→${recentRuns.length} runs)`,
      });
    } else if (recentSuccess - baselineSuccess > SUCCESS_RATE_DROP_THRESHOLD) {
      improvements.push({
        description: desc,
        type: 'success-rate-up',
        baseline: `${(baselineSuccess * 100).toFixed(0)}%`,
        recent: `${(recentSuccess * 100).toFixed(0)}%`,
        message: `${desc}: success rate ${(baselineSuccess * 100).toFixed(0)}% → ${(recentSuccess * 100).toFixed(0)}%`,
      });
    }

    if (baselineDur > MIN_BASELINE_DURATION_MS) {
      const durMult = recentDur / baselineDur;
      if (durMult > DURATION_MULTIPLIER_THRESHOLD) {
        regressions.push({
          description: desc,
          type: 'duration-doubled',
          baselineRuns: baselineRuns.length,
          recentRuns: recentRuns.length,
          baseline: `${(baselineDur / 1000).toFixed(1)}s`,
          recent: `${(recentDur / 1000).toFixed(1)}s`,
          mult: `${durMult.toFixed(1)}x`,
          message: `${desc}: duration ${(baselineDur / 1000).toFixed(1)}s → ${(recentDur / 1000).toFixed(1)}s (${durMult.toFixed(1)}x)`,
        });
      }
    }
  }

  return { regressions, improvements };
}
