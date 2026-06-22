// test-entry.mjs — test each entry point with quick import
import { spawn } from 'child_process';

const ENTRIES = [
  'bin/lab.mjs',
  'bin/openchat.mjs',
  'bin/exp.mjs',
  'bin/train-brain.mjs',
  'bin/swap-m2.mjs',
  'src/main.js',
  'src/api-entry.js',
  'src/cli-entry.js',
  'src/experiments/run-all.mjs',
];

for (const e of ENTRIES) {
  console.log(`\n--- ${e} ---`);
  const p = spawn(process.execPath, ['--check', e], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => err += d);
  p.on('close', code => {
    if (code === 0) console.log('  OK (syntax valid)');
    else { console.log(`  FAIL (exit ${code})`); if (err) console.log('  ERR: ' + err.trim()); if (out) console.log('  OUT: ' + out.trim()); }
  });
}
