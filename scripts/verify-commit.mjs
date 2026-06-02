#!/usr/bin/env node
/**
 * verify-commit.mjs — 提交前质量门禁
 *
 * 检查项：
 *  - dart 文件 >200 行输出警告
 *  - dart 文件 >100 行且无 invariants 块 → 警告
 *  - 新增 dart 文件 >50 行且无对应 .spec.md → 警告
 *  - 总 diff >500 行 → 警告（鼓励小提交）
 *
 * 用法：node scripts/verify-commit.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { relative, resolve } from 'path';

const cwd = process.cwd();
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let hasError = false;
let hasWarning = false;

function warn(msg) { hasWarning = true; console.warn(`${YELLOW}⚠  ${msg}${RESET}`); }
function err(msg)  { hasError = true;  console.error(`${RED}✖  ${msg}${RESET}`); }
function info(msg) { console.log(`${CYAN}ℹ  ${msg}${RESET}`); }

function run(cmd) {
  try { return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { return ''; }
}

// ── 1. 获取本次变更的 dart 文件 ──────────────────────────
const changedRaw = run('git diff --cached --name-only --diff-filter=ACMR');
const allFiles = changedRaw.split('\n').filter(Boolean);
const dartFiles = allFiles.filter(f => f.endsWith('.dart') && existsSync(resolve(cwd, f)));
const specFiles = allFiles.filter(f => f.endsWith('.spec.md') && existsSync(resolve(cwd, f)));

// 如有 staged spec，自动生成骨架
if (specFiles.length > 0) {
  for (const sf of specFiles) {
    info(`spec 变更: ${sf} → 自动生成骨架...`);
    execSync(`node "${resolve(cwd, 'scripts/generate-from-spec.mjs')}" "${sf}"`, { cwd, stdio: 'inherit' });
  }
}

if (dartFiles.length === 0) {
  info('无 Dart 文件变更，跳过代码检查');
  process.exit(0);
}

info(`检查 ${dartFiles.length} 个 Dart 文件...`);

// ── 2. 逐文件检查 ────────────────────────────────────────
for (const f of dartFiles) {
  const fullPath = resolve(cwd, f);
  const content = readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  const lineCount = lines.length;

  // 2a. 行数检查
  if (lineCount > 200) {
    warn(`${f}: ${lineCount} 行（建议 ≤200）`);
  }

  // 2b. invariants 块检查 (>100 行必须含)
  if (lineCount > 100 && !content.includes('// === invariants ===')) {
    warn(`${f}: >100 行但缺少 // === invariants === 约束块`);
  }

  // 2c. 新增文件 → 检查是否有 .spec.md
  const isNew = run(`git diff --cached --diff-filter=A --name-only "${f}"`).trim();
  if (isNew && lineCount > 50) {
    const specPath = f.replace(/\.dart$/, '.spec.md');
    const specFull = resolve(cwd, specPath);
    if (!existsSync(specFull)) {
      warn(`${f}: 新增 >50 行但无对应 spec (${specPath})`);
    }
  }

  // 2d. 检查 const 构造函数标记（Flutter Widget 通用规范）
  if (f.includes('/ui/') && content.includes('extends StatefulWidget')) {
    if (!content.includes('const ') && content.includes('final ') && !content.includes('@override')) {
      // 只是提醒，不强制
    }
  }
}

// ── 3. 检查 diff 总行数 ──────────────────────────────────
const diffStat = run('git diff --cached --stat');
const totalLines = diffStat.split('\n')
  .filter(l => l.includes('insertion') || l.includes('deletion'))
  .reduce((sum, l) => {
    const m = l.match(/(\d+) insertion/);
    return sum + (m ? parseInt(m[1]) : 0);
  }, 0);
if (totalLines > 500) {
  warn(`本次变更 ${totalLines} 行（建议 ≤500），考虑拆分为多次提交`);
}

// ── 4. 结果 ──────────────────────────────────────────────
if (hasError) {
  console.error(`\n${RED}${BOLD}✖  验证未通过，请修复上述错误${RESET}`);
  process.exit(1);
}
if (hasWarning) {
  console.warn(`\n${YELLOW}${BOLD}⚠  有 ${dartFiles.length} 个警告，建议修复${RESET}`);
} else {
  console.log(`\n${CYAN}${BOLD}✅  ${dartFiles.length} 个文件检查通过${RESET}`);
}
process.exit(0);
