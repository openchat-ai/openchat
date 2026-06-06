// run-all.mjs — 按 manifest.json 顺序跑所有实验
// 用 default() 跑（测试模式，不传 inputs，不取 outputs）
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(await readFile(resolve(__dirname, 'manifest.json'), 'utf8'));

function _abs(file) { return pathToFileURL(resolve(__dirname, file)).href; }

let allPass = true;
for (const exp of MANIFEST.experiments) {
  const label = `${exp.id.padEnd(15)} ${exp.name}`;
  console.log(`\n▶ ${label}`);
  try {
    const mod = await import(_abs(exp.file));
    if (typeof mod.test === 'function') await mod.test();
  } catch (e) {
    console.error(`  ✗ ${exp.id} 崩溃: ${e.message}`);
    allPass = false;
  }
}

console.log(`\n${'═'.repeat(40)}`);
if (allPass) console.log('所有实验通过 ✓');
else console.log('部分实验失败 ✗');
process.exit(allPass ? 0 : 1);
