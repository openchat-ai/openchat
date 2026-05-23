import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const KNOWN_TOOLS = [
  { name: 'claude', type: 'claude-code', cmd: 'claude', args: ['--version'] },
  { name: 'opencode', type: 'opencode', cmd: 'opencode', args: ['--version'] },
  { name: 'openx', type: 'openx', cmd: 'openx', args: ['--version'] },
  { name: 'claude-code', type: 'claude-code', cmd: 'claude-code', args: ['--version'] },
  { name: 'open-claude', type: 'open-claude', cmd: 'open-claude', args: ['--version'] },
  { name: 'aider', type: 'aider', cmd: 'aider', args: ['--version'] },
  { name: 'continue', type: 'continue', cmd: 'continue', args: ['--version'] },
  { name: 'devin', type: 'devin', cmd: 'devin', args: ['--version'] },
];

export async function autoDetect() {
  const detected = [];

  for (const tool of KNOWN_TOOLS) {
    try {
      const result = await checkCommand(tool.cmd, tool.args);
      if (result.available) {
        detected.push({
          name: tool.name,
          type: tool.type,
          command: tool.cmd,
          detected: result.version,
          ready: true
        });
      }
    } catch (e) {
      // Command not found or error
    }
  }

  if (detected.length === 0) {
    const additionalTools = await scanNpmGlobal();
    detected.push(...additionalTools);
  }

  return detected;
}

async function checkCommand(cmd, args = []) {
  try {
    const fullCmd = args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd;
    const { stdout, stderr } = await execAsync(fullCmd, { timeout: 5000, windowsHide: true });
    const output = (stdout || stderr || '').trim();
    return {
      available: true,
      version: output.split('\n')[0].substring(0, 50)
    };
  } catch (e) {
    return { available: false, version: null };
  }
}

async function scanNpmGlobal() {
  try {
    const { stdout } = await execAsync('npm list -g --depth=0 2>nul', { timeout: 10000, windowsHide: true });
    const packages = stdout.split('\n');
    const detected = [];

    const aiKeywords = ['claude', 'opencode', 'openx', 'aider', 'continue', 'devin', 'gpt', 'llama', 'ollama'];
    
    for (const pkg of packages) {
      const name = pkg.replace(/^[├─└│└┬┴┼]/g, '').replace(/@.*$/, '').trim();
      if (name && aiKeywords.some(k => name.toLowerCase().includes(k))) {
        detected.push({
          name: name,
          type: 'npm-global',
          command: name,
          detected: 'npm global package',
          ready: false
        });
      }
    }

    return detected;
  } catch (e) {
    return [];
  }
}

export async function checkOllama() {
  try {
    const { stdout } = await execAsync('ollama list', { timeout: 5000, windowsHide: true });
    const models = stdout.split('\n').slice(1).filter(line => line.trim());
    return {
      available: true,
      models: models.map(m => m.split(/\s+/)[0]).filter(Boolean)
    };
  } catch (e) {
    return { available: false, models: [] };
  }
}

export function formatDetectedList(detected) {
  if (detected.length === 0) return '  None';

  return detected.map(t => `  • ${t.name.padEnd(15)} ${t.detected || ''}`).join('\n');
}