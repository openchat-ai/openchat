#!/usr/bin/env node
/**
 * verify-commit.mjs — 提交前质量门禁 (P0: 实际阻塞)
 *
 * 检查项（err = 阻塞 commit, warn = 提示不阻塞）：
 *  - ERR: 新增 dart 文件 >50 行无对应 .spec.md → 阻塞
 *  - ERR: 修改 >100 行白名单文件时未同步 spec.md → 阻塞
 *  - ERR: 白名单内文件缺少 spec.md → 阻塞
 *  - ERR: spec.md 缺少关键章节 (数据流/接口签名/边界条件/文件清单) → 阻塞
 *  - ERR: 总 diff >500 行 → 阻塞 (R4)
 *  - WARN: dart 文件 >200 行 → 提示
 *  - WARN: >100 行但缺 invariants 块 → 提示
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';

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
// 只列已有 spec 的关键文件，避免循环
const SPEC_REQUIRED = [
  'openchat-flutter/lib/core/audio/lmdn_codec.dart',
  'openchat-flutter/lib/core/audio/audio_pipeline.dart',
  'openchat-flutter/lib/core/api/qiniu_client.dart',
  'openchat-flutter/lib/core/sdui_config.dart',
  'openchat-flutter/lib/ui/screens/chat_voice_recorder.dart',
  'openchat-flutter/lib/ui/screens/voice_room_screen.dart',
  'openchat-flutter/lib/ui/screens/room_screen.dart',
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

  // 2a. 行数警告 (WARN)
  if (lineCount > 200) {
    warn(`${f}: ${lineCount} 行（建议 ≤200）`);
  }

  // 2b. invariants 警告 (>100 行) (WARN)
  if (lineCount > 100 && !content.includes('// === invariants ===')) {
    warn(`${f}: >100 行但缺少 // === invariants === 约束块`);
  }

  // 2c. 新增 >50 行必须有 spec (ERR - 阻塞)
  if (isNew && lineCount > 50) {
    if (!existsSync(resolve(cwd, specPath))) {
      err(`${f}: 新增 >50 行但无对应 spec (${specPath}) — 阻塞`);
    }
  }

  // 2d. 白名单内文件改动 → spec 必须同步 (ERR)
  const inWhitelist = SPEC_REQUIRED.includes(f);
  if (inWhitelist && !isNew && lineCount > 100) {
    const specStaged = specFiles.includes(specPath);
    if (!specStaged) {
      err(`${f}: 白名单文件改动 >100 行但未同步 ${specPath} — 阻塞`);
    }
  }

  // 2e. 白名单内文件必须有 spec (ERR)
  if (inWhitelist && !existsSync(resolve(cwd, specPath))) {
    err(`${f}: 白名单模块缺少 ${specPath} — 阻塞`);
  }
}

// ── 3. Spec 文件章节校验 (ERR - 阻塞) ─────────────────────
for (const f of specFiles) {
  const content = readFileSync(resolve(cwd, f), 'utf-8');
  const requiredSections = ['## 数据流', '## 接口签名', '## 边界条件', '## 文件清单'];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      err(`${f}: 缺少关键章节 "${section}" — 阻塞`);
    }
  }
}

// ── 4. 总 diff 行数 (ERR if >500) ─────────────────────────
const diffStat = run('git diff --cached --stat');
const totalLines = diffStat.split('\n')
  .filter(l => l.includes('insertion') || l.includes('deletion'))
  .reduce((sum, l) => {
    const m = l.match(/(\d+) insertion/);
    return sum + (m ? parseInt(m[1]) : 0);
  }, 0);
if (totalLines > 500) {
  err(`本次变更 ${totalLines} 行（>500），R4 违规 — 阻塞`);
} else if (totalLines > 300) {
  warn(`本次变更 ${totalLines} 行（>300），接近 R4 上限`);
}

// ── 5. 结果 ──────────────────────────────────────────────
if (hasError) {
  console.error(`\n${RED}${BOLD}✖  ${hasError} 个错误阻塞 commit${RESET}`);
  process.exit(1);
}
if (hasWarning) {
  console.warn(`\n${YELLOW}${BOLD}⚠  ${hasWarning} 个警告（不阻塞）${RESET}`);
} else {
  console.log(`\n${GREEN}${BOLD}✅  全部通过${RESET}`);
}
process.exit(0);
