// fix-dup2.mjs — multi-pass dedup with progressive error recovery
import { readFile, writeFile, copyFile } from 'fs/promises';
import { execSync } from 'child_process';

const F = 'F:/openchat/bridge/src/experiments/experiments-all.mjs';
await copyFile(F, F + '.bak');

async function check() {
  try {
    execSync(`node --check "${F}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch (e) {
    const msg = e.stderr.toString();
    const m = msg.match(/SyntaxError: (.+)/);
    return m ? m[1].trim() : 'unknown';
  }
}

function dedupImportDecls(lines, dropIdx) {
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (dropIdx.has(i)) continue;
    const line = lines[i].trim();
    if (!line.startsWith('import ')) continue;
    let end = i;
    let accum = line;
    while (!accum.includes(';') && end < lines.length - 1) {
      end++;
      accum += ' ' + lines[end].trim();
    }
    const norm = accum.replace(/\s+/g, ' ').replace(/;$/, '').trim();
    if (seen.has(norm)) {
      for (let k = i; k <= end; k++) dropIdx.add(k);
    } else {
      seen.set(norm, i);
    }
    i = end;
  }
}

function dedupSingleLineConsts(lines, dropIdx) {
  // const X = 'string' or numeric, single line
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (dropIdx.has(i)) continue;
    const line = lines[i];
    const m = line.match(/^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`][^'"`]*['"`]|-?\d+(?:\.\d+)?)\s*;?\s*$/);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) dropIdx.add(i);
    else seen.set(name, i);
  }
}

function dedupSingleLineFuncs(lines, dropIdx) {
  // async function NAME(  or  function NAME(  on a single line
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (dropIdx.has(i)) continue;
    const line = lines[i];
    const m = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) {
      // For multi-line functions, find the end of the function. For single-line, drop the line.
      // Multi-line function: starts with `function name(...) {` and ends with matching `}`
      // If line contains `}` (single-line) drop the line; otherwise find end
      if (line.includes('}') || (line.match(/\{[^}]*\}/))) {
        dropIdx.add(i);
      } else {
        // Multi-line: find matching `}`
        let depth = 0;
        let j = i;
        let started = false;
        while (j < lines.length) {
          for (const c of lines[j]) {
            if (c === '{') { depth++; started = true; }
            else if (c === '}') depth--;
          }
          if (started && depth === 0) { dropIdx.add(j); break; }
          j++;
        }
      }
    } else {
      seen.set(name, i);
    }
  }
}

async function runPass(name, fn) {
  let src = await readFile(F, 'utf8');
  let lines = src.split('\n');
  let dropIdx = new Set();
  fn(lines, dropIdx);
  const out = lines.filter((_, i) => !dropIdx.has(i));
  await writeFile(F, out.join('\n'), 'utf8');
  console.log(`Pass ${name}: removed ${dropIdx.size}, ${out.length} lines remain`);
}

let prevErr = '';
for (let iter = 0; iter < 10; iter++) {
  await runPass('imports+consts', (l, d) => { dedupImportDecls(l, d); dedupSingleLineConsts(l, d); });
  await runPass('funcs', (l, d) => dedupSingleLineFuncs(l, d));
  const err = await check();
  if (err === true) { console.log('All errors fixed!'); break; }
  if (err === prevErr) { console.log(`Stuck on: ${err}`); break; }
  console.log(`Error: ${err}`);
  prevErr = err;
}
