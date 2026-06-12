#!/usr/bin/env node
// === swap-m2.mjs — M2/M3 provider 切换脚本 ===
// 用法:
//   node bin/swap-m2.mjs              切到 M2 (openrouter claude-sonnet-4-6)
//   node bin/swap-m2.mjs --restore    切回原配置 (从 .bak 恢复)
//   node bin/swap-m2.mjs --status     显示当前 provider + 是否处于 swap 状态
//   node bin/swap-m2.mjs --model m    自定义 model (openrouter 路径, e.g. "anthropic/claude-opus-4-6")
//
// 设计: 单文件 ESM, 0 依赖. 修改 ~/.config/openchat/config.json, 备份到 .m2swap.bak.
// 切完跑测试, --restore 恢复.
//
// 切到 M2 后跑 v10 同任务:
//   echo "exit" | timeout 600 node bin/openchat.mjs "<v10 task 文案>"
// 跑完 --restore 回 M3.

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const CONFIG_PATH = path.join(os.homedir(), '.config', 'openchat', 'config.json');
const BACKUP_PATH = CONFIG_PATH + '.m2swap.bak';
const SWAP_MARKER = path.join(os.homedir(), '.config', 'openchat', '.m2swap-active');

const M2_DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6'; // openrouter path 格式
const M3_DEFAULT = { provider: 'minimax', model: 'MiniMax-M3' };

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

async function writeConfig(cfg) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 4) + '\n', 'utf8');
}

async function isSwapped() {
  try { await fs.access(SWAP_MARKER); return true; } catch { return false; }
}

async function setSwapped(flag) {
  if (flag) await fs.writeFile(SWAP_MARKER, new Date().toISOString());
  else try { await fs.unlink(SWAP_MARKER); } catch {}
}

async function doSwap(model) {
  // 1. 备份原 cfg (如果还没备份)
  if (!await isSwapped()) {
    const orig = await fs.readFile(CONFIG_PATH, 'utf8');
    await fs.writeFile(BACKUP_PATH, orig, 'utf8');
    console.log(`[swap] 备份原 cfg → ${BACKUP_PATH}`);
  } else {
    console.log(`[swap] 检测到 swap 状态, 跳过备份`);
  }

  // 2. 验证 openrouter key 存在
  const cfg = await readConfig();
  if (!cfg.providers?.openrouter?.apiKey) {
    console.error(`[swap] 错误: config.providers.openrouter.apiKey 不存在.`);
    console.error(`       请先在 cfg 配 openrouter key.`);
    process.exit(1);
  }

  // 3. 改 current
  cfg.current = { provider: 'openrouter', model };
  await writeConfig(cfg);
  await setSwapped(true);
  console.log(`[swap] ✓ 切到 M2 (provider=openrouter, model=${model})`);
  console.log(`[swap] 跑测试:`);
  console.log(`         echo "exit" | timeout 600 node bin/openchat.mjs "<任务文案>"`);
  console.log(`[swap] 跑完恢复:`);
  console.log(`         node bin/swap-m2.mjs --restore`);
}

async function doRestore() {
  if (!await isSwapped()) {
    console.log(`[swap] 未在 swap 状态 (${SWAP_MARKER} 不存在), 无需恢复.`);
    return;
  }
  try {
    const backup = await fs.readFile(BACKUP_PATH, 'utf8');
    await fs.writeFile(CONFIG_PATH, backup, 'utf8');
    await setSwapped(false);
    const restored = JSON.parse(backup);
    console.log(`[swap] ✓ 已恢复: provider=${restored.current?.provider}, model=${restored.current?.model}`);
  } catch (e) {
    console.error(`[swap] 恢复失败: ${e.message}`);
    console.error(`       备份文件: ${BACKUP_PATH}`);
    process.exit(1);
  }
}

async function doStatus() {
  const cfg = await readConfig();
  const swapped = await isSwapped();
  console.log(`[swap] 当前 cfg:`);
  console.log(`         provider = ${cfg.current?.provider}`);
  console.log(`         model    = ${cfg.current?.model}`);
  console.log(`         openrouter key = ${cfg.providers?.openrouter?.apiKey ? '✓ 已配' : '✗ 未配'}`);
  console.log(`         swap 状态 = ${swapped ? '已 swap 到 M2 (备份在 ' + BACKUP_PATH + ')' : '未 swap'}`);
}

const args = process.argv.slice(2);
if (args.includes('--restore') || args.includes('--swap-back')) {
  await doRestore();
} else if (args.includes('--status')) {
  await doStatus();
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`用法:`);
  console.log(`  node bin/swap-m2.mjs              切到 M2 (default: anthropic/claude-sonnet-4-6 via openrouter)`);
  console.log(`  node bin/swap-m2.mjs --model M    切到 M2 自定义 model (openrouter path)`);
  console.log(`  node bin/swap-m2.mjs --restore    切回原 cfg (从 .m2swap.bak 恢复)`);
  console.log(`  node bin/swap-m2.mjs --status     显示当前状态`);
} else {
  // 主命令: swap
  const modelIdx = args.indexOf('--model');
  const model = modelIdx >= 0 && args[modelIdx + 1] ? args[modelIdx + 1] : M2_DEFAULT_MODEL;
  await doSwap(model);
}
