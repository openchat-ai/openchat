#!/usr/bin/env node
// lab.mjs — 无人参与实验室 CLI (P0 + P1)
//   P0: goal queue + run-next/run-all
//   P1: history / aggregate / regression / backfill
//
// 用法:
//   node bin/lab.mjs add "<goal>"       加 goal 到队列
//   node bin/lab.mjs list               列所有 goal
//   node bin/lab.mjs status             看状态计数
//   node bin/lab.mjs run-next           拉下一个 pending 跑
//   node bin/lab.mjs run-all            跑完所有 pending
//   node bin/lab.mjs history            看 run 历史 (last 20)
//   node bin/lab.mjs aggregate          per-experiment pass/fail 表
//   node bin/lab.mjs regression         baseline vs recent 回归检测
//   node bin/lab.mjs backfill           从 queue.jsonl 补 history (P0→P1 一次)
//
// 存储:
//   ~/.openchat/lab/queue.jsonl   — live 状态 (goal-queue.mjs 管)
//   ~/.openchat/lab/history.jsonl — append-only run log (history.mjs 管)
//
// 后续 (P2+):
//   - lab.mjs run-cron (定时跑)
//   - lab.mjs show <id> (看单个 goal 详情)
//   - lab.mjs retry <id> (失败重置回 pending)
//   - lab.mjs dashboard (P3)

import { addGoal, listGoals, getStatus } from '../src/lab/goal-queue.mjs';
import { runNext, runAll } from '../src/lab/runner.mjs';
import { listHistory, backfillFromQueue } from '../src/lab/history.mjs';
import { getExperimentStats } from '../src/lab/aggregator.mjs';
import { detectRegressions } from '../src/lab/regression.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function showUsage() {
  console.log('Usage:');
  console.log('  lab.mjs add "<goal>"       add goal to queue');
  console.log('  lab.mjs list               list all goals');
  console.log('  lab.mjs status             show counts');
  console.log('  lab.mjs run-next           pick first pending, run it');
  console.log('  lab.mjs run-all            drain all pending');
  console.log('  lab.mjs history            show last 20 run records');
  console.log('  lab.mjs aggregate          per-experiment pass/fail table');
  console.log('  lab.mjs regression         detect regressions vs baseline');
  console.log('  lab.mjs backfill           import queue done/failed into history');
}

if (cmd === 'add') {
  const description = args[1];
  if (!description) {
    console.error('Usage: lab.mjs add "<goal description>"');
    process.exit(1);
  }
  const goal = addGoal(description);
  console.log(`Added: ${goal.id}`);
  console.log(`  ${goal.description.slice(0, 80)}${goal.description.length > 80 ? '...' : ''}`);
  console.log(`  queue: ${JSON.stringify(getStatus())}`);

} else if (cmd === 'list' || cmd === 'ls') {
  const goals = listGoals();
  if (goals.length === 0) {
    console.log('(empty queue)');
  } else {
    console.log('STATUS     ID                       ADDED                  DESCRIPTION');
    console.log('--------   --------------------     -------------------    ----------------------------------------');
    for (const g of goals) {
      const status = g.status.padEnd(10);
      const id = g.id.padEnd(22);
      const time = new Date(g.addedAt).toISOString().slice(0, 19).replace('T', ' ');
      const desc = g.description.length > 60
        ? g.description.slice(0, 57) + '...'
        : g.description;
      console.log(`${status} ${id}  ${time}  ${desc}`);
    }
  }

} else if (cmd === 'status') {
  console.log(JSON.stringify(getStatus(), null, 2));

} else if (cmd === 'run-next') {
  const r = await runNext();
  if (!r.ok && r.reason === 'no pending goal') {
    console.log('(no pending goal)');
  } else if (r.ok) {
    const sec = (r.result.durationMs / 1000).toFixed(1);
    console.log(`\n[lab] ${r.goal.id}: ${r.result.ok ? 'OK' : 'FAIL'} (exit ${r.result.exitCode}, ${sec}s)`);
  }

} else if (cmd === 'run-all') {
  const results = await runAll();
  console.log(`\n[lab] ran ${results.length} goal(s)`);
  for (const r of results) {
    console.log(`  ${r.goal.id}: ${r.result?.ok ? 'OK' : 'FAIL'}`);
  }

} else if (cmd === 'history') {
  const runs = listHistory();
  if (runs.length === 0) {
    console.log('(no history — run some goals first, or use "backfill")');
  } else {
    const last = runs.slice(-20).reverse();
    console.log('FINISHED              STATUS     DURATION  GOAL-ID               DESCRIPTION');
    console.log('-------------------   --------   --------  --------------------   ----------------------------------------');
    for (const r of last) {
      const time = new Date(r.finishedAt).toISOString().slice(0, 19).replace('T', ' ');
      const status = (r.status || 'unknown').padEnd(10);
      const dur = `${((r.durationMs || 0) / 1000).toFixed(1)}s`.padEnd(9);
      const id = (r.goalId || '').padEnd(22);
      const desc = r.description && r.description.length > 50
        ? r.description.slice(0, 47) + '...'
        : (r.description || '');
      console.log(`${time}  ${status}  ${dur}  ${id}  ${desc}`);
    }
    console.log(`\n(showing last ${last.length} of ${runs.length} total)`);
  }

} else if (cmd === 'aggregate') {
  const stats = getExperimentStats();
  if (stats.length === 0) {
    console.log('(no runs yet — run some goals first, or use "backfill")');
  } else {
    console.log('DESCRIPTION                                RUNS  PASS  FAIL  RATE    AVG_DUR  LAST5');
    console.log('----------------------------------------   ----  ----  ----  ------  -------  -----');
    for (const s of stats) {
      const desc = s.description.padEnd(40).slice(0, 40);
      const runs = String(s.total).padStart(5);
      const pass = String(s.success).padStart(5);
      const fail = String(s.failed).padStart(5);
      const rate = `${(s.successRate * 100).toFixed(0)}%`.padStart(7);
      const dur = `${(s.avgDurationMs / 1000).toFixed(1)}s`.padStart(8);
      const last5 = `${s.last5Success}/5`.padStart(6);
      console.log(`${desc}  ${runs}  ${pass}  ${fail}  ${rate}  ${dur}  ${last5}`);
    }
  }

} else if (cmd === 'regression') {
  const r = detectRegressions();
  if (r.message) {
    console.log(`(skipped: ${r.message})`);
  } else {
    if (r.regressions.length > 0) {
      console.log(`REGRESSIONS (${r.regressions.length}):`);
      for (const reg of r.regressions) {
        console.log(`  [${reg.type}] ${reg.message}`);
      }
    } else {
      console.log('REGRESSIONS (0)');
    }
    if (r.improvements.length > 0) {
      console.log(`\nIMPROVEMENTS (${r.improvements.length}):`);
      for (const imp of r.improvements) {
        console.log(`  ${imp.message}`);
      }
    } else {
      console.log('IMPROVEMENTS (0)');
    }
  }

} else if (cmd === 'backfill') {
  const r = backfillFromQueue();
  console.log(`backfill: imported ${r.imported} run(s) from queue.jsonl`);

} else {
  showUsage();
}
