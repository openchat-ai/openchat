// scan-imports.mjs — find broken relative imports
import { readFile, stat, readdir } from 'fs/promises';
import { join, resolve, dirname, extname, basename } from 'path';

const ROOT = 'F:/openchat/bridge';
const SKIP = ['node_modules', '__tests__', '.git', 'test-results', 'replay-results', '.openchat'];

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = await walk(ROOT);
console.log(`Scanning ${files.length} files...`);

let brokenCount = 0;
const broken = [];

for (const f of files) {
  const src = await readFile(f, 'utf8').catch(() => '');
  // Match: import x from 'path';  or  import x from "path"  or  import('path')
  const re = /import\s+(?:[^'"`;]+?\s+from\s+)?['"`]([^'"`]+)['"`]|import\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith('.')) continue;
    const target = resolve(dirname(f), spec);
    let exists = false;
    try {
      const s = await stat(target);
      if (s.isFile() || s.isDirectory()) exists = true;
    } catch {}
    if (!exists) {
      // try with extensions
      for (const ext of ['.mjs', '.js', '/index.mjs', '/index.js', '.json']) {
        try {
          await stat(target + ext);
          exists = true;
          break;
        } catch {}
      }
    }
    if (!exists) {
      const rel = f.slice(ROOT.length + 1);
      broken.push(`${rel} :: ${spec}`);
      brokenCount++;
    }
  }
}

console.log(`Found ${brokenCount} broken imports:`);
for (const b of broken) console.log(`  ${b}`);
