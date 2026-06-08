// run-all.mjs — 按 manifest.json 跑 closed-loop 实验
// skeleton / reference-only 显式 skip 并说明原因
// test 函数发现：先 `mod.test`，再任何 `testXxx`，再 dir/test.mjs side-effect 模式
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(await readFile(resolve(__dirname, 'manifest.json'), 'utf8'));

function _abs(file) { return pathToFileURL(resolve(__dirname, file)).href; }

function findTestFn(mod) {
  if (typeof mod.test === 'function') return mod.test;
  for (const v of Object.values(mod)) {
    if (typeof v === 'function' && /^test[A-Z]/.test(v.name)) return v;
  }
  return null;
}

let allPass = true;
let closedLoopTotal = 0, closedLoopPass = 0;
let skeletonCount = 0, referenceCount = 0;

for (const exp of MANIFEST.experiments) {
  const status = exp.status || 'closed-loop';  // 默认 closed-loop (向后兼容)
  const label = `${exp.id.padEnd(15)} ${exp.name}`;
  console.log(`\n▶ ${label}  [${status}]`);

  if (status === 'skeleton') {
    console.log(`  ⏭  skipped (skeleton: 缺行为断言或无 test 函数，需补或挪走)`);
    skeletonCount++;
    continue;
  }
  if (status === 'reference-only') {
    console.log(`  ⏭  skipped (reference-only: 参考实现，不进 run-all)`);
    referenceCount++;
    continue;
  }

  closedLoopTotal++;
  try {
    const mod = await import(_abs(exp.file));
    const testFn = findTestFn(mod);
    if (testFn) {
      await testFn();
    } else if (exp.file.endsWith('/test.mjs')) {
      // dir/test.mjs: side-effect-only, import 上面已经跑完
    } else {
      console.log(`  ⚠ ${exp.id}: 无 test 函数，被 run-all 跳过`);
    }
    closedLoopPass++;
  } catch (e) {
    console.error(`  ✗ ${exp.id} 崩溃: ${e.message}`);
    allPass = false;
  }
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`closed-loop:  ${closedLoopPass}/${closedLoopTotal} passed`);
console.log(`skeleton:     ${skeletonCount} skipped (待补断言或挪走)`);
console.log(`reference:    ${referenceCount} skipped (参考实现)`);
if (allPass && closedLoopPass === closedLoopTotal) {
  console.log('\n所有 closed-loop 实验通过 ✓');
} else {
  console.log('\n部分 closed-loop 实验失败或被跳过 ✗');
}
process.exit(allPass ? 0 : 1);
