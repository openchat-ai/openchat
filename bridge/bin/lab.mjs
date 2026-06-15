#!/usr/bin/env node
// lab.mjs — 无人参与实验室 CLI (P0 + P1 + P2 + P4 + P5 + L3-push)
//   P0: goal queue + run-next/run-all
//   P1: history / aggregate / regression / backfill
//   P2: failures / escalated / retry-stats
//   P4: deps / check-affected (改文件 → 知道哪些 experiment 受影响)
//   P5: run-cron / cron-status / cron-stop (定时跑, 真正无人值守)
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
//   node bin/lab.mjs run-cron [ms]      启 cron, 每 N ms 跑一轮 (默认 30 min)
//   node bin/lab.mjs cron-status        看 cron 是否在跑
//   node bin/lab.mjs cron-stop          给 cron 进程发 SIGINT
//   node bin/lab.mjs housekeeping       手动 recoverStaleRunning + purgePollution
//   node bin/lab.mjs notify-test        发一条假 escalation, 验 notify 配置
//
// 存储:
//   ~/.openchat/lab/queue.jsonl       — live 状态
//   ~/.openchat/lab/history.jsonl     — append-only run log
//   ~/.openchat/lab/escalated.jsonl   — append-only escalate log (P2)
//
// 后续 (L3):
//   - lab.mjs show <id> (看单个 goal 详情)
//   - WebSocket 推 → /lab dashboard (已接 L3-WS)

// === invariants ===
// - argv 路由到 17 命令, 未知 cmd 走 showUsage
// - exit code 0 总是 (除了 add 缺 description 这种 user error)
// - 走模块函数, 不直接读 jsonl — 让模块的 spec 负责文件格式
// - 固定列宽给 list/history/failures/escalated, 给脚本/grep 抓取
// - 不动 queue.jsonl 的 schema, 加字段走 modules
// - P4 依赖图: 只扫 src/experiments/ + src/lab/ (其它留 P4 续)
// - P5 cron: pidfile 防双开, 默认 interval 30min (env: OPENCHAT_LAB_CRON_INTERVAL)
// - L3 notify: 默认 off, opt-in via env (OPENCHAT_LAB_NOTIFY=server|webhook)

import { addGoal, listGoals, getStatus, listFailed, getNextPending, updateGoal, housekeeping } from '../src/lab/goal-queue.mjs';
import { runNext, runAll } from '../src/lab/runner.mjs';
import { listHistory, backfillFromQueue } from '../src/lab/history.mjs';
import { getExperimentStats } from '../src/lab/aggregator.mjs';
import { detectRegressions } from '../src/lab/regression.mjs';
import { listEscalated, getEscalationStats } from '../src/lab/escalate.mjs';
import { buildGraph, getGraph, getAffectedExperiments, getFileDependents } from '../src/lab/dependency-graph.mjs';
import { getChangedFiles } from '../src/lab/git-diff.mjs';
import { notify } from '../src/lab/notifier.mjs';
import { startCron, stopCron, isCronRunning, getCronPid } from '../src/lab/cron.mjs';
import { diagnose } from '../src/lab/auto-heal.mjs';

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
  console.log('  lab.mjs bench              run all closed-loop experiments as benchmark');
  console.log('  lab.mjs heal <goal-id>     diagnose and suggest fix for a failed goal');
  console.log('  lab.mjs extract            extract knowledge from latest run results into MEMORY.md');
  console.log('  lab.mjs watch [dir]        watch experiment files, auto-rerun affected on change');
  console.log('  lab.mjs memory             show agent memory summary (facts/preferences/patterns)');
  console.log('  lab.mjs memory --clear     clear agent memory');
  console.log('  lab.mjs run-concurrent [N]  run N pending goals in parallel (default 3)');
  console.log('  lab.mjs aggregate          per-experiment pass/fail table');
  console.log('  lab.mjs regression         detect regressions vs baseline');
  console.log('  lab.mjs backfill           import queue done/failed into history');
  console.log('  lab.mjs failures           show failed goals + classification stats');
  console.log('  lab.mjs escalated          list escalated records');
  console.log('  lab.mjs retry-stats        retry statistics (transient auto-fix rate)');
  console.log('  lab.mjs deps [file]        import graph: all files with importers, or file dependents');
  console.log('  lab.mjs check-affected     show experiments affected by staged+working changes');
  console.log('  lab.mjs run-cron [ms]      start cron, run every N ms (default 30 min, or env OPENCHAT_LAB_CRON_INTERVAL)');
  console.log('  lab.mjs cron-status        show cron running state');
  console.log('  lab.mjs cron-stop          send SIGINT to cron process');
  console.log('  lab.mjs cron-interval <ms>  change cron interval on the fly (e.g. 60000 = 1 min)');
  console.log('  lab.mjs supervisor [ms]     start supervisor loop (default 30s check interval)');
  console.log('  lab.mjs supervisor-stop     stop supervisor');
  console.log('  lab.mjs supervisor-status   show supervisor state');
  console.log('  lab.mjs housekeeping [ms]  manually run recoverStaleRunning + purgePollution');
  console.log('  lab.mjs digest [N]         analyze last N runs, show trend/degradation');
  console.log('  lab.mjs digest --llm [N]   same + LLM natural language report');
  console.log('  lab.mjs explore            discover untested dep combinations');
  console.log('  lab.mjs costs              per-experiment cost breakdown (from history)');
  console.log('  lab.mjs heal-auto          auto-diagnose + auto-patch all failed goals');
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

} else if (cmd === 'run-concurrent') {
  const concurrency = parseInt(args[1], 10) || 3;
  const allResults = [];
  let running = 0;
  let idx = 0;
  const pending = listGoals().filter(g => g.status === 'pending');
  if (pending.length === 0) { console.log('(no pending goals)'); process.exit(0); }
  console.log(`run-concurrent: ${pending.length} pending, concurrency=${concurrency}`);
  const next = () => {
    if (idx >= pending.length) return;
    const goal = pending[idx++];
    running++;
    runNext(goal.id).then(r => {
      allResults.push(r);
      const sec = r.result ? (r.result.durationMs / 1000).toFixed(1) : '?';
      console.log(`  ${r.result?.ok ? '✅' : '❌'} ${sec}s  ${r.goal.description.slice(0, 50)}`);
      running--;
      if (idx < pending.length) next();
      else if (running === 0) {
        const pass = allResults.filter(x => x.result?.ok).length;
        console.log(`\nconcurrent done: ${allResults.length} runs, ${pass}/${allResults.length} pass`);
      }
    });
  };
  for (let i = 0; i < Math.min(concurrency, pending.length); i++) next();

} else if (cmd === 'bench') {
  const _benchModel = (() => {
    const idx = args.indexOf('--model');
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  })();
  const { readFileSync, writeFileSync, existsSync } = await import('fs');
  // 如果指定了 --model，临时修改 config
  let originalConfig = null;
  if (_benchModel) {
    try {
      const config = await import('./lib/config.mjs');
      const cfg = config.persistentConfig.config;
      originalConfig = { model: cfg.current?.model, provider: cfg.current?.provider };
      if (!cfg.current) cfg.current = {};
      cfg.current.model = _benchModel;
      config.persistentConfig.save(cfg);
      console.log(`bench: switched model to "${_benchModel}"`);
    } catch (e) {
      console.error(`bench: failed to switch model: ${e.message}`);
      process.exit(1);
    }
  }
  const manifestPath = new URL('../src/experiments/manifest.json', import.meta.url);
  if (!existsSync(manifestPath)) { console.error('manifest.json not found'); process.exit(1); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const experiments = manifest.experiments || [];
  const existing = listGoals().map(g => g.description);
  for (const exp of experiments) {
    if (exp.status !== 'closed-loop') continue;
    const desc = `实验 ${exp.file.replace(/\.mjs$/, '')}: ${exp.name}`;
    if (!existing.includes(desc)) addGoal(desc);
  }
  const allResults = await runAll();
  // 恢复 original model
  if (originalConfig) {
    try {
      const config = await import('./lib/config.mjs');
      const cfg = config.persistentConfig.config;
      cfg.current = cfg.current || {};
      cfg.current.model = originalConfig.model;
      cfg.current.provider = originalConfig.provider;
      config.persistentConfig.save(cfg);
      console.log(`bench: restored model to "${originalConfig.model || '(default)'}"`);
    } catch {}
  }
  const modelTag = _benchModel ? ` [model:${_benchModel}]` : '';
  const pass = allResults.filter(r => r.result?.ok).length;
  const fail = allResults.filter(r => !r.result?.ok).length;
  console.log(`\n📊 Benchmark${modelTag}: ${allResults.length} experiments, ${pass} pass, ${fail} fail`);
  for (const r of allResults) {
    const sec = r.result ? (r.result.durationMs / 1000).toFixed(1) : '?';
    const status = r.result?.ok ? '✅' : '❌';
    console.log(`  ${status} ${sec}s  ${r.goal.description.slice(0, 60)}`);
  }
  console.log(`\n💰 Total${modelTag}: ${allResults.length} runs, ${pass}/${allResults.length} pass (${allResults.length > 0 ? Math.round(pass/allResults.length*100) : 0}%)`);

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

} else if (cmd === 'heal') {
  const goalId = args[1];
  if (!goalId) { console.error('Usage: lab.mjs heal <goal-id>'); process.exit(1); }
  const { healGoal } = await import('../src/lab/auto-heal.mjs');
  const r = await healGoal(goalId);
  if (!r.ok) { console.error(`heal failed: ${r.error}`); process.exit(1); }
  console.log(`Goal: ${r.goal.description.slice(0, 60)}`);
  console.log(`Status: ${r.goal.status}`);
  console.log(`Pattern: ${r.diagnosis?.pattern || 'unknown'}`);
  console.log(`Severity: ${r.diagnosis?.severity || '?'}`);
  console.log(`Suggestion: ${r.diagnosis?.suggestion || 'none'}`);
  console.log(`Confidence: ${r.diagnosis?.confidence || 'low'}`);

} else if (cmd === 'extract') {
  const runs = listHistory().slice(-50);
  if (runs.length === 0) { console.log('no history to extract'); process.exit(0); }
  const { extract } = await import('../src/lab/knowledge-extract.mjs');
  const r = await extract(runs);
  if (r.wrote) console.log(`extracted ${r.linesAdded} lines to ${r.path}`);
  else console.log('nothing to extract');

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

} else if (cmd === 'housekeeping') {
  // 自治 housekeeping: 手动跑 (runNext 也会自动调)
  // 用法: lab.mjs housekeeping         (默认 30min threshold)
  //      lab.mjs housekeeping 600000   (override threshold)
  //      lab.mjs housekeeping --no-purge  (只 recover, 不删 pollution)
  const argMs = args[1] && !args[1].startsWith('--') ? parseInt(args[1], 10) : null;
  const skipPurge = args.includes('--no-purge');
  const r = housekeeping({ thresholdMs: argMs, skipPurge });
  console.log(`recovered: ${r.recovered.length} stale running goal(s)`);
  for (const x of r.recovered) {
    console.log(`  ${x.id} (stuck ${(x.stuckMs/1000/60).toFixed(0)} min): ${x.description.slice(0, 60)}`);
  }
  console.log(`purged: ${r.purged.length} pollution goal(s)`);
  for (const x of r.purged) {
    console.log(`  ${x.id} (pattern: ${x.pattern}): ${x.description.slice(0, 60)}`);
  }
  if (r.recovered.length === 0 && r.purged.length === 0) console.log('(nothing to clean)');

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

} else if (cmd === 'run-cron') {
  // P5: 启 cron, 持续循环拉 runNext
  // 用法: lab.mjs run-cron            (默认 30 min, 或 env OPENCHAT_LAB_CRON_INTERVAL)
  //      lab.mjs run-cron 60000       (override 1 min, 调试用)
  const argMs = args[1] ? parseInt(args[1], 10) : null;
  const opts = {};
  if (argMs) opts.intervalMs = argMs;
  const h = startCron(opts);
  if (!h.ok) {
    console.log(`(refused: ${h.reason}${h.pid ? `, existing pid=${h.pid}` : ''})`);
    process.exit(1);
  }
  console.log(`cron started (pid=${h.pid}, interval=${(h.intervalMs/1000).toFixed(0)}s)`);
  console.log(`OPENCHAT_LAB_CRON_INTERVAL env: ${process.env.OPENCHAT_LAB_CRON_INTERVAL || '(unset)'}`);
  console.log('SIGINT (Ctrl-C) to stop.');
  // cron 自己接管 SIGINT, 退出由 SIGINT/SIGTERM 触发
  // 这里保持进程 alive — 不让 top-level await 走完

} else if (cmd === 'cron-status') {
  // P5: 看 cron 状态
  if (!isCronRunning()) {
    console.log('cron: not running');
  } else {
    const pid = getCronPid();
    console.log(`cron: running (pid=${pid || '(unknown)'})`);
  }
  // 显式退出 (lab-events 的 fs.watch 默认 keep-alive)
  process.exit(0);

} else if (cmd === 'cron-stop') {
  // P5: 给 cron 进程发 SIGINT
  const r = stopCron();
  console.log(`cron-stop: ${JSON.stringify(r)}`);
  process.exit(0);

} else if (cmd === 'cron-interval') {
  // 中途改 interval: 写文件, cron 下 cycle 读到后生效
  const ms = parseInt(args[1], 10);
  if (!ms || ms < 1000) { console.log('usage: lab.mjs cron-interval <ms> (min 1000)'); process.exit(1); }
  const { join } = await import('path');
  const { homedir } = await import('os');
  const { writeFileSync } = await import('fs');
  const dir = join(homedir(), '.openchat', 'lab');
  const { mkdirSync, existsSync } = await import('fs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cron-interval.txt'), String(ms), 'utf8');
  console.log(`cron-interval: written ${ms}ms (will take effect next cycle)`);
  process.exit(0);

} else if (cmd === 'supervisor') {
  const ms = args[1] ? parseInt(args[1], 10) : null;
  const { startSupervisor } = await import('../src/lab/supervisor.mjs');
  const h = await startSupervisor(ms ? { checkIntervalMs: ms } : {});
  console.log(`supervisor started (interval ${(h.getStatus().checkIntervalMs / 1000).toFixed(0)}s)`);
  // keep alive
  await new Promise(() => {});

} else if (cmd === 'supervisor-stop') {
  if (globalThis._supervisorHandle) {
    globalThis._supervisorHandle.stop();
    console.log('supervisor stopped');
  } else {
    console.log('supervisor: not running');
  }
  process.exit(0);

} else if (cmd === 'supervisor-status') {
  if (globalThis._supervisorHandle) {
    const s = globalThis._supervisorHandle.getStatus();
    console.log(`supervisor: running (interval ${(s.checkIntervalMs / 1000).toFixed(0)}s)`);
  } else {
    console.log('supervisor: not running');
  }
  process.exit(0);

} else if (cmd === 'auto-discover') {
  const { readFileSync, existsSync } = await import('fs');
  const manifestPath = new URL('../src/experiments/manifest.json', import.meta.url);
  if (!existsSync(manifestPath)) { console.error('manifest.json not found'); process.exit(1); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const experiments = manifest.experiments || [];
  const existing = listGoals().map(g => g.description);
  let added = 0;
  for (const exp of experiments) {
    if (exp.status !== 'closed-loop') continue;
    const desc = `实验 ${exp.file.replace(/\.mjs$/, '')}: ${exp.name}`;
    if (existing.includes(desc)) continue;
    addGoal(desc);
    added++;
  }
  const totalClosed = experiments.filter(e => e.status === 'closed-loop').length;
  const matched = existing.filter(d => d.startsWith('实验 ')).length;
  console.log(`auto-discover: added ${added} goal(s) (${totalClosed} closed-loop, ${matched} already matched in queue, ${totalClosed - added - matched} skipped)`);

} else if (cmd === 'sync') {
  const { readFileSync, existsSync } = await import('fs');
  const manifestPath = new URL('../src/experiments/manifest.json', import.meta.url);
  if (!existsSync(manifestPath)) { console.error('manifest.json not found'); process.exit(1); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const experiments = manifest.experiments || [];
  const existing = listGoals().map(g => g.description);
  let added = 0;
  for (const exp of experiments) {
    if (exp.status !== 'closed-loop') continue;
    const desc = `实验 ${exp.file.replace(/\.mjs$/, '')}: ${exp.name}`;
    if (existing.includes(desc)) continue;
    addGoal(desc);
    added++;
  }
  const totalClosed = experiments.filter(e => e.status === 'closed-loop').length;
  const matched = existing.filter(d => d.startsWith('实验 ')).length;
  console.log(`sync: added ${added} new goal(s) (${totalClosed} closed-loop, ${matched} already matched, ${totalClosed - added - matched} skipped)`);
  if (added > 0) {
    const results = await runAll();
    console.log(`\nsync: ran ${results.length} goal(s)`);
    for (const r of results) {
      console.log(`  ${r.goal.id}: ${r.result?.ok ? 'OK' : 'FAIL'}`);
    }
  } else { console.log('sync: nothing new to run'); }

} else if (cmd === 'verify-affected') {
  const changed = await getChangedFiles();
  if (!changed.length) { console.log('verify-affected: no changed files'); process.exit(0); }
  const affected = getAffectedExperiments(changed);
  const existing = listGoals().map(g => g.description);
  let added = 0;
  for (const a of affected) {
    const desc = `实验 ${a.file.replace(/\.mjs$/, '')}: ${a.name}`;
    if (existing.includes(desc)) continue;
    addGoal(desc);
    added++;
  }
  console.log(`verify-affected: ${affected.length} affected experiment(s), added ${added} new goal(s)`);
  if (added > 0) {
    for (const a of affected) {
      if (existing.includes(`实验 ${a.file.replace(/\.mjs$/, '')}: ${a.name}`)) continue;
      console.log(`  → ${a.file}: ${a.name}`);
    }
  }

} else if (cmd === 'memory') {
  const { load, save, summary } = await import('../src/experiments/lib/agent-memory.mjs');
  if (args.includes('--clear')) {
    const { writeFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const h = process.env.HOME || process.env.USERPROFILE;
    const p = resolve(h || process.cwd(), '.openchat', 'agent-memory.json');
    await writeFile(p, JSON.stringify({ facts: [], preferences: [], learnedPatterns: [], createdAt: Date.now(), updatedAt: Date.now() }, null, 2), 'utf8');
    console.log('memory cleared');
  } else {
    const m = await load();
    console.log(`Agent Memory (${new Date(m.updatedAt).toISOString().slice(0, 19)}):`);
    console.log(`  facts: ${m.facts.length}`);
    for (const f of m.facts.slice(-5)) console.log(`    - ${f.text.slice(0, 70)}`);
    console.log(`  preferences: ${m.preferences.length}`);
    for (const p of m.preferences.slice(-3)) console.log(`    ${p.key}=${p.value}`);
    console.log(`  patterns: ${m.learnedPatterns.length}`);
  }

} else if (cmd === 'heal-auto') {
  const { healGoal } = await import('../src/lab/auto-heal.mjs');
  const { listGoals } = await import('../src/lab/goal-queue.mjs');
  const failed = listGoals().filter(g => g.status === 'failed');
  if (failed.length === 0) { console.log('heal-auto: no failed goals'); process.exit(0); }
  let patched = 0;
  for (const g of failed) {
    console.log(`  diagnosing ${g.id}...`);
    const h = await healGoal(g.id);
    if (h.patch) {
      console.log(`    → patch: ${h.patch.file} (${h.patch.patch.slice(0, 60)})`);
      const app = await h.patch.apply();
      if (app.ok) {
        const { updateGoal } = await import('../src/lab/goal-queue.mjs');
        updateGoal(g.id, { status: 'pending', result: null, finishedAt: null, escalatedAt: null });
        patched++;
        console.log(`    → applied, reset to pending`);
      }
    } else if (h.diagnosis?.severity === 'retry') {
      const { updateGoal } = await import('../src/lab/goal-queue.mjs');
      updateGoal(g.id, { status: 'pending', result: null, finishedAt: null, escalatedAt: null });
      patched++;
      console.log(`    → ${h.diagnosis.suggestion} → reset to pending`);
    } else {
      console.log(`    → ${h.diagnosis?.suggestion || 'no auto-fix available (severity: ' + h.diagnosis?.severity + ')'}`);
    }
  }
  console.log(`heal-auto: ${patched}/${failed.length} goals auto-patched and reset`);

} else if (cmd === 'digest') {
  const N = parseInt(args[1] && args[1] !== '--llm' ? args[1] : args[2] || '20', 10);
  const useLLM = args.includes('--llm');
  const { computeDigest, formatDigestText, llmDigest } = await import('../src/lab/digest.mjs');
  const digest = useLLM ? await llmDigest(N) : { text: formatDigestText(computeDigest(N)) };
  console.log(digest.text);
  if (digest.ok === false) console.log(`  (digest limited: ${digest.reason})`);

} else if (cmd === 'explore') {
  const { explore, formatExplorerText } = await import('../src/lab/path-explorer.mjs');
  const result = explore();
  console.log(formatExplorerText(result));
  if (result.recommendations.length > 0) {
    const { question } = await import('./openchat.mjs');
    for (const r of result.recommendations.slice(0, 3)) {
      // 自动添加为 goal
      addGoal(r.suggestion);
      console.log(`  → added as goal: ${r.suggestion.slice(0, 70)}`);
    }
  }

} else if (cmd === 'costs') {
  const { listHistory } = await import('../src/lab/history.mjs');
  const all = listHistory();
  if (all.length === 0) { console.log('costs: no history'); process.exit(0); }
  const byExp = {};
  for (const r of all) {
    const desc = r.description || 'unknown';
    if (!byExp[desc]) byExp[desc] = { runs: 0, success: 0, failed: 0, totalDurationMs: 0, totalCost: 0 };
    byExp[desc].runs++;
    if (r.status === 'done') byExp[desc].success++;
    else byExp[desc].failed++;
    byExp[desc].totalDurationMs += (r.durationMs || 0);
    byExp[desc].totalCost += (r.cost || 0);
  }
  const grandTotal = Object.values(byExp).reduce((s, e) => s + e.totalCost, 0);
  console.log(`\n💰 Cost Breakdown (${all.length} runs)`);
  const sorted = Object.entries(byExp).sort((a, b) => b[1].totalCost - a[1].totalCost);
  for (const [desc, s] of sorted) {
    const avg = s.runs > 0 ? s.totalCost / s.runs : 0;
    const rate = s.runs > 0 ? (s.success / s.runs * 100).toFixed(0) : '-';
    console.log(`  ${s.totalCost.toFixed(4)} USD  (avg ${avg.toFixed(4)})  ${rate}%  ${desc.slice(0, 50)}`);
  }
  console.log(`  ───────────────────────────`);

} else if (cmd === 'watch') {
  const watchDir = args[1] || resolve(dirname(fileURLToPath(import.meta.url)), '../src/experiments');
  const fs = await import('fs');
  console.log(`watch: watching ${watchDir}`);
  console.log('watch: press Ctrl-C to stop');
  const debounce = {};
  fs.watch(watchDir, { recursive: true }, async (event, filename) => {
    if (!filename || !filename.endsWith('.mjs')) return;
    const key = filename;
    if (debounce[key]) clearTimeout(debounce[key]);
    debounce[key] = setTimeout(async () => {
      console.log(`\nwatch: ${filename} changed, checking affected...`);
      try {
        const changed = [filename];
        const affected = getAffectedExperiments(changed);
        if (!affected.length) { console.log('watch: no affected experiments'); return; }
        let added = 0;
        const existing = listGoals().map(g => g.description);
        for (const a of affected) {
          const desc = `实验 ${a.file.replace(/\.mjs$/, '')}: ${a.name}`;
          if (existing.includes(desc)) continue;
          addGoal(desc);
          added++;
        }
        if (added === 0) { console.log('watch: affected experiments already in queue'); return; }
        console.log(`watch: ${added} new goal(s) added, running...`);
        const results = await runAll();
        for (const r of results) {
          const sec = r.result ? (r.result.durationMs / 1000).toFixed(1) : '?';
          console.log(`  ${r.result?.ok ? '✅' : '❌'} ${sec}s  ${r.goal.description.slice(0, 50)}`);
        }
      } catch (e) {
        console.error(`watch error: ${e.message}`);
      }
    }, 500);
  });
  // keep alive
  await new Promise(() => {});

} else {
  showUsage();
}
