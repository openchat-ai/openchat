/**
 * 七仙女启动脚本 — 启动7个Bridge实例
 *
 * 每个实例不同端口：3000, 3100, 3200, 3300, 3400, 3500, 3600
 * 名字：仙女、玉女、素女、青女、玄女、嫦娥、开阳
 */
import { exec } from 'child_process';
import { homedir } from 'os';
import { readFileSync, writeFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const BASE_PORT = 3000;
const COUNT = 7;
const NAMES = ['仙女', '玉女', '素女', '青女', '玄女', '嫦娥', '开阳'];

const CFG_PATH = homedir() + '/.openchat/config.json';

async function startOne(index) {
  const port = BASE_PORT + index * 100;
  const name = NAMES[index];

  // 每个实例独立的 directListen 端口（port + 2）
  const directPort = port + 2;
  const ps = `Start-Process -FilePath "node" -ArgumentList "src/main.js","--headless","--port=${port}","--directListen=${directPort}" -WorkingDirectory "F:\\openchat\\bridge" -WindowStyle Hidden`;
  
  return new Promise((resolve) => {
    exec(`powershell -Command "${ps}"`, (err) => {
      if (err) console.error(`启动 ${name} 失败:`, err.message);
    });
    
    console.log(`[启动] ${name} → :${port}`);
    setTimeout(resolve, 3000);
  });
}

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║   七仙女下凡 — 启动 7 个 Bridge 实例     ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // 读取配置获取年龄
  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  const age = cfg.bridge?.age || 0;
  console.log(`当前年龄: ${age} 天\n`);

  for (let i = 0; i < COUNT; i++) {
    await startOne(i);
  }

  console.log('\n等待初始化...');
  await sleep(30000);

  // 验证
  console.log('\n=== 七仙女状态 ===');
  for (let i = 0; i < COUNT; i++) {
    const port = BASE_PORT + i * 100;
    try {
      const resp = await fetch(`http://localhost:${port}/health`);
      const ok = resp.ok;
      console.log(`  ${ok ? '✅' : '❌'} ${NAMES[i]} :${port}`);
    } catch {
      console.log(`  ❌ ${NAMES[i]} :${port} — 未响应`);
    }
  }

  console.log('\n✅ 七仙女已在后台运行');
  console.log('   查看状态: curl http://localhost:3000/health');
  console.log('   停止命令: powershell "Get-NetTCPConnection -LocalPort 3000,3100,3200,3300,3400,3500,3600 | ForEach-Object { Stop-Process -Id $_.OwningProcess }"');
}

main().catch(e => console.error(e));
