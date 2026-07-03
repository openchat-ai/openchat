// edit-gate.mjs — 编辑审查门（Cursor 式内联 Diff + Accept/Reject 的确定性版）
// 见 ROADMAP-CURSOR.md §7 / 46.spec.md。
//
// === invariants ===
// - previewEdit 只读，绝不落盘；落盘只经 applyEdit → coding-lib.executeTool
// - hash_edit 失配返回 { ok:false, code:'HASH_STALE' }，与 coding-lib 语义一致
// - hashline = md5(line).slice(0,8)，必须与 42.mjs / coding-lib 完全一致
// - unifiedDiff 纯函数：before/after → 彩色字符串，无副作用
// - 只读工具（dna_query/read_file/grep）isWriteTool()=false，不过门直通

import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import chalk from 'chalk';
import { executeTool } from './coding-lib.mjs';

const ROOT = process.cwd();
const hashline = (l) => createHash('md5').update(l).digest('hex').slice(0, 8);
const WRITE_TOOLS = new Set(['hash_edit', 'edit_file', 'write_file', 'multi_edit', 'ast_edit']);

export const isWriteTool = (name) => WRITE_TOOLS.has(name);

async function readSafe(p) {
  try { return await readFile(resolve(ROOT, p), 'utf8'); }
  catch { return null; }
}

// dry-run：计算编辑后的 before/after，绝不落盘
export async function previewEdit(tool, args = {}) {
  const path = args.path;
  const content = await readSafe(path);
  if (tool === 'write_file') {
    return { path, before: content ?? '', after: args.content ?? '', ok: true, isNew: content == null };
  }
  if (content == null) return { path, ok: false, error: `file not found: ${path}` };
  if (tool === 'hash_edit') {
    const lines = content.split('\n');
    const idx = lines.findIndex((l) => hashline(l) === String(args.hash).toLowerCase());
    if (idx < 0) return { path, ok: false, code: 'HASH_STALE', error: `hash ${args.hash} not found`, hint: 'call dna_query to refresh the anchor' };
    const after = [...lines]; after[idx] = args.newContent;
    return { path, before: content, after: after.join('\n'), ok: true, line: idx };
  }
  if (tool === 'edit_file') {
    const count = content.split(args.search).length - 1;
    if (count === 0) return { path, ok: false, error: `search not found: ${args.search}` };
    if (count > 1) return { path, ok: false, error: `search not unique (${count}×): ${args.search}` };
    return { path, before: content, after: content.replace(args.search, args.replace), ok: true };
  }
  return { path, ok: false, error: `unsupported write tool: ${tool}` };
}

// 落盘（经 coding-lib.executeTool，单一实现源）
export async function applyEdit(tool, args) {
  return executeTool(tool, args);
}

// LCS 行级 diff
function lineDiff(a, b) {
  const A = a.split('\n'); const B = b.split('\n');
  const m = A.length; const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = []; let i = 0; let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ t: ' ', l: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', l: A[i] }); i++; }
    else { out.push({ t: '+', l: B[j] }); j++; }
  }
  while (i < m) out.push({ t: '-', l: A[i++] });
  while (j < n) out.push({ t: '+', l: B[j++] });
  return out;
}

// 彩色 unified diff；连续 >CTX*2 未变行折叠
export function unifiedDiff(before, after, path = '') {
  const rows = lineDiff(before, after);
  const changed = rows.some((r) => r.t !== ' ');
  if (!changed) return chalk.dim(`(no changes) ${path}`);
  const CTX = 2;
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.t !== ' ') for (let k = Math.max(0, i - CTX); k <= Math.min(rows.length - 1, i + CTX); k++) keep[k] = true;
  });
  const out = [chalk.bold.cyan(`◈ ${path}`)];
  let folded = 0;
  rows.forEach((r, i) => {
    if (!keep[i]) { folded++; return; }
    if (folded > 0) { out.push(chalk.dim(`  ⋯ ${folded} unchanged`)); folded = 0; }
    if (r.t === '+') out.push(chalk.green(`+ ${r.l}`));
    else if (r.t === '-') out.push(chalk.red(`- ${r.l}`));
    else out.push(chalk.dim(`  ${r.l}`));
  });
  if (folded > 0) out.push(chalk.dim(`  ⋯ ${folded} unchanged`));
  return out.join('\n');
}
