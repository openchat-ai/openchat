// test-entry-import.mjs — test each entry point for ERR_MODULE_NOT_FOUND
import { spawn } from 'child_process';

const ENTRIES = [
  'bin/lab.mjs',
  'bin/exp.mjs',
  'bin/train-brain.mjs',
  'bin/swap-m2.mjs',
  'src/api-entry.js',
  'src/cli-entry.js',
];

// These need special handling - they actually start the bridge
const HEAVY = ['bin/openchat.mjs', 'src/main.js', 'src/experiments/run-all.mjs'];

async function checkEntry(entry, quickArgs = []) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [entry, ...quickArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      resolve({ code, out, err });
    });
    p.on('error', e => resolve({ code: -1, out, err: e.message }));
  });
}

for (const e of ENTRIES) {
  console.log(`\n--- ${e} ---`);
  // Try --help first
  const r = await checkEntry(e, ['--help']);
  if (r.err.includes('ERR_MODULE_NOT_FOUND')) {
    console.log('  IMPORT FAIL:');
    const lines = r.err.split('\n').filter(l => l.includes('ERR_MODULE_NOT_FOUND') || l.includes('imported from') || l.includes('Cannot find'));
    for (const l of lines) console.log('    ' + l.trim());
  } else {
    console.log(`  exit=${r.code}, no module error`);
    if (r.err && r.err.length < 500) console.log('  stderr: ' + r.err.trim().slice(0, 200));
  }
}
