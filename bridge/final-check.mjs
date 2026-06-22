// final-check.mjs — Comprehensive entry point check.
// For each entry point, try to import it (resolves all static imports).
// Then for each dynamic import string we can detect, see if it resolves.
import { readFile, stat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
import { spawn } from 'child_process';

const ROOT = 'F:/openchat/bridge';
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
  'src/experiments/42.mjs',
  'src/experiments/lingbao/40.mjs',
  'src/experiments/lingbao/41.mjs',
  'src/experiments/lingbao/42.mjs',
  'src/experiments/lingbao/44.mjs',
  'src/experiments/lingbao/45.mjs',
];

async function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const target = resolve(dirname(fromFile), spec);
  for (const ext of ['', '.mjs', '.js', '/index.mjs', '/index.js']) {
    try { const s = await stat(target + ext); if (s.isFile()) return target + ext; } catch {}
  }
  return null;
}

async function checkFileEntry(entryPath) {
  const filePath = join(ROOT, entryPath);
  const url = pathToFileURL(filePath).href;
  // Static check
  const proc = spawn(process.execPath, ['-e', `import(${JSON.stringify(url)}).then(()=>process.exit(0),e=>{console.log(e.code+': '+e.message);process.exit(1)})`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => err += d);
  const code = await new Promise(r => proc.on('close', r));
  return { code, out: out.trim(), err: err.trim() };
}

async function checkFileImports(entryPath) {
  // For each dynamic import string in the file, verify it resolves
  const filePath = join(ROOT, entryPath);
  const src = await readFile(filePath, 'utf8').catch(() => '');
  const re = /import\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const dynamic = [];
  let m;
  while ((m = re.exec(src))) dynamic.push(m[1]);
  const results = [];
  for (const spec of dynamic) {
    if (!spec.startsWith('.')) { results.push({ spec, status: 'node' }); continue; }
    const resolved = await resolveSpec(filePath, spec);
    results.push({ spec, status: resolved ? 'ok' : 'BROKEN' });
  }
  return results;
}

console.log('=== Entry point static-import check ===');
for (const e of ENTRIES) {
  const r = await checkFileEntry(e);
  const status = r.code === 0 ? 'OK' : 'FAIL';
  console.log(`  ${e.padEnd(40)} ${status}${r.out ? ' :: ' + r.out.split('\n')[0] : ''}`);
}

console.log('\n=== Dynamic import resolution check ===');
for (const e of ENTRIES) {
  const r = await checkFileImports(e);
  const broken = r.filter(x => x.status === 'BROKEN');
  if (broken.length === 0) console.log(`  ${e.padEnd(40)} OK (${r.length} dynamic imports)`);
  else { console.log(`  ${e.padEnd(40)} ${broken.length} BROKEN:`); for (const b of broken) console.log(`    - ${b.spec}`); }
}
