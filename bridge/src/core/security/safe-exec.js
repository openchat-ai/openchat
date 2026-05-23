/**
 * Safe Command Execution
 * 安全的命令执行工具，防止命令注入
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// 允许执行的命令白名单
const ALLOWED_COMMANDS = [
  'git status',
  'git log',
  'git diff',
  'git branch',
  'git remote',
  'npm list',
  'npm outdated',
  'node --version',
  'npm --version',
  'pwd',
  'ls',
  'cat',
  'echo'
];

// 禁止的命令模式
const BLOCKED_PATTERNS = [
  /[;&|`$]/,           // 命令链接和替换
  /\$\(/,              // 命令替换 $(...)
  /`[^`]+`/,           // 反引号命令替换
  />\s*\//,            // 重定向到根目录
  /rm\s+-rf/,          // 危险删除
  /sudo/,              // 提权
  /chmod\s+777/,       // 危险权限
  />\s*\/etc/,         // 系统配置修改
  /curl.*\|.*sh/,      // 远程脚本执行
  /wget.*\|.*sh/       // 远程脚本执行
];

/**
 * 验证命令是否安全
 * @param {string} command - 要执行的命令
 * @returns {Object} - { safe: boolean, reason?: string }
 */
export function validateCommand(command) {
  if (!command || typeof command !== 'string') {
    return { safe: false, reason: 'Invalid command' };
  }

  // 检查禁止的模式
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Blocked pattern detected: ${pattern}` };
    }
  }

  // 提取命令基础部分
  const baseCommand = command.split(/\s+/)[0];

  // 检查是否在白名单中（白名单为空时允许所有非禁止命令）
  if (ALLOWED_COMMANDS.length > 0) {
    const isAllowed = ALLOWED_COMMANDS.some(allowed =>
      command.startsWith(allowed) || baseCommand === allowed.split(/\s+/)[0]
    );

    // 如果严格白名单模式，需要明确允许
    if (process.env.STRICT_COMMAND_WHITELIST === 'true' && !isAllowed) {
      return { safe: false, reason: `Command not in whitelist: ${baseCommand}` };
    }
  }

  return { safe: true };
}

/**
 * 安全执行命令
 * @param {string} command - 要执行的命令
 * @param {Object} options - 执行选项
 * @returns {Promise<Object>} - 执行结果
 */
export async function safeExec(command, options = {}) {
  const validation = validateCommand(command);

  if (!validation.safe) {
    throw new Error(`Unsafe command: ${validation.reason}`);
  }

  const { timeout = 30000, cwd, env } = options;

  try {
    const { stdout, stderr } = await execPromise(command, {
      timeout,
      cwd,
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024 // 1MB
    });

    return {
      success: true,
      stdout: stdout.toString(),
      stderr: stderr.toString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || '',
      code: error.code
    };
  }
}

/**
 * 转义 Shell 参数
 * @param {string} arg - 要转义的参数
 * @returns {string} - 转义后的参数
 */
export function escapeShellArg(arg) {
  if (!arg || typeof arg !== 'string') {
    return '';
  }

  // 使用单引号包裹，并转义内部单引号
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * 安全构建命令
 * @param {string} baseCommand - 基础命令
 * @param {string[]} args - 参数数组
 * @returns {string} - 安全的命令字符串
 */
export function buildSafeCommand(baseCommand, args = []) {
  const safeBase = baseCommand.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeArgs = args.map(escapeShellArg).join(' ');

  return `${safeBase} ${safeArgs}`;
}

export default {
  validateCommand,
  safeExec,
  escapeShellArg,
  buildSafeCommand
};
