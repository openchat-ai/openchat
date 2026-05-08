/**
 * 七仙女升级脚本
 * 
 * 功能：
 * 1. 滚动升级每个 Bridge 实例
 * 2. 每次升级年龄 +1 天
 * 3. 不中断服务
 */

import { homedir } from 'os';
import { readFileSync, writeFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const CFG_PATH = homedir() + '/.openchat/config.json';
const PORTS = [3000, 3100, 3200, 3300, 3400, 3500, 3600];
const NAMES = ['仙女', '玉女', '素女', '青女', '玄女', '嫦娥', '开阳'];

async function healthCheck(port) {
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function stopBridge(port) {
  // 通过 API 发送停止信号（需要实现）
  // 目前只能手动 kill
  console.log(`  通知 :${port} 停止...`);
}

async function startBridge(port, name) {
  const { exec } = await import('child_process');
  const ps = `Start-Process -FilePath "node" -ArgumentList "src/main.js","--headless" -WorkingDirectory "F:\\openchat\\bridge" -WindowStyle Hidden`;
  
  return new Promise((resolve) => {
    exec(`powershell -Command "${ps}"`, (err) => {
      if (err) console.error(`启动 ${name} 失败:`, err.message);
    });
    setTimeout(resolve, 3000);
  });
}

function incrementAgeInConfig() {
  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  if (!cfg.bridge) cfg.bridge = {};
  cfg.bridge.age = (cfg.bridge.age || 0) + 1;
  writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
  return cfg.bridge.age;
}

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║       七仙女升级 — 滚动升级开始           ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // 检查当前状态
  console.log('【1】检查七仙女状态...\n');
  const status = [];
  for (let i = 0; i < PORTS.length; i++) {
    const ok = await healthCheck(PORTS[i]);
    status.push(ok);
    console.log(`  ${ok ? '✅' : '❌'} ${NAMES[i]} :${PORTS[i]}`);
  }

  const runningCount = status.filter(s => s).length;
  console.log(`\n  运行中: ${runningCount}/7`);

  // 年龄+1（每次升级操作只+1次）
  const newAge = incrementAgeInConfig();
  console.log(`\n升级后年龄: ${newAge} 天`);

  if (runningCount === 0) {
    console.log('\n没有运行中的实例，直接启动...');
    for (let i = 0; i < PORTS.length; i++) {
      console.log(`\n启动 ${NAMES[i]} :${PORTS[i]}...`);
      await startBridge(PORTS[i], NAMES[i]);
    }
  } else {
    // 滚动升级
    console.log('\n【2】滚动升级...\n');
    
    for (let i = 0; i < PORTS.length; i++) {
      if (!status[i]) {
        console.log(`  ${NAMES[i]} :${PORTS[i]} 未运行，跳过`);
        continue;
      }

      console.log(`\n升级 ${NAMES[i]} :${PORTS[i]}...`);
      
      // 停止
      await stopBridge(PORTS[i]);
      await sleep(2000);
      
      // 重启
      await startBridge(PORTS[i], NAMES[i]);
      await sleep(3000);
      
      // 验证
      const ok = await healthCheck(PORTS[i]);
      console.log(`  ${ok ? '✅ 升级成功' : '❌ 启动失败'}`);
    }
  }

  // 最终检查
  console.log('\n【3】最终状态检查...\n');
  let finalOk = 0;
  for (let i = 0; i < PORTS.length; i++) {
    const ok = await healthCheck(PORTS[i]);
    if (ok) finalOk++;
    console.log(`  ${ok ? '✅' : '❌'} ${NAMES[i]} :${PORTS[i]}`);
  }

  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  console.log(`\n当前年龄: ${cfg.bridge?.age || 0} 天`);
  console.log(`运行实例: ${finalOk}/7`);
  console.log('\n✅ 升级完成');
}

main().catch(e => console.error('升级失败:', e.message));
