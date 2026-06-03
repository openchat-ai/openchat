import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import { executeCommand } from './commands.js';
import { persistentConfig } from '../core/persistent-config.js';
import * as providerService from '../core/provider-service.js';

/**
 * 创建 CLI 交互界面，返回方法集合供 Bridge 调用
 */
export function setupCLI(bridge) {

  function getPrompt() {
    const provider = persistentConfig.getPreference('currentProvider');
    if (provider) {
      const p = providerService.getProvider(provider);
      return p?.nameCn || provider;
    }
    return null;
  }

  function getPromptString() {
    return 'openchat > ';
  }

  function loadHistory() {
    try {
      const historyPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'history.json');
      if (fs.existsSync(historyPath)) {
        const data = fs.readFileSync(historyPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('[历史] 加载失败:', e);
    }
    return [];
  }

  function saveHistory(history) {
    try {
      const historyPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'history.json');
      fs.writeFileSync(historyPath, JSON.stringify(history), 'utf8');
    } catch (e) {
      console.error('[历史] 保存失败:', e);
    }
  }

  function getCompletions(line) {
    const trimmed = line.trim();
    if (!trimmed) return [];

    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    const matches = [];

    if (parts.length === 1) {
      if ('session'.startsWith(last)) matches.push('session');
      if ('provider'.startsWith(last)) matches.push('provider');
      if ('help'.startsWith(last)) matches.push('help');
      if ('status'.startsWith(last)) matches.push('status');
      if ('clear'.startsWith(last)) matches.push('clear');
      if ('exit'.startsWith(last)) matches.push('exit');
      if ('quit'.startsWith(last)) matches.push('quit');
      if ('chat'.startsWith(last)) matches.push('chat');
      return matches;
    }

    if (parts.length === 2 && parts[0] === 'session') {
      if ('create'.startsWith(last)) matches.push('create');
      if ('close'.startsWith(last)) matches.push('close');
      if ('list'.startsWith(last)) matches.push('list');
      if ('history'.startsWith(last)) matches.push('history');
      return matches;
    }

    if (parts.length === 2 && parts[0] === 'provider') {
      if ('add'.startsWith(last)) matches.push('add');
      if ('remove'.startsWith(last)) matches.push('remove');
      if ('list'.startsWith(last)) matches.push('list');
      return matches;
    }

    if (parts.length === 3 && parts[0] === 'session' && parts[1] === 'create') {
      if ('claude'.startsWith(last)) matches.push('claude');
      if ('opencode'.startsWith(last)) matches.push('opencode');
      return matches;
    }

    return matches;
  }

  function startCLI() {
    bridge.history = loadHistory();
    bridge.executing = false;

    const pname = getPrompt();
    console.log('');
    console.log('  OPENCHAT BRIDGE v2.0');
    if (pname) console.log(`  [${pname}]`);
    console.log('  输入 ? 查看帮助，或直接开始聊天\n');

    bridge.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      crlfDelay: Infinity,
      prompt: getPromptString()
    });

    bridge.rl.on('line', async (line) => {
      const cmd = line.trim();

      if (cmd) {
        bridge.history.unshift(cmd);
        if (bridge.history.length > 100) bridge.history.pop();
        saveHistory(bridge.history);
        bridge.executing = true;
        try {
          await executeCommand(cmd);
        } finally {
          bridge.executing = false;
        }
      }

      bridge.rl.setPrompt(getPromptString());
      bridge.rl.prompt();
    });

    bridge.rl.on('close', () => {
      console.log('\n[CLI] 再见!');
      process.exit(0);
    });

    bridge.rl.on('SIGINT', () => {
      bridge.rl.close();
    });

    bridge.rl.prompt();
  }

  return { getPrompt, getPromptString, getCompletions, startCLI, loadHistory, saveHistory };
}
