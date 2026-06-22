// fix-dup-test.mjs — rename duplicate `async function test()` declarations to test_NN
// and update their `export { test };` to `export { test_NN as test };`
import { readFile, writeFile } from 'fs/promises';

const F = 'F:/openchat/bridge/src/experiments/experiments-all.mjs';
const src = await readFile(F, 'utf8');
const lines = src.split('\n');

const dropIdx = new Set();

// Pass 1: dedupe imports (same as before)
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

// Pass 2: dedupe single-line `const NAME = '...';` and numeric consts
const seenConst = new Map();
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  const m = line.match(/^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`][^'"`]*['"`]|-?\d+(?:\.\d+)?)\s*;?\s*$/);
  if (!m) continue;
  const name = m[1];
  if (seenConst.has(name)) dropIdx.add(i);
  else seenConst.set(name, i);
}

// Pass 3: rename duplicate `async function test()` and `function test()` and
// the corresponding `export { test }` / `export { ... as test }` lines
const seenTest = new Map(); // name -> first index
let testCounter = 0;
const RENAMED = new Map(); // old name -> new name

for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  // Match `async function test() {` or `function test() {` at start of line
  const m = line.match(/^(async\s+)?function\s+(test|testTokenSaving|testCoding|testDevAux)\s*\(/);
  if (!m) continue;
  const name = m[2];
  if (seenTest.has(name)) {
    // Rename
    testCounter++;
    const newName = `${name}_${testCounter}`;
    RENAMED.set(`${i}|${name}`, newName);
    // Replace the function declaration
    lines[i] = line.replace(new RegExp(`\\b${name}\\s*\\(`), `${newName}(`);
  } else {
    seenTest.set(name, i);
  }
}

// Pass 4: update `export { test }` and `export { testXxx as test }` lines
// to match the renames. For the FIRST occurrence we leave as is; for duplicates we replace.
const testFirstIdx = new Map();
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  const m = line.match(/^export\s*\{\s*([^}]+)\s*\};?\s*$/);
  if (!m) continue;
  const inner = m[1];
  // Check if this is a test export
  const innerM = inner.match(/^test(?:TokenSaving|Coding|DevAux)?(?:\s*,\s*test(?:TokenSaving|Coding|DevAux)?\s+as\s+test)?$/);
  if (!innerM) continue;
  // Find which test function was last declared before this export
  // ... actually simpler: for the Nth `export { test }` matching a duplicate,
  // rename the export source.
}

// Simpler approach: track renames by index. Re-walk and update.
const occurrences = []; // [{lineIdx, name}]
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  const m = line.match(/^(?:async\s+)?function\s+(test|testTokenSaving|testCoding|testDevAux)\s*\(/);
  if (m) occurrences.push({ lineIdx: i, name: m[1] });
}
const nameCount = new Map();
for (const occ of occurrences) {
  const n = (nameCount.get(occ.name) || 0) + 1;
  nameCount.set(occ.name, n);
}
const renamedOcc = new Map(); // original lineIdx -> new name (only for duplicates)
const cnt = new Map();
for (const occ of occurrences) {
  const total = nameCount.get(occ.name);
  const n = (cnt.get(occ.name) || 0) + 1;
  cnt.set(occ.name, n);
  if (n > 1) {
    const newName = `${occ.name}_dup${n}`;
    renamedOcc.set(occ.lineIdx, newName);
    // Replace the function decl
    lines[occ.lineIdx] = lines[occ.lineIdx].replace(new RegExp(`\\b${occ.name}\\s*\\(`), `${newName}(`);
  }
}

// Now find `export { ... test ... }` lines and update source for duplicates.
// For each export line, find the most recent function declaration above it
// that has the same name as the export's source.
const fnDecls = []; // {lineIdx, name}
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const m = lines[i].match(/^(?:async\s+)?function\s+(test|testTokenSaving|testCoding|testDevAux)\s*\(/);
  if (m) fnDecls.push({ lineIdx: i, name: m[1] });
}

for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  const em = line.match(/^export\s*\{\s*([^}]+)\s*\};?\s*$/);
  if (!em) continue;
  const inner = em[1];
  // Find the test source name in this export
  const sourceMatch = inner.match(/(test|testTokenSaving|testCoding|testDevAux)(?=\s*(?:,|\s+as\s+test|$))/);
  if (!sourceMatch) continue;
  const sourceName = sourceMatch[1];
  // Find the most recent fnDecl with this name above
  let mostRecent = null;
  for (const fd of fnDecls) {
    if (fd.name === sourceName && fd.lineIdx < i) mostRecent = fd;
  }
  if (mostRecent && renamedOcc.has(mostRecent.lineIdx)) {
    const newName = renamedOcc.get(mostRecent.lineIdx);
    // Replace the export source name with the new name
    // e.g. "export { test };" -> "export { test_dup2 };"
    // e.g. "export { testTokenSaving, testTokenSaving as test };" -> "export { testTokenSaving_dup2, testTokenSaving_dup2 as test };"
    // The second form keeps the "as test" alias which is correct for run-all.mjs's `experiment_XX_test` lookup.
    lines[i] = inner
      .split(',')
      .map(part => {
        const tm = part.match(/^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:as\s+([A-Za-z_$][A-Za-z0-9_$]*))?\s*$/);
        if (!tm) return part;
        const [_, n, alias] = tm;
        if (n === sourceName) {
          return alias ? `${newName} as ${alias}` : newName;
        }
        return part;
      })
      .join(',')
      .replace(/^/, 'export { ')
      .replace(/$/, ' };');
  }
}

const out = lines.filter((_, i) => !dropIdx.has(i));
const removed = dropIdx.size;
const renamed = renamedOcc.size;
await writeFile(F, out.join('\n'), 'utf8');
console.log(`Removed ${removed} duplicate lines, renamed ${renamed} duplicate test functions, ${out.length} lines remain`);
