// Coding tools for LLM software development agent.
// === invariants ===
// - readFile(path): returns file content as string
// - writeFile(path, content): writes content to file
// - editFile(path, edits): apply multiple search/replace edits with quality gate
// - hashEdit(content, search, replace): hashline-style edit with anchor hash
// - TOOLS: OpenAI function-calling schema array
// - All file ops relative to project root (F:\openchat)
// - editFile validates that search string exists uniquely before replacing
// - editFile runs lint after edit by default, returns {pass, step?, ...editResult}
// - use force=true on edit_file to skip quality gate

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { applyWithGuard } from './quality-gate.mjs';
import { TOOLS as SEARCH_TOOLS, executeTool as searchExec } from './code-search.mjs';
import { TOOLS as DEV_TOOLS, executeTool as devExec } from './dev-tools.mjs';
import { TOOLS as AST_TOOLS, executeTool as astExec } from './ast-search.mjs';
import { TOOLS as DEEP_TOOLS, executeTool as deepExec } from './tools-deep.mjs';
import { TOOLS as ADAPTER_TOOLS, executeTool as adapterExec } from './ast-adapters.mjs';
// memory-tools.mjs removed: dead code

const PROJECT_ROOT = process.cwd(); // F:\openchat (or bridge/)

/** 单行 8 字符 md5 hash (lowercase) — hashline 编辑的锚点 */
function hashlineHash(line) {
  return crypto.createHash('md5').update(line).digest('hex').substring(0, 8);
}

export async function readFile(filePath, allowExternal) {
  if (allowExternal) {
    const resolved = path.resolve(filePath);
    const content = await fs.readFile(resolved, 'utf8');
    return content;
  }
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  const content = await fs.readFile(resolved, 'utf8');
  return content;
}

export async function writeFile(filePath, content, opts = {}) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  // ─── 写文件护栏 (L1.5 教训: DeepSeek V3 4x 重复覆盖 slash-commands.mjs) ───
  let existed = false;
  let origSize = 0;
  let backupPath = null;
  try {
    const stat = await fs.stat(resolved);
    existed = true;
    origSize = stat.size;
  } catch { /* new file, no backup needed */ }

  if (existed) {
    // 1. 自动备份 (给用户后悔的机会)
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = filePath.replace(/[\\/]/g, '__');
    const backupDir = path.join(PROJECT_ROOT, '.openchat', 'backups', 'write_file');
    await fs.mkdir(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `${safeName}.${ts}`);
    await fs.copyFile(resolved, backupPath);

    // 2. 收缩检测: 新内容 < 原 30% 视为疑似破坏, 拒绝 (除非 force=true 或 dry-run 显式确认)
    if (!opts.force && content.length < origSize * 0.3) {
      throw new Error(
        `write_file guardrail: ${filePath} shrunk ${origSize} → ${content.length} bytes ` +
        `(${(100 * content.length / origSize).toFixed(1)}%). ` +
        `If intentional, pass force=true. Backup: ${backupPath}`
      );
    }

    // 3. 提示: 改文件优先用 edit_file (diff 可见, 出错可逆)
    console.warn(`[write_file] ${filePath} exists (${origSize} bytes) — consider edit_file for partial changes. Backup: ${backupPath}`);
  }

  // 4. Dry-run 模式: OPENCHAT_WRITE_DRYRUN=1 时只打印, 不写
  if (process.env.OPENCHAT_WRITE_DRYRUN === '1') {
    console.log(`[write_file DRY-RUN] would write ${content.length} bytes to ${filePath}${backupPath ? ` (backup: ${backupPath})` : ''}`);
    return { path: filePath, bytes: content.length, dryRun: true, backup: backupPath };
  }

  await fs.writeFile(resolved, content, 'utf8');
  return { path: filePath, bytes: content.length, backup: backupPath };
}

// Internal raw edit (no quality gate)
async function _editFileRaw(filePath, search, newStr) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  const content = await fs.readFile(resolved, 'utf8');
  const idx = content.indexOf(search);
  if (idx === -1) throw new Error(`Search string not found in ${filePath}`);
  const nextIdx = content.indexOf(search, idx + 1);
  if (nextIdx !== -1) throw new Error(`Search string appears ${(content.match(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length} times — not unique`);
  const result = content.substring(0, idx) + newStr + content.substring(idx + search.length);
  await fs.writeFile(resolved, result, 'utf8');
  return { path: filePath, oldBytes: content.length, newBytes: result.length };
}

// Public edit with quality gate by default. Use force=true to skip quality gate.
export async function editFile(filePath, search, newStr, options = {}) {
  const { force = false, lint = true, test = false } = options;
  if (force) {
    return _editFileRaw(filePath, search, newStr);
  }
  const result = await applyWithGuard(filePath,
    () => _editFileRaw(filePath, search, newStr),
    { lint, test },
  );
  if (!result.pass) throw new Error(`Edit failed at ${result.step}: ${result.output || result.error}`);
  return result;
}

// Hashline-style edit: locate anchor by content hash
export async function hashEdit(filePath, hash, newContent) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  const fullContent = await fs.readFile(resolved, 'utf8');
  const lines = fullContent.split('\n');
  const targetHash = hash.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    if (hashlineHash(lines[i]) === targetHash) {
      lines[i] = newContent;
      const result = lines.join('\n');
      await fs.writeFile(resolved, result, 'utf8');
      return { path: filePath, line: i, oldLine: lines.length, newLine: lines.length };
    }
  }
  throw new Error(`Hash anchor ${hash} not found in ${filePath}`);
}

export const TOOLS = [...SEARCH_TOOLS, ...DEV_TOOLS, ...AST_TOOLS, ...DEEP_TOOLS, ...ADAPTER_TOOLS, // ...MEMORY_TOOLS, — removed: dead
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file. Path is relative to project root. Set allowExternal=true to read files outside the project (C:\\...).',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path (relative or absolute if allowExternal=true)' }, allowExternal: { type: 'boolean', description: 'Allow reading files outside project root' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates directories if needed. Path is relative to project root. Prefer edit_file for partial changes. Pass force=true to bypass shrink-detection guardrail (only if new content is intentionally <30% of original).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'File content' },
          force: { type: 'boolean', description: 'Bypass shrink-detection guardrail (use only if intentional)' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Search and replace in a file. Runs lint (and optionally tests) after edit, rolls back on failure. The search string must be unique. No regex.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          search: { type: 'string', description: 'Exact text to find (must be unique)' },
          newStr: { type: 'string', description: 'Replacement text' },
          force: { type: 'boolean', description: 'Skip quality gate (lint/test check). Default false.' },
          test: { type: 'boolean', description: 'Also run tests after edit (default false). Only valid when force=false.' },
        },
        required: ['path', 'search', 'newStr'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hash_edit',
      description: 'Edit a single line by 8-char md5 hash anchor (saves tokens vs search/replace when the file is large). Use when the LLM has read the file and has the hash for the target line. Hash = md5(line) first 8 hex chars.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          hash: { type: 'string', description: '8-char hex md5 of the target line' },
          newContent: { type: 'string', description: 'Replacement line content' },
        },
        required: ['path', 'hash', 'newContent'],
      },
    },
  },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'read_file': return readFile(args.path, args.allowExternal);
    case 'write_file': return writeFile(args.path, args.content, { force: !!args.force });
    case 'edit_file': {
      // 协议选用交给 LLM (system prompt 含 getEditProtocolGuidance 引导):
      //   LLM 看 prompt → 大文件单行编辑时主动选 hash_edit
      //   LLM 不看 prompt → 走原 edit_file (浪费 token 但能跑)
      // 不在 runtime 拦截 — 拦截会破坏 FC 协议,又难以观测
      const force = args.force === true;
      const test = !!args.test;
      return editFile(args.path, args.search, args.newStr, { force, test });
    }
    case 'hash_edit': return hashEdit(args.path, args.hash, args.newContent);
    case 'grep': case 'find_refs': return searchExec(name, args);
    case 'dep_graph': case 'detect_cycles': case 'to_mermaid': case 'git_commit': case 'git_log':
    case 'test_run': case 'test_discover': case 'lint_run': case 'lint_fix': case 'build_run':
    case 'ts_typecheck': case 'lang_run': case 'docker_build': case 'sql_parse': case 'curl_run':
    case 'sec_audit': case 'docs_suggest': case 'ci_detect': case 'env_diff':
      return devExec(name, args);
    case 'ast_index': case 'ast_find_refs': case 'ast_rename':
      return astExec(name, args);
    case 'git_branch': case 'git_merge_dry': case 'git_apply_patch':
    case 'test_parallel': case 'test_flaky':
    case 'lang_ast_parse':
      return deepExec(name, args);
    case 'lang_parse': case 'lang_parse_file':
      return adapterExec(name, args);
    case 'get_cwd': case 'read_memory': case 'memory_store':
      throw new Error(`Tool "${name}" removed (memory-tools deleted)`);
    default: throw new Error(`Unknown coding tool: ${name}`);
  }
}
