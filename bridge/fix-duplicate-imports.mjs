// fix-duplicate-imports.mjs — remove duplicate top-level imports + duplicate top-level const NAME/MAX_STEPS etc.
import { readFile, writeFile } from 'fs/promises';

const F = 'F:/openchat/bridge/src/experiments/experiments-all.mjs';
const src = await readFile(F, 'utf8');
const lines = src.split('\n');

const dropIdx = new Set();

// Pass 1: dedupe imports
const seenImp = new Map();
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith('import ') && !line.startsWith('import{')) continue;
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

// Pass 2: dedupe top-level const NAME / const MAX_STEPS / const HARDCODED / etc.
// We only dedupe `const X = ...` at the very start of a line (no leading whitespace).
const seenConst = new Map();
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  // Only consider "const NAME = ..." at top-level (no indentation)
  const m = line.match(/^const\s+([A-Z_][A-Z0-9_]*)\s*=/);
  if (!m) continue;
  const name = m[1];
  if (seenConst.has(name)) {
    // Find end of statement (line ending with ; or { ... })
    let end = i;
    let depth = 0;
    let started = false;
    while (end < lines.length) {
      const l = lines[end];
      for (const c of l) {
        if (c === '{') { depth++; started = true; }
        else if (c === '}') { depth--; }
      }
      if (started && depth === 0) break;
      end++;
    }
    // Drop the duplicate block
    for (let k = i; k <= end; k++) dropIdx.add(k);
  } else {
    seenConst.set(name, i);
  }
}

const out = lines.filter((_, i) => !dropIdx.has(i));
const removed = dropIdx.size;
await writeFile(F, out.join('\n'), 'utf8');
console.log(`Removed ${removed} duplicate lines, kept ${out.length} (was ${lines.length})`);
