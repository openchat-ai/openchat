// System command execution tool for LLM agent.
// === invariants ===
// - ALLOWED_COMMANDS: whitelist of safe executables (prefix match)
// - BLOCKED_PATTERNS: regex patterns that will reject a command outright
// - timeout defaults to 10s, max output 100KB
// - execCommand() returns { stdout, stderr, exitCode }
// - TOOLS array follows OpenAI function-calling schema
// - Never executes if cmd fails safety check (throws)

import { execSync } from 'child_process';
import { compressOutput } from './output-compressor.mjs';

const ALLOWED_COMMANDS = ['ls', 'cat', 'echo', 'node', 'npm', 'git', 'pwd', 'dir', 'type', 'whoami', 'date', 'find', 'grep', 'head', 'tail', 'wc'];
const BLOCKED_PATTERNS = [/\brm\b/, /\bdel\b/, /\bformat\b/, /\bsudo\b/, /\bshutdown\b/, /\breboot\b/, /\bhalt\b/, /\bpoweroff\b/, /\bmv\b/, /\bcp\b/, /\bchmod\b/, /\bchown\b/, /\bmkfs\b/, /\bdd\b/, /\b>|>>|\||;&\${/];
const MAX_OUTPUT = 100 * 1024;
const DEFAULT_TIMEOUT = 10000;
const EXEC_OPTS = { timeout: DEFAULT_TIMEOUT, maxBuffer: MAX_OUTPUT, windowsHide: true, encoding: 'utf8' };

export function isSafeCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  const trimmed = cmd.trim();
  if (!trimmed) return false;
  // Blacklist check
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(trimmed)) return false;
  }
  // Whitelist: first word must be an allowed command
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return ALLOWED_COMMANDS.includes(firstWord);
}

export function execCommand(cmd, timeout, compress = false) {
  if (!isSafeCommand(cmd)) {
    throw new Error(`Command rejected by safety check: "${cmd.substring(0, 60)}"`);
  }
  const opts = { ...EXEC_OPTS };
  if (timeout) opts.timeout = timeout;
  try {
    const raw = execSync(cmd, opts).toString().trim();
    const result = { stdout: raw, stderr: '', exitCode: 0 };
    if (compress) {
      const c = compressOutput(cmd, raw, '');
      result.stdout = c.stdout;
      result._compression = c.meta;
    }
    return result;
  } catch (e) {
    const result = {
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim(),
      exitCode: e.status !== null ? e.status : 1,
    };
    if (compress) {
      const c = compressOutput(cmd, result.stdout, result.stderr);
      result.stdout = c.stdout;
      result.stderr = c.stderr;
      result._compression = c.meta;
    }
    return result;
  }
}

// OpenAI function-calling schema
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'exec_command',
      description: 'Execute a shell command on the host. Only safe commands are allowed (ls, cat, echo, node, npm, git, pwd, dir, type, whoami, date, find, grep, head, tail, wc). Use pipes/redirects with caution — shell metacharacters may be rejected.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in ms (default 10000)', default: 10000 },
        },
        required: ['command'],
      },
    },
  },
];

// Execute tool by name, return result as string (with compression for LLM)
export function executeTool(name, args) {
  if (name === 'exec_command') {
    const result = execCommand(args.command, args.timeout, true);
    return JSON.stringify(result);
  }
  throw new Error(`Unknown tool: ${name}`);
}
