// subagent-roles.mjs — 3 个 sub-agent 角色 (Step 5 / L2 整)
//
// 设计: 把 LLM agent 拆成 3 个 role, 各有不同 prompt + 工具集 + round 上限
//   - planner   = 只读 (read/grep/ast), 8 rounds, 适合"先调研"步
//   - editor    = 读+写 (edit_file/hash_edit/write_file), 20 rounds, 适合"改代码"步
//   - verifier  = 读+测试 (test_run/lint_run/ts_typecheck), 10 rounds, 适合"验"步
//
// 调用方 (38.mjs 协调器) 按 step.action keyword 选 role, 传给 22.mjs (tool-loop).
// 22.mjs 在 processText 看 opts.role → 覆盖 systemPrompt / toolSubset / maxRounds.
//
// L2 整 vs L2 局部 (Step 4): 1 个 agent 调参 vs 多 agent 协作, 跨 role 通信靠
// 38.mjs 协调器 (上一步的 outputs 喂下一步 inputs), 不共享内存.

export const ROLES = {
  planner: {
    name: 'planner',
    prompt: 'You are a planner. Investigate the codebase using read-only tools (read_file, grep, find_refs, ast_*). Report findings clearly. Do NOT make code changes.',
    tools: ['read_file', 'grep', 'find_refs', 'code_search', 'ast_index', 'ast_find_refs', 'get_cwd'],
    maxRounds: 8,
    keywords: ['locate', 'find', 'identify', 'investigate', 'read', 'explain', 'list', 'look', 'search', 'inspect', 'discover', 'review', 'examine', 'show'],
  },
  editor: {
    name: 'editor',
    prompt: 'You are an editor. Make targeted code changes using edit_file (preferred for partial changes), hash_edit (single-line on large files), or write_file (full file). Read files first to understand context.',
    tools: ['read_file', 'write_file', 'edit_file', 'hash_edit', 'grep', 'find_refs', 'get_cwd'],
    maxRounds: 20,
    keywords: ['create', 'add', 'modify', 'update', 'change', 'edit', 'implement', 'write', 'build', 'define', 'register', 'wire', 'enable', 'disable', 'rename', 'refactor', 'delete', 'remove', 'move', 'replace', 'fix', 'patch'],
  },
  verifier: {
    name: 'verifier',
    prompt: 'You are a verifier. Run tests and lint to verify the change. Use test_run, lint_run, ts_typecheck, test_discover. Report PASS/FAIL with evidence. Do NOT make code changes.',
    tools: ['read_file', 'test_run', 'test_discover', 'lint_run', 'ts_typecheck', 'test_parallel', 'get_cwd'],
    maxRounds: 10,
    // 不放裸 'test' 关键字 — 容易误匹配 'test-cmd' / 'unit-test' / 'fixture' 等含 'test' 字符串
    keywords: ['verify', 'run tests', 'validate', 'lint', 'typecheck', 'confirm', 'assert', 'pass/fail', 'passes'],
  },
};

export const DEFAULT_ROLE = 'editor';

// 按 step.action 文本匹配 keyword → role. 优先级: verifier > editor > planner, 同一 role 内长 keyword 优先
const ROLE_PRIORITY = { verifier: 0, editor: 1, planner: 2 };
const KEYWORD_INDEX = (() => {
  const idx = [];
  for (const [role, def] of Object.entries(ROLES)) {
    for (const kw of def.keywords) idx.push({ role, kw, pri: ROLE_PRIORITY[role] ?? 99 });
  }
  return idx.sort((a, b) => a.pri - b.pri || b.kw.length - a.kw.length);
})();

export function pickRole(stepAction) {
  if (typeof stepAction !== 'string') return DEFAULT_ROLE;
  const lower = stepAction.toLowerCase();
  for (const { role, kw } of KEYWORD_INDEX) {
    // 用 word boundary 避免 "fix" 匹配到 "suffix"
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return role;
  }
  return DEFAULT_ROLE;
}

export function getRole(name) {
  return ROLES[name] || ROLES[DEFAULT_ROLE];
}

export function listRoles() {
  return Object.keys(ROLES);
}
