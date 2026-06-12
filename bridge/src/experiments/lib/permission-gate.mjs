// permission-gate.mjs — L3 件: per-tool permission check + trust 持久化
//
// 设计 (Step 6 / L3 件 1):
//   - 每个 tool 有 permission 级: 'safe' | 'confirm' | 'forbidden'
//     safe      = 不问, 直接跑 (read_file, grep, ast_*)
//     confirm   = 首次问用户, 用户 y/n/always
//     forbidden = 永远 block (留给危险操作, 当前不分配)
//   - 用户答 'always' / 'a' → 写 ~/.openchat/trust.json, 之后不再问
//   - 用户答 'y' → 这次跑, 不存
//   - 用户答 'n' → 返 [Denied] 给 LLM, 让它调整
//   - always-on: 默认启用. CLI 首次问, bridge 静默 allow. setEnabled(false) 可关
//   - bridge 必须不阻塞: 同步 input() 只能在 CLI / standalone; bridge 走 phone 时应 bypass
//     → 检测到没有 TTY 或 ctx.bridgeMode → 静默 y (跟 user 确认过, 实际是 phone 端鉴权)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TRUST_DIR = join(homedir(), '.openchat');
const TRUST_FILE = join(TRUST_DIR, 'trust.json');

let _enabled = true;
let _trust = null;  // 懒加载

const TOOL_PERMISSION = {
  // safe = 只读 / 不可逆影响 (读/查/分析)
  read_file: 'safe', grep: 'safe', find_refs: 'safe', code_search: 'safe',
  ast_index: 'safe', ast_find_refs: 'safe', ast_search: 'safe', ast_extract: 'safe',
  get_cwd: 'safe', read_memory: 'safe',
  // 验证类 (跑测试/lint, 可改文件系统, 不可逆)
  test_run: 'confirm', test_discover: 'safe', lint_run: 'confirm', lint_fix: 'confirm',
  ts_typecheck: 'safe', test_parallel: 'confirm', test_flaky: 'safe',
  build_run: 'confirm', docker_build: 'confirm', sec_audit: 'safe', ci_detect: 'safe', env_diff: 'safe',
  // 编辑类 (核心 confirm, write_file 已有 shrink 护栏再加权限闸)
  write_file: 'confirm', edit_file: 'confirm', hash_edit: 'confirm',
  // git 类 (commit 安全, push 危险)
  git_commit: 'confirm', git_log: 'safe', git_branch: 'safe', git_merge_dry: 'safe', git_apply_patch: 'confirm',
  // shell / 通用 (任何走 shell 的都 confirm)
  lang_run: 'confirm', lang_parse: 'safe', lang_parse_file: 'safe', lang_ast_parse: 'safe',
  curl_run: 'confirm', sql_parse: 'safe',
  // 依赖图 / 文档建议
  dep_graph: 'safe', detect_cycles: 'safe', to_mermaid: 'safe',
  docs_suggest: 'safe', ast_rename: 'confirm',
  // memory
  memory_store: 'confirm',
};

function _ensureDir() {
  try { if (!existsSync(TRUST_DIR)) mkdirSync(TRUST_DIR, { recursive: true }); } catch { /* 失败静默 */ }
}

function _loadTrust() {
  if (_trust) return _trust;
  _trust = {};
  try {
    if (existsSync(TRUST_FILE)) {
      _trust = JSON.parse(readFileSync(TRUST_FILE, 'utf8'));
    }
  } catch { /* 损坏的 trust 文件: 静默重置 */ }
  return _trust;
}

function _saveTrust() {
  try {
    _ensureDir();
    writeFileSync(TRUST_FILE, JSON.stringify(_trust, null, 2));
  } catch { /* 失败不影响 runtime */ }
}

export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function getPermission(toolName) { return TOOL_PERMISSION[toolName] || 'confirm'; }  // 未知工具默认 confirm (保守)

// 核心: 检查 tool 是否被允许执行
//   返回 { allowed: bool, reason: string }
//   - allowed=false 时, 22.mjs 把 reason 当 tool result 返给 LLM (让它调整)
//   - bridge 模式 (无 TTY) → 默认 allow + log (跟 user 约定)
export function checkPermission(toolName, args = {}, ctx = {}) {
  const perm = getPermission(toolName);

  if (!_enabled) return { allowed: true, reason: 'permission disabled (env off)' };
  if (perm === 'safe') return { allowed: true, reason: 'safe' };
  if (perm === 'forbidden') return { allowed: false, reason: 'tool forbidden by policy' };

  // confirm 路径
  const trust = _loadTrust();
  const key = `${toolName}:${JSON.stringify(args)}`;
  const toolKey = toolName;

  // 1. tool 级别 "always" 信任
  if (trust[toolKey] === 'always') return { allowed: true, reason: 'trusted (always)' };

  // 2. 精确参数级 "always" 信任
  if (trust[key] === 'always') return { allowed: true, reason: 'trusted (exact args)' };

  // 3. 问用户 (TTY 检查)
  if (!process.stdin.isTTY || ctx.bridgeMode) {
    // bridge 模式: 静默 allow (phone 端鉴权), log 一下
    console.log(`[permission] ${toolName} (auto-allow bridge mode) args=${JSON.stringify(args).slice(0, 80)}`);
    return { allowed: true, reason: 'bridge mode auto-allow' };
  }

  // 4. CLI 模式: 真问
  console.log(`\n[permission] Tool '${toolName}' wants to run.`);
  console.log(`  args: ${JSON.stringify(args).slice(0, 200)}`);
  process.stdout.write('  Allow? [y/n/always] (default n): ');
  let answer = '';
  try {
    answer = (require('fs').readFileSync(0, 'utf8').trim().toLowerCase()) || 'n';
  } catch { answer = 'n'; }
  // ↑ 简化: 用 readFileSync 同步读 stdin (避免引入 readline)

  if (answer === 'a' || answer === 'always') {
    trust[toolName] = 'always';
    _saveTrust();
    return { allowed: true, reason: 'user said always' };
  }
  if (answer === 'y' || answer === 'yes') {
    return { allowed: true, reason: 'user said yes' };
  }
  return { allowed: false, reason: `user denied (answer: ${answer || 'n'})` };
}

export function resetTrust() {
  _trust = {};
  _saveTrust();
}

export function listTrust() {
  return _loadTrust();
}
