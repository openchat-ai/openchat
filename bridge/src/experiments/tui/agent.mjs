// tui/agent.mjs — Cursor 式 Agent 交互视图
// Plan 审查 → 工具流可视化 → 编辑 Diff + Accept/Reject。见 ROADMAP-CURSOR.md §7。
//
// === invariants ===
// - 写工具必过 edit-gate：先 previewEdit 出 diff，用户 accept 才 applyEdit 落盘
// - 只读工具（dna_query/read_file/grep）直接执行，不过门
// - demo 计划只作用于临时目录 _agent_demo，绝不触碰真实源码
// - agentView 自建 readline 时负责关闭；复用外部 rl 时不关

import readline from 'readline';
import chalk from 'chalk';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { writeFile, rm, mkdir } from 'fs/promises';
import { executeTool } from '../lib/coding-lib.mjs';
import { previewEdit, unifiedDiff, applyEdit, isWriteTool } from '../lib/edit-gate.mjs';

const TMP = resolve(fileURLToPath(new URL('.', import.meta.url)), '_agent_demo');
const hashline = (l) => createHash('md5').update(l).digest('hex').slice(0, 8);
const rel = (p) => p.replace(process.cwd(), '').replace(/^[/\\]/, '');
const ICON = { dna_query: '🔍', read_file: '📄', grep: '🔎', hash_edit: '✏️', edit_file: '✏️', write_file: '📝' };

// 规则化 plan（无 LLM 时的确定性编排，演示 Cursor 式交互）
function buildPlan(goal) {
  const g = (goal || '').trim();
  if (!g || g === 'demo') {
    return { title: '演示：DNA 检索 + hashline 锚点编辑（临时文件）', steps: [
      { tool: 'dna_query', args: { query: 'summary' }, note: '检索代码库摘要' },
      { tool: '__setup_demo__' },
      { tool: 'hash_edit', args: { __demo__: true }, note: '对演示文件精确改一行（走 diff 门）' },
    ] };
  }
  if (/^(find |hash |ls |summary|hot|isolate|callers |cat )/.test(g)) {
    return { title: `DNA 查询: ${g}`, steps: [{ tool: 'dna_query', args: { query: g }, note: '符号检索' }] };
  }
  return { title: `检索: ${g}`, steps: [{ tool: 'dna_query', args: { query: 'find ' + g }, note: '按名检索' }] };
}

function renderPlan(plan) {
  const lines = [chalk.bold.cyan(`\n▶ 计划: ${plan.title}`)];
  plan.steps.filter((s) => !s.tool.startsWith('__')).forEach((s, i) => {
    const w = isWriteTool(s.tool) ? chalk.yellow('[写]') : chalk.green('[读]');
    lines.push(`  ${i + 1}. ${ICON[s.tool] || '•'} ${chalk.bold(s.tool)} ${w} ${chalk.dim(s.note || '')}`);
  });
  return lines.join('\n');
}

function scriptedAns(q, opts) {
  if (/目标/.test(q)) return opts.goal || 'demo';
  if (/批准/.test(q)) return opts.approve ? 'y' : 'n';
  if (/eject/.test(q)) return opts.edit || 's';
  return '';
}

export async function agentView(providedRl, opts = {}) {
  const scripted = !!opts.scripted;
  const rl = !scripted ? (providedRl || readline.createInterface({ input: process.stdin, output: process.stdout })) : null;
  const print = (s) => process.stdout.write(s + '\n');
  const ask = scripted
    ? async (q) => { const a = scriptedAns(q, opts); print(chalk.dim(q + a)); return a; }
    : (q) => rl.question(q);

  print(chalk.bold.cyan('\n═══ Agent 模式 (Cursor 式：plan → 工具流 → diff accept/reject) ═══'));
  const goal = await ask(chalk.cyan('\n目标 (回车=demo, 或 "find X" / 自然语言): '));
  const plan = buildPlan(goal);
  print(renderPlan(plan));

  if (plan.steps.some((s) => isWriteTool(s.tool))) {
    const yn = await ask(chalk.yellow('\n批准执行此计划? (y/n): '));
    if (!/^y/i.test(yn.trim())) { print(chalk.dim('已取消，未执行任何操作')); if (!providedRl) rl.close(); return; }
  }

  let demoFile = null; let demoHash = null;
  for (const [i, step] of plan.steps.entries()) {
    if (step.tool === '__setup_demo__') {
      await mkdir(TMP, { recursive: true });
      demoFile = resolve(TMP, 'demo.js');
      const line = 'const TOKEN = "PLACEHOLDER";';
      await writeFile(demoFile, ['// demo file', '', line, 'export default TOKEN;'].join('\n'), 'utf8');
      demoHash = hashline(line);
      continue;
    }
    print(chalk.bold(`\n${ICON[step.tool] || '•'} 步骤 ${i} · ${step.tool} ${chalk.dim(step.note || '')}`));
    if (isWriteTool(step.tool)) {
      let args = step.args;
      if (args.__demo__) args = { path: rel(demoFile), hash: demoHash, newContent: 'const TOKEN = process.env.TOKEN;' };
      const pv = await previewEdit(step.tool, args);
      if (!pv.ok) { print(chalk.red(`  ✗ ${pv.code || pv.error}`)); continue; }
      print(unifiedDiff(pv.before, pv.after, pv.path));
      const k = await ask(chalk.cyan('  [a]ccept  [r]eject  [s]kip: '));
      if (/^a/i.test(k.trim())) { await applyEdit(step.tool, args); print(chalk.green('  ✓ 已应用')); }
      else print(chalk.dim('  ○ 已跳过（未落盘）'));
    } else {
      const r = await executeTool(step.tool, step.args);
      print(chalk.dim('  → ' + String(typeof r === 'string' ? r : JSON.stringify(r)).slice(0, 400)));
    }
  }
  if (demoFile) await rm(TMP, { recursive: true, force: true }).catch(() => {});
  print(chalk.bold.green('\n✓ Agent 完成'));
  if (!scripted && !providedRl) rl.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const gi = argv.indexOf('--goal');
  if (gi >= 0 || argv.includes('--scripted')) {
    const opts = { scripted: true, goal: gi >= 0 ? argv[gi + 1] : 'demo', approve: argv.includes('--approve'),
      edit: argv.includes('--accept') ? 'a' : argv.includes('--reject') ? 'r' : 's' };
    agentView(null, opts).catch((e) => { console.error('agent 崩溃:', e.message); process.exit(1); });
  } else {
    agentView().catch((e) => { console.error('agent 崩溃:', e.message); process.exit(1); });
  }
}
