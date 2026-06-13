#!/usr/bin/env node
// lab.mjs — 无人参与实验室 CLI (P0 + P1 + P2 + P4 + L3-push)
//   P0: goal queue + run-next/run-all
//   P1: history / aggregate / regression / backfill
//   P2: failures / escalated / retry-stats
//   P4: deps / check-affected (改文件 → 知道哪些 experiment 受影响)
//   L3: notify-test (验 phone push 配置, 调 notifier.mjs)
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
//   node bin/lab.mjs failures           看失败 + 分类统计
//   node bin/lab.mjs escalated          列 escalated 记录
//   node bin/lab.mjs retry-stats        retry 统计 (transient 自动修好率)
//   node bin/lab.mjs deps [file]        import 依赖图 (全图 / 单文件)
//   node bin/lab.mjs check-affected     改文件 → 受影响的 experiment 列表
//   node bin/lab.mjs notify-test        发一条假 escalation, 验 notify 配置
//
// 存储:
//   ~/.openchat/lab/queue.jsonl       — live 状态
//   ~/.openchat/lab/history.jsonl     — append-only run log
//   ~/.openchat/lab/escalated.jsonl   — append-only escalate log (P2)
//
// 后续 (L3):
//   - lab.mjs run-cron (定时跑)
//   - lab.mjs show <id> (看单个 goal 详情)
//   - WebSocket 推 → /lab dashboard

// === invariants ===
// - argv 路由到 15 命令, 未知 cmd 走 showUsage
// - exit code 0 总是 (除了 add 缺 description 这种 user error)
// - 走模块函数, 不直接读 jsonl — 让模块的 spec 负责文件格式
// - 固定列宽给 list/history/failures/escalated, 给脚本/grep 抓取
// - 不动 queue.jsonl 的 schema, 加字段走 modules
// - P4 依赖图: 只扫 src/experiments/ + src/lab/ (其它留 P4 续)
// - L3 notify: 默认 off, opt-in via env (OPENCHAT_LAB_NOTIFY=server|webhook)

import { addGoal, listGoals, getStatus, listFailed } from '../src/lab/goal-queue.mjs';
import { runNext, runAll } from '../src/lab/runner.mjs';
import { listHistory, backfillFromQueue } from '../src/lab/history.mjs';
import { getExperimentStats } from '../src/lab/aggregator.mjs';
import { detectRegressions } from '../src/lab/regression.mjs';
import { listEscalated, getEscalationStats } from '../src/lab/escalate.mjs';
import { buildGraph, getGraph, getAffectedExperiments, getFileDependents } from '../src/lab/dependency-graph.mjs';
import { getChangedFiles } from '../src/lab/git-diff.mjs';
import { notify } from '../src/lab/notifier.mjs';

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
  console.log('  lab.mjs failures           show failed goals + classification stats');
  console.log('  lab.mjs escalated          list escalated records');
  console.log('  lab.mjs retry-stats        retry statistics (transient auto-fix rate)');
  console.log('  lab.mjs deps [file]        import graph: all files with importers, or file dependents');
  console.log('  lab.mjs check-affected     show experiments affected by staged+working changes');
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

} else if (cmd === 'failures') {
  const failed = listFailed();
  if (failed.length === 0) {
    console.log('(no failed goals — clean run!)');
  } else {
    // 按 classification.category 分组
    const byCategory = {};
    for (const g of failed) {
      const cat = g.classification?.category || 'unclassified';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
    console.log('FAILED GOALS BY CATEGORY:');
    for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat.padEnd(12)} ${count}`);
    }
    console.log(`\nFAILED GOAL LIST (${failed.length}):`);
    console.log('ID                       RETRY  CATEGORY    REASON                              DESCRIPTION');
    console.log('------------------------  -----  ----------  ----------------------------------  ----------------------------------------');
    for (const g of failed) {
      const id = g.id.padEnd(22);
      const retry = String(g.retryCount || 0).padStart(5);
      const cat = (g.classification?.category || 'unclassified').padEnd(10);
      const reason = (g.classification?.reason || '').slice(0, 32).padEnd(34);
      const desc = g.description.length > 50 ? g.description.slice(0, 47) + '...' : g.description;
      console.log(`${id}  ${retry}  ${cat}  ${reason}  ${desc}`);
    }
  }

} else if (cmd === 'escalated') {
  const records = listEscalated();
  const stats = getEscalationStats();
  if (records.length === 0) {
    console.log('(no escalations)');
  } else {
    console.log(`ESCALATION STATS:`);
    console.log(`  total: ${stats.total}`);
    for (const [cat, count] of Object.entries(stats.byCategory)) {
      console.log(`  ${cat}: ${count}`);
    }
    if (stats.byDescription.length > 0) {
      console.log(`\nTOP ESCALATED EXPERIMENTS:`);
      for (const d of stats.byDescription.slice(0, 5)) {
        console.log(`  ${String(d.count).padStart(3)}x  ${d.description.slice(0, 60)}`);
      }
    }
    console.log(`\nRECENT ESCALATIONS (last 10):`);
    console.log('ESCALATED            ATTEMPTS  CATEGORY    GOAL-ID               DESCRIPTION');
    console.log('-------------------  --------  ----------  --------------------   ----------------------------------------');
    for (const r of records.slice(-10).reverse()) {
      const time = new Date(r.escalatedAt).toISOString().slice(0, 19).replace('T', ' ');
      const att = String(r.attempts).padStart(8);
      const cat = (r.classification?.category || 'unclassified').padEnd(10);
      const id = r.goalId.padEnd(22);
      const desc = r.description.length > 50 ? r.description.slice(0, 47) + '...' : r.description;
      console.log(`${time}  ${att}  ${cat}  ${id}  ${desc}`);
    }
  }

} else if (cmd === 'retry-stats') {
  // 看 history 里所有 transient failure, 算 auto-retry 救回率
  const all = listHistory();
  if (all.length === 0) {
    console.log('(no history yet)');
  } else {
    let transientFails = 0;       // 至少一次 transient
    let transientSucceeded = 0;   // 后续 retry 成功
    let transientExhausted = 0;   // retry 用尽还挂
    const perAttempt = { 1: 0, 2: 0, 3: 0 };  // 按 retryAttempt 分桶
    for (const r of all) {
      if (r.classification?.category === 'transient') perAttempt[r.retryAttempt] = (perAttempt[r.retryAttempt] || 0) + 1;
    }
    // 收集每个 goal 的所有 record, 算最终状态
    const goalHistory = new Map();
    for (const r of all) {
      if (!goalHistory.has(r.goalId)) goalHistory.set(r.goalId, []);
      goalHistory.get(r.goalId).push(r);
    }
    for (const records of goalHistory.values()) {
      const hitTransient = records.some(r => r.classification?.category === 'transient');
      if (!hitTransient) continue;
      transientFails++;
      // 取最后一条 (按 finishedAt)
      const last = records.sort((a, b) => a.finishedAt - b.finishedAt).pop();
      if (last.status === 'done') transientSucceeded++;
      else transientExhausted++;
    }
    console.log('RETRY STATS:');
    console.log(`  goals that hit transient at least once: ${transientFails}`);
    console.log(`  eventually succeeded (auto-retry saved): ${transientSucceeded}`);
    console.log(`  exhausted retries (still failed):        ${transientExhausted}`);
    if (transientFails > 0) {
      const saveRate = ((transientSucceeded / transientFails) * 100).toFixed(0);
      console.log(`  save rate: ${saveRate}%`);
    }
    console.log(`\nATTEMPTS DISTRIBUTION (history):`);
    console.log(`  attempt 1 (initial):  ${perAttempt[1] || 0}`);
    console.log(`  attempt 2 (retry 1):  ${perAttempt[2] || 0}`);
    console.log(`  attempt 3 (retry 2):  ${perAttempt[3] || 0}`);
  }

} else if (cmd === 'deps') {
  // P4: import 依赖图
  // deps [file]  → 单文件 importers
  // deps         → 全部有 importer 的文件
  // 用 getGraph() (git toplevel 为 root) — 跟 git-diff 返回的 path 同 namespace
  const g = getGraph();
  const target = args[1];
  if (target) {
    const norm = target.replace(/\\/g, '/').replace(/^\.\//, '');
    const deps = getFileDependents(norm);
    if (deps.length === 0) {
      console.log(`(no importers of ${norm} — file not in graph or no .mjs imports it)`);
    } else {
      console.log(`IMPORTERS OF ${norm}:`);
      for (const d of deps) console.log(`  ${d}`);
    }
  } else {
    const files = Object.entries(g.files).filter(([_, v]) => v.importers.length > 0);
    if (files.length === 0) {
      console.log('(empty graph — no .mjs imports any tracked file)');
    } else {
      console.log('FILE                                    IMPORTERS');
      console.log('--------------------------------------  ----------------------------------------');
      for (const [f, v] of files.sort((a, b) => b[1].importers.length - a[1].importers.length)) {
        const fp = f.padEnd(38).slice(0, 38);
        console.log(`${fp}  ${v.importers.join(', ')}`);
      }
      console.log(`\n(showing ${files.length} files with >= 1 importer; scanned: ${g.dirs.join(', ')})`);
    }
  }

} else if (cmd === 'check-affected') {
  // P4: git diff → 受影响的 experiment 列表
  // 默认 mode='all' (staged + working 都不漏); 也接受 'staged' / 'working' / 'last'
  const mode = args[1] || 'all';
  const changed = getChangedFiles(mode);
  if (changed.length === 0) {
    console.log(`(no changed files in mode "${mode}")`);
  } else {
    console.log(`CHANGED FILES (${mode}, ${changed.length}):`);
    for (const f of changed) console.log(`  ${f}`);
    const affected = getAffectedExperiments(changed);
    console.log(`\nAFFECTED EXPERIMENTS (${affected.length}):`);
    if (affected.length === 0) {
      console.log('  (none — no experiment imports any of the changed files, and no experiment itself changed)');
    } else {
      for (const a of affected) console.log(`  ${a}`);
    }
    console.log(`\nnext: add goal for each, e.g. lab.mjs add "re-verify ${affected[0] || '<path>'}"`);
  }

} else if (cmd === 'notify-test') {
  // L3: 发一条假 escalation, 验 notify 配置 (Server酱 / webhook)
  // 不写 escalated.jsonl (只是测通道, 不是真挂)
  const mode = process.env.OPENCHAT_LAB_NOTIFY || '(unset)';
  console.log(`OPENCHAT_LAB_NOTIFY = ${mode}`);
  if (mode === 'server') console.log(`OPENCHAT_LAB_SENDKEY = ${process.env.OPENCHAT_LAB_SENDKEY ? '***set***' : '(unset)'}`);
  if (mode === 'webhook') console.log(`OPENCHAT_LAB_WEBHOOK = ${process.env.OPENCHAT_LAB_WEBHOOK ? '***set***' : '(unset)'}`);
  console.log('sending test notification...');
  const fakeRecord = {
    goalId: 'goal-test-notify',
    description: 'L3 notify-test (no real failure)',
    classification: { category: 'config', reason: 'this is a test', retryable: false },
    attempts: 1,
    escalatedAt: Date.now(),
  };
  const r = await notify(fakeRecord);
  console.log(`result: ${JSON.stringify(r, null, 2)}`);

} else {
  showUsage();
}
