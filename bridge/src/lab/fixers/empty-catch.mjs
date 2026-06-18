// === invariants ===
// - match() 仅解析 goal 文本，不读文件
// - apply() 读取目标文件，替换空 catch 为 console.debug
// - 写入前用 fork --check 验证语法
// - 不改已替换过的 catch（去重由 caller 负责）

import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { safeAtomicWrite } from '../scout-shared.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '../../..');

const GOAL_RE = /^\[fix\] empty catch: (\S+?)(?::(\d+))?$/;

export function match(goalText) {
  const m = goalText.match(GOAL_RE);
  if (!m) return null;
  return { file: m[1], line: m[2] ? parseInt(m[2]) : null };
}

/**
 * 从 catch 前两行提取有意义的操作名
 */
function extractOpName(lines, catchLineIdx) {
  for (let i = catchLineIdx - 1; i >= Math.max(0, catchLineIdx - 3); i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '{' || trimmed === '}') continue;
    const fn = trimmed.match(/(\w+(?:\.\w+)*)\s*\(/);
    if (fn) return fn[1];
  }
  return null;
}

function extractFileLabel(file) {
  const parts = file.replace(/\\/g, '/').split('/');
  return parts.length >= 2 ? parts[parts.length - 2] + '/' + parts[parts.length - 1] : parts[parts.length - 1];
}

export async function apply(goalText) {
  const parsed = match(goalText);
  if (!parsed) return { ok: false, info: `no match: ${goalText}` };
  const absPath = join(PROJECT_ROOT, parsed.file);
  let content;
  try { content = readFileSync(absPath, 'utf8'); }
  catch { return { ok: false, info: `file not found: ${absPath}` }; }

  const lines = content.split('\n');
  const targetLine = parsed.line;

  // 如果指定行号，精确定位
  let catchIdx = -1;
  if (targetLine) {
    catchIdx = targetLine - 1;
    if (catchIdx >= lines.length) return { ok: false, info: `line ${targetLine} out of range` };
    const trimmed = lines[catchIdx].trim();
    if (!/catch\s*(?:\([^)]*\))?\s*\{/.test(trimmed)) return { ok: false, info: `line ${targetLine} is not a catch` };
  } else {
    // 没行号，找第一个空 catch
    for (let i = 0; i < lines.length; i++) {
      if (/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(lines[i])) { catchIdx = i; break; }
    }
    if (catchIdx === -1) return { ok: false, info: 'no empty catch found' };
  }

  // 提取 catch 参数名
  const paramMatch = lines[catchIdx].match(/catch\s*\(([^)]*)\)/);
  const paramName = paramMatch ? paramMatch[1].trim() : 'e';

  // 提取上下文操作名和文件标签
  const fileLabel = extractFileLabel(parsed.file);
  const opName = extractOpName(lines, catchIdx);
  const context = opName || fileLabel;

  // 构建替换行
  const indent = lines[catchIdx].match(/^\s*/)[0];
  const newLine = `${indent}} catch (${paramName}) { console.debug(\`[${context}] failed: \${${paramName}?.message}\`); }`;

  const origLine = lines[catchIdx];
  lines[catchIdx] = newLine;
  const newContent = lines.join('\n');

  if (newContent === content) return { ok: true, info: 'no change needed' };

  // 语法验证后原子写入
  try {
    await safeAtomicWrite(absPath, newContent);
    return { ok: true, info: `${parsed.file}:${catchIdx + 1} fixed (op=${opName || 'unknown'})` };
  } catch (e) {
    return { ok: false, info: `write failed: ${e.message}` };
  }
}
