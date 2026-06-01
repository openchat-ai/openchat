// 实验三（汇总）：跑全部检测器并对比
import { execSync } from 'child_process';

const methods = [
  { name: 'nnls',       label: 'NNLS (原始)' },
  { name: 'swipe',      label: 'SWIPE (谱减)' },
  { name: 'fusion',     label: 'Fusion (投票)' },
  { name: 'integrated', label: 'LPC+MDCT→NNLS' },
];

const results = [];
for (const m of methods) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`>>> 运行 ${m.label}`);
  console.log(`${'='.repeat(60)}`);
  const out = execSync(`node run_experiment3.mjs ${m.name}`, { cwd: import.meta.dirname, encoding: 'utf8', timeout: 120000 });
  const lines = out.split('\n').filter(l => l.includes('吉他') || l.includes('贝斯') || l.includes('总计') || l.includes('编解码') || l.includes('检测:'));
  const summaryLine = lines.find(l => l.includes('检测:')) || '';
  const parts = summaryLine.match(/(\d+)吉他.*?(\d+)贝斯.*?(\d+)鼓.*?(\d+)声部.*?(\d+\.?\d*)s/);
  results.push({
    name: m.label,
    guitar: parts ? parseInt(parts[1]) : -1,
    bass: parts ? parseInt(parts[2]) : -1,
    drums: parts ? parseInt(parts[3]) : -1,
    total: parts ? parseInt(parts[4]) : -1,
    time: parts ? parseFloat(parts[5]) : -1,
    raw: lines.join('\n'),
  });
  // 显示中间输出
  process.stdout.write(out);
}

console.log(`\n\n${'='.repeat(60)}`);
console.log('实验三 最终汇总对比');
console.log(`${'='.repeat(60)}`);
console.log(`| 检测器    | 吉他 | 贝斯 | 鼓 | 总计 | 耗时 |`);
console.log(`|-----------|------|------|----|------|------|`);
for (const r of results) {
  console.log(`| ${r.name.padEnd(9)} | ${String(r.guitar).padStart(4)} | ${String(r.bass).padStart(4)} | ${String(r.drums).padStart(2)} | ${String(r.total).padStart(4)} | ${r.time.toFixed(0)}s  |`);
}
