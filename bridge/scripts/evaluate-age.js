/**
 * 七仙女智商年龄评估
 * 让居民评估每个身体的智商年龄
 */

const PORTS = [3000, 3100, 3200, 3300, 3400, 3500, 3600];
const NAMES = ['仙女', '玉女', '素女', '青女', '玄女', '嫦娥', '开阳'];

async function checkHealth(port) {
  try {
    const resp = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║       七仙女智商年龄评估                   ║');
  console.log('╚═══════════════════════════════════════════╝\n');

  // 检查七仙女状态
  console.log('【1】检查七仙女状态...\n');
  for (let i = 0; i < PORTS.length; i++) {
    const ok = await checkHealth(PORTS[i]);
    console.log(`  ${ok ? '✅' : '❌'} ${NAMES[i]} :${PORTS[i]}`);
  }

  // 读取配置获取年龄信息
  const { homedir } = await import('os');
  const { readFileSync } = await import('fs');
  const cfgPath = homedir() + '/.openchat/config.json';
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

  const upgradeAge = cfg.bridge?.age || 0;
  const mentalAge = cfg.bridge?.mentalAge || 0;

  console.log(`\n【2】年龄信息\n`);
  console.log(`  升级年龄: ${upgradeAge} 天`);
  console.log(`  智商年龄: ${mentalAge} 岁`);

  // 评估计算（模拟）
  console.log(`\n【3】智商年龄计算规则\n`);
  console.log(`  基础 = 升级年龄 + 运行天数`);
  console.log(`  + 知识库条目数 / 100 * 0.5`);
  console.log(`  + 居民数量 * 0.1`);
  console.log(`  - (100 - 健康分) / 10 * 0.5`);
  console.log(`  最低 = 1 岁`);

  console.log('\n✅ 评估完成');
  console.log('\n提示: 智商年龄由居民在 self_check 时自动评估');
}

main().catch(e => console.error('评估失败:', e.message));
