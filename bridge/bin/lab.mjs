#!/usr/bin/env node
// lab.mjs — 无人参与实验室 CLI (P0 / goal queue 持久化)
//
// 用法:
//   node bin/lab.mjs add "<goal>"     加 goal 到队列
//   node bin/lab.mjs list             列所有 goal
//   node bin/lab.mjs status           看状态计数
//   node bin/lab.mjs run-next         拉下一个 pending 跑
//   node bin/lab.mjs run-all          跑完所有 pending
//
// 存储: ~/.openchat/lab/queue.jsonl (goal-queue.mjs 管)
// 跑: 走 runner.mjs, spawn `node bin/openchat.mjs --goal <desc>`, 子进程直连 provider
//     不占桥端口, 可以跟运行中的桥并存
//
// 后续 (P1+):
//   - lab.mjs run-cron (定时跑)
//   - lab.mjs show <id> (看单个 goal 详情)
//   - lab.mjs retry <id> (失败重置回 pending)

import { addGoal, listGoals, getStatus } from '../src/lab/goal-queue.mjs';
import { runNext, runAll } from '../src/lab/runner.mjs';

const args = process.argv.slice(2);
const cmd = args[0];

function showUsage() {
  console.log('Usage:');
  console.log('  lab.mjs add "<goal>"     add goal to queue');
  console.log('  lab.mjs list             list all goals');
  console.log('  lab.mjs status           show counts');
  console.log('  lab.mjs run-next         pick first pending, run it');
  console.log('  lab.mjs run-all          drain all pending');
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

} else {
  showUsage();
}
