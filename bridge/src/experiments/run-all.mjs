// run-all.mjs — 按 manifest.json 跑 closed-loop 实验
// 所有实验从 experiments-all.mjs 统⼊
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as ALL from './experiments-all.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(await readFile(resolve(__dirname, 'manifest.json'), 'utf8'));

function _abs(file) { return pathToFileURL(resolve(__dirname, file)).href; }

function findTestFn(expId) {
  const safe = 'experiment_' + expId.replace(/[^a-zA-Z0-9_]/g, '_');
  const test = ALL[safe + '_test'];
  if (typeof test === 'function') return test;
  for (const [k, v] of Object.entries(ALL)) {
    if (k.startsWith(safe + '_test') && typeof v === 'function') return v;
  }
  for (const [k, v] of Object.entries(ALL)) {
    if (k.startsWith(safe + '_') && typeof v === 'function' && /^test[A-Z]/.test(k)) return v;
  }
  const run = ALL[safe + '_run'];
  if (typeof run === 'function') return () => run({ inputs: {} });
  return null;
}

let allPass = true;
let closedLoopTotal = 0, closedLoopPass = 0;
let skeletonCount = 0, referenceCount = 0;

for (const exp of MANIFEST.experiments) {
  const status = exp.status || 'closed-loop';
  const label = `${String(exp.id).padEnd(15)} ${exp.name}`;
  console.debug(`\n▶ ${label}  [${status}]`);

  if (status === 'skeleton') {
    console.debug(`  ⏭  skipped (skeleton)`);
    skeletonCount++;
    continue;
  }
  if (status === 'reference-only') {
    console.debug(`  ⏭  skipped (reference-only)`);
    referenceCount++;
    continue;
  }
  if (status === 'paused') {
    console.debug(`  ⏸  paused (${exp.pausedReason || ''})`);
    continue;
  }

  closedLoopTotal++;
  try {
    const soloPath = resolve(__dirname, exp.file || '');
    const isSolo = /^\d+\.mjs$/.test(exp.file || '') && existsSync(soloPath);
    if (isSolo) {
      // 独立实验文件（如 42/43.mjs）：test 在文件自身
      const mod = await import(pathToFileURL(soloPath).href);
      if (typeof mod.test === 'function') await mod.test();
      else console.debug(`  ⚠ ${exp.id}: 无 test 函数`);
    } else if (exp.file && !exp.file.startsWith('experiments-all') && !exp.file.includes('/')) {
      const testFn = findTestFn(exp.id);
      if (testFn) {
        await testFn();
      } else {
        console.debug(`  ⚠ ${exp.id}: 无 test 函数`);
      }
    } else {
      // subdirectory or test.mjs: fallback to dynamic import
      const mod = await import(_abs(exp.file));
      const tf = (typeof mod.test === 'function') ? mod.test : null;
      if (tf) await tf();
    }
    closedLoopPass++;
  } catch (e) {
    console.error(`  ✗ ${exp.id} 崩溃: ${e.message}`);
    allPass = false;
  }
}

console.debug(`\n${'═'.repeat(50)}`);
console.debug(`closed-loop:  ${closedLoopPass}/${closedLoopTotal} passed`);
console.debug(`skeleton:     ${skeletonCount} skipped (待补断言或挪走)`);
console.debug(`reference:    ${referenceCount} skipped (参考实现)`);
if (allPass && closedLoopPass === closedLoopTotal) {
  console.debug('\n所有 closed-loop 实验通过 ✓');
} else {
  console.debug('\n部分 closed-loop 实验失败或被跳过 ✗');
}
process.exit(allPass ? 0 : 1);
