// fix-dup.mjs — careful dedup of duplicate top-level imports + duplicate top-level const NAME/MAX_STEPS.
// Conservative: only removes when the next duplicate starts and is clearly the same identifier assignment
// that ends with `;` on the same line.
import { readFile, writeFile } from 'fs/promises';

const F = 'F:/openchat/bridge/src/experiments/experiments-all.mjs';
const src = await readFile(F, 'utf8');
const lines = src.split('\n');

const dropIdx = new Set();

// Pass 1: dedupe imports (already done in prior commit, but re-run for safety)
const seenImp = new Map();
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith('import ')) continue;
  let end = i;
  let accum = line;
  while (!accum.includes(';') && end < lines.length - 1) {
    end++;
    accum += ' ' + lines[end].trim();
  }
  const norm = accum.replace(/\s+/g, ' ').replace(/;$/, '').trim();
  if (seenImp.has(norm)) {
    for (let k = i; k <= end; k++) dropIdx.add(k);
  } else {
    seenImp.set(norm, i);
  }
  i = end;
}

// Pass 2: dedupe `const NAME = '...';` (string-only) and `const X = N;` (numeric) on a single line
// These were duplicated by the merge: `const NAME = '...';` and `const MAX_STEPS = 8;`
const seenConst = new Map();
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  // Top-level (no leading whitespace) const UPPERCASE = <string|number>; on a single line
  const m = line.match(/^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`][^'"`]*['"`]|-?\d+(?:\.\d+)?)\s*;?\s*$/);
  if (!m) continue;
  const name = m[1];
  if (seenConst.has(name)) {
    dropIdx.add(i);
  } else {
    seenConst.set(name, i);
  }
}

const out = lines.filter((_, i) => !dropIdx.has(i));
const removed = dropIdx.size;
await writeFile(F, out.join('\n'), 'utf8');
console.log(`Removed ${removed} duplicate lines, kept ${out.length} (was ${lines.length})`);
