#!/usr/bin/env node
// tui/tui.mjs — Lab TUI 入口：键盘导航 + 视图状态机
// === invariants ===
// - 退出时必须 setRawMode(false) + 恢复光标，否则终端错乱
// - busy 标志：异步动作进行中忽略按键，避免重入
// - 非 TTY 降级为静态打印（列表 + DNA 摘要）后退出
// - flat[] 与 groups 展开顺序严格一致，selected 索引其上

import readline from 'readline';
import chalk from 'chalk';
import { loadExperiments, groupByLevel, findDependents, dnaContext, dnaQuery } from './data.mjs';
import { header, renderList, renderDetail, renderPanel } from './render.mjs';
import { runOne, runAllSummary } from './actions.mjs';

const CLEAR = '\x1b[2J\x1b[3J\x1b[H';
const state = { view: 'list', selected: 0, panelTitle: '', panelText: '', exp: null };
let exps = [];
let groups = [];
let flat = [];
let busy = false;

function rebuild() {
  groups = groupByLevel(exps);
  flat = groups.flatMap((g) => g.items);
}

function draw() {
  let body;
  if (state.view === 'list') body = renderList(groups, state.selected);
  else if (state.view === 'detail') body = renderDetail(state.exp, findDependents(exps, state.exp.id));
  else body = renderPanel(state.panelTitle, state.panelText);
  process.stdout.write(CLEAR + header() + '\n' + body + '\n');
}

function toList() { state.view = 'list'; draw(); }

async function promptLine(question) {
  process.stdin.setRawMode?.(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question('\n' + chalk.cyan(question));
  rl.close();
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  return ans.trim();
}

async function onKey(str, key) {
  if (busy) return;
  const k = key?.name;
  if (key?.ctrl && k === 'c') return quit();

  if (state.view === 'list') {
    if (k === 'up') { state.selected = (state.selected - 1 + flat.length) % flat.length; draw(); }
    else if (k === 'down') { state.selected = (state.selected + 1) % flat.length; draw(); }
    else if (k === 'return') { state.exp = flat[state.selected]; state.view = 'detail'; draw(); }
    else if (k === 'q') quit();
    else if (str === 'r') await panelRun(() => runAllSummary(exps), 'run-all 结果');
    else if (str === 'd') await panelRun(dnaContext, 'DNA 摘要');
    else if (str === '/') await freeQuery();
    else if (str === 'a') await launchAgent();
  } else if (state.view === 'detail') {
    if (k === 'escape') toList();
    else if (str === 't') await panelRun(() => runOne(state.exp), `test: ${state.exp.id}`);
    else if (k === 'q') quit();
  } else {
    if (k === 'escape') toList();
    else if (k === 'q') quit();
  }
}

async function panelRun(fn, title) {
  busy = true;
  state.view = 'panel';
  state.panelTitle = title;
  state.panelText = chalk.yellow('运行中…');
  draw();
  try { state.panelText = await fn(); }
  catch (e) { state.panelText = chalk.red('错误: ' + e.message); }
  busy = false;
  draw();
}

async function freeQuery() {
  busy = true;
  const q = await promptLine('DNA 查询 (find function X / hash XXXX / summary / hot / isolate / callers X): ');
  if (q) {
    state.view = 'panel';
    state.panelTitle = `DNA: ${q}`;
    state.panelText = chalk.yellow('查询中…');
    draw();
    state.panelText = await dnaQuery(q);
  }
  busy = false;
  draw();
}

async function launchAgent() {
  busy = true;
  process.stdout.write('\x1b[?25h');
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  try {
    const { agentView } = await import('./agent.mjs');
    await agentView();
  } catch (e) {
    process.stdout.write('agent error: ' + e.message + '\n');
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?25l');
  busy = false;
  draw();
}

function quit() {
  process.stdout.write('\x1b[?25h\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

async function staticDump() {
  const ctx = await dnaContext();
  let out = header() + '\n';
  for (const g of groups) {
    out += `\n${g.level} (${g.items.length}):\n`;
    for (const e of g.items) out += `  ${e.id.padEnd(20)} ${e.name} [${e.status}]\n`;
  }
  out += '\n' + ctx + '\n';
  process.stdout.write(out);
}

async function main() {
  exps = await loadExperiments();
  rebuild();
  if (!process.stdin.isTTY) { await staticDump(); return; }
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?25l');
  process.stdin.on('keypress', (s, k) => { onKey(s, k).catch((e) => { busy = false; state.panelText = String(e.message); draw(); }); });
  draw();
}

main().catch((e) => { console.error('TUI 崩溃:', e.message); process.exit(1); });
