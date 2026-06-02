#!/usr/bin/env node
/**
 * verify-commit.mjs — 提交前质量门禁
 *
 * 检查项：
 *  - dart 文件 >200 行输出警告
 *  - dart 文件 >100 行且无 invariants 块 → 警告
 *  - 新增 dart 文件 >50 行且无对应 .spec.md → 警告
 *  - 修改 >100 行 dart 文件时，spec.md 应同时改动 (防止 spec drift)
 *  - 总 diff >500 行 → 警告（鼓励小提交）
 *
 * 用法：node scripts/verify-commit.mjs
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { relative, resolve, basename } from 'path';

const cwd = process.cwd();
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let hasError = false;
let hasWarning = false;

function warn(msg) { hasWarning = true; console.warn(`${YELLOW}⚠  ${msg}${RESET}`); }
function err(msg)  { hasError = true;  console.error(`${RED}✖  ${msg}${RESET}`); }
function info(msg) { console.log(`${CYAN}ℹ  ${msg}${RESET}`); }
function ok(msg)   { console.log(`${GREEN}✓  ${msg}${RESET}`); }

function run(cmd) {
  try { return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { return ''; }
}

// 必须有 spec 的关键模块（白名单）
const SPEC_REQUIRED = [
  'openchat-flutter/lib/core/audio/lmdn_codec.dart',
  'openchat-flutter/lib/core/audio/audio_pipeline.dart',
  'openchat-flutter/lib/core/api/qiniu_client.dart',
  'openchat-flutter/lib/core/sdui_config.dart',
  'openchat-flutter/lib/ui/screens/chat_voice_recorder.dart',
  'openchat-flutter/lib/ui/screens/room_screen.dart',
  'openchat-flutter/lib/ui/screens/voice_room_screen.dart',
];

// ── 1. 获取本次变更的文件 ──────────────────────────
const changedRaw = run('git diff --cached --name-only --diff-filter=ACMR');
const allFiles = changedRaw.split('\n').filter(Boolean);
const dartFiles = allFiles.filter(f => f.endsWith('.dart') && existsSync(resolve(cwd, f)));
const specFiles = allFiles.filter(f => f.endsWith('.spec.md'));
const newDartFiles = run('git diff --cached --diff-filter=A --name-only')
  .split('\n').filter(f => f.endsWith('.dart'));

if (dartFiles.length === 0 && specFiles.length === 0) {
  info('无变更，跳过检查');
  process.exit(0);
}

info(`检查 ${dartFiles.length} 个 Dart + ${specFiles.length} 个 Spec 文件...`);

// ── 2. 逐文件检查 ────────────────────────────────────────
for (const f of dartFiles) {
  const fullPath = resolve(cwd, f);
  const content = readFileSync(fullPath, 'utf-8');
  const lineCount = content.split('\n').length;
  const specPath = f.replace(/\.dart$/, '.spec.md');
  const isNew = newDartFiles.includes(f);

  // 2a. 行数检查
  if (lineCount > 200) {
    warn(`${f}: ${lineCount} 行（建议 ≤200）`);
  }

  // 2b. invariants 块检查 (>100 行必须含)
  if (lineCount > 100 && !content.includes('// === invariants ===')) {
    warn(`${f}: >100 行但缺少 // === invariants === 约束块`);
  }

  // 2c. 新增文件 → 检查是否有 .spec.md
  if (isNew && lineCount > 50) {
    if (!existsSync(resolve(cwd, specPath))) {
      warn(`${f}: 新增 >50 行但无对应 spec (${specPath})`);
    }
  }

  // 2d. 修改文件 → 检查 spec drift
  if (!isNew && lineCount > 100) {
    const specStaged = specFiles.includes(specPath);
    if (!specStaged) {
      // 放宽规则：只对白名单内的关键文件强制
      const isCritical = SPEC_REQUIRED.some(p => f.includes(basename(p)));
      if (isCritical) {
        warn(`${f}: 修改 >100 行的关键模块，但未同步更新 ${specPath}`);
      }
    }
  }

  // 2e. 白名单内文件必须有 spec
  const inWhitelist = SPEC_REQUIRED.some(p => f === p || f.endsWith(p));
  if (inWhitelist && !existsSync(resolve(cwd, specPath))) {
    err(`${f}: 白名单模块缺少 ${specPath}`);
  }
}

// ── 3. Spec 文件单独检查 ──────────────────────────────────
for (const f of specFiles) {
  const content = readFileSync(resolve(cwd, f), 'utf-8');
  // 至少要有数据流/接口/边界条件/文件清单/不变量 等关键章节
  const requiredSections = ['## 数据流', '## 接口签名', '## 边界条件', '## 文件清单'];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      warn(`${f}: 缺少章节 "${section}"`);
    }
  }
  if (!content.includes('// === invariants ===')) {
    warn(`${f}: 缺少 // === invariants === 约束块`);
  }
}

// ── 4. 检查 diff 总行数 ──────────────────────────────────
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

// ── 5. 结果 ──────────────────────────────────────────────
if (hasError) {
  console.error(`\n${RED}${BOLD}✖  验证未通过，请修复上述错误${RESET}`);
  process.exit(1);
}
if (hasWarning) {
  console.warn(`\n${YELLOW}${BOLD}⚠  有警告，建议修复${RESET}`);
} else {
  console.log(`\n${GREEN}${BOLD}✅  全部通过${RESET}`);
}
process.exit(0);
