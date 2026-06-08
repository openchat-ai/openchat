#!/usr/bin/env node
// exp.mjs — 实验 runner CLI
// 用法:
//   node bin/exp.mjs                       列出所有实验
//   node bin/exp.mjs <id>                  跑指定实验的 test() (无 LLM 副作用, 适合 CI)
//   node bin/exp.mjs <id> --live           跑指定实验的 run() (真 LLM 调用)
//   node bin/exp.mjs <id> --live --repeats 5  指定 live 模式重复次数
//   node bin/exp.mjs <id> --dry            显式 dryRun (同 test, 但显式语义)
//   node bin/exp.mjs all                   跑 run-all
//   node bin/exp.mjs all --skeleton        含 skeleton 实验
//
// <id> 可以是 33-mqtt-auto 这样的 manifest id, 也可以是文件名片段如 "33" / "mqtt"

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(__dirname, '../src/experiments/manifest.json');
const RUN_ALL_PATH = resolve(__dirname, '../src/experiments/run-all.mjs');

const [,, ...rawArgs] = process.argv;

// === 解析参数 ===

const flags = new Set();
const positional = [];

for (const a of rawArgs) {
  if (a.startsWith('--')) flags.add(a.slice(2));
  else positional.push(a);
}

const target = positional[0];

// === 帮助 / 列表 ===

async function listExperiments() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const byStatus = { 'closed-loop': 0, skeleton: 0, 'reference-only': 0 };
  console.log(`\n${manifest.experiments.length} experiments in manifest.json\n`);
  for (const e of manifest.experiments) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    const status = e.status || 'closed-loop';
    console.log(`  ${e.id.padEnd(28)} [${status.padEnd(15)}] ${e.name}`);
  }
  console.log(`\nStatus summary: ${byStatus['closed-loop']} closed-loop, ${byStatus.skeleton} skeleton, ${byStatus['reference-only']} reference-only`);
  console.log(`\nUsage: node bin/exp.mjs <id> [--live] [--repeats N] [--dry]`);
}

// === 解析 id → manifest entry ===

async function findExperiment(id) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  // 1) 完整 id 匹配
  let exp = manifest.experiments.find(e => e.id === id);
  if (exp) return exp;
  // 2) 文件名片段匹配 (e.g. "33" 匹配 33-mqtt-auto)
  exp = manifest.experiments.find(e =>
    e.file.includes(id) || e.id.includes(id)
  );
  if (exp) return exp;
  return null;
}

// === 跑单个实验 ===

function _abs(file) {
  return pathToFileURL(resolve(__dirname, '../src/experiments', file)).href;
}

async function runOne(exp) {
  const mod = await import(_abs(exp.file));
  const status = exp.status || 'closed-loop';

  // --live: 走 run(), 默认 live=false (由各实验自己决定如何处理)
  if (flags.has('live')) {
    if (typeof mod.run !== 'function') {
      throw new Error(`${exp.id}: no run() export, live mode unavailable`);
    }
    const inputs = {};
    if (flags.has('repeats')) {
      const n = parseInt(flags.get('repeats'), 10);
      if (!Number.isNaN(n) && n > 0) inputs.repeats = n;
    }
    if (!('live' in inputs)) inputs.live = true;
    const t0 = Date.now();
    const r = await mod.run({ inputs });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n[${exp.id}] run() OK in ${dt}s`);
    console.log(JSON.stringify(r?.outputs || r, null, 2));
    return;
  }

  // 默认走 test() (dryRun, 无 LLM)
  if (typeof mod.test === 'function') {
    await mod.test();
    return;
  }

  // 兜底: dir/test.mjs side-effect 模式 (import 时已经跑过)
  if (exp.file.endsWith('/test.mjs')) {
    console.log(`[${exp.id}] side-effect test.mjs imported (already executed)`);
    return;
  }

  throw new Error(`${exp.id}: no test() export, try --live or check file`);
}

// === 跑 run-all ===

function runAll() {
  return new Promise((resolve, reject) => {
    const args = [RUN_ALL_PATH];
    if (flags.has('skeleton')) args.push('--skeleton');
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`run-all exited ${code}`)));
  });
}

// === 入口 ===

async function main() {
  if (!target || flags.has('help') || flags.has('h')) {
    await listExperiments();
    return;
  }
  if (target === 'list') {
    await listExperiments();
    return;
  }
  if (target === 'all') {
    await runAll();
    return;
  }

  const exp = await findExperiment(target);
  if (!exp) {
    console.error(`未找到实验 "${target}"`);
    console.error(`运行 'node bin/exp.mjs' 查看所有实验 id`);
    process.exit(1);
  }
  await runOne(exp);
}

main().catch(e => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
