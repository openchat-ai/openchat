/**
 * ⚠ DEPRECATED — 七仙女启动脚本
 *
 * 主 Bridge 启动后会自动通过 FairyGuardian 自举 6 个姐妹，
 * 本脚本不再需要。保留仅作调试用途。
 *
 * 当前端口体系：主 3800 + 姐妹 3810/3820/3830/3840/3850/3860
 */
import { exec } from 'child_process';
import { homedir } from 'os';
import { readFileSync } from 'fs';
import { setTimeout as sleep } from 'timers/promises';

const BASE_PORT = 3800;
const COUNT = 7;
const NAMES = ['仙女', '玉女', '素女', '青女', '玄女', '嫦娥'];

const CFG_PATH = homedir() + '/.openchat/config.json';

async function startOne(index) {
  const port = index === 0 ? BASE_PORT : BASE_PORT + index * 10;
  const name = index === 0 ? '主' : NAMES[index - 1];
  const args = index === 0 
    ? `"src/main.js","--headless","--port=${port}","--main"` 
    : `"src/main.js","--headless","--port=${port}","--fairy","--mainPort=${BASE_PORT}"`;
  const ps = `Start-Process -FilePath "node" -ArgumentList ${args} -WorkingDirectory "F:\\openchat\\bridge"`;
  
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
  console.log('║   ⚠ DEPRECATED — 请使用主 Bridge 自举    ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  const age = cfg.bridge?.age || 0;
  console.log(`当前年龄: ${age} 天\n`);

  for (let i = 0; i < COUNT; i++) {
    await startOne(i);
  }

  console.log('\n等待初始化...');
  await sleep(30000);

  console.log('\n=== 状态 ===');
  for (let i = 0; i < COUNT; i++) {
    const port = i === 0 ? BASE_PORT : BASE_PORT + i * 10;
    try {
      const resp = await fetch(`http://localhost:${port}/health`);
      console.log(`  ${resp.ok ? '✅' : '❌'} ${i === 0 ? '主' : NAMES[i-1]} :${port}`);
    } catch {
      console.log(`  ❌ ${i === 0 ? '主' : NAMES[i-1]} :${port} — 未响应`);
    }
  }

  console.log('\n✅ 已在后台运行');
  console.log('   停止: 打开 http://localhost:3800 → Shutdown All');
}

main().catch(e => console.error(e));
