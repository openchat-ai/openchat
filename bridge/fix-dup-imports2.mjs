// fix-dup-imports2.mjs — smarter dedup: handle imports that declare overlapping identifiers
import { readFile, writeFile } from 'fs/promises';

const F = 'F:/openchat/bridge/src/experiments/experiments-all.mjs';
const src = await readFile(F, 'utf8');
const lines = src.split('\n');

const dropIdx = new Set();
const declSymbols = new Map(); // symbol -> first declaration line index

// Pass 1: dedupe EXACTLY-identical imports (collapsed to single line)
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

// Pass 2: For each import statement, extract named specifiers.
// If a symbol is already declared by an earlier import, remove it from the later import.
// If after removal the import is empty, drop the whole statement.
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i].trim();
  if (!line.startsWith('import ')) continue;
  // Only consider `import { a, b as c, default as d } from 'mod';`
  const m = line.match(/^import\s*\{([^}]+)\}\s*from\s*['"`]([^'"`]+)['"`]\s*;?$/);
  if (!m) continue;
  const inner = m[1];
  const fromSpec = m[2];
  // Parse specifiers
  const specs = inner.split(',').map(s => s.trim()).filter(Boolean);
  const kept = [];
  const removedSpecs = [];
  for (const spec of specs) {
    // { imported, local } — `foo` or `foo as bar` or `default as bar`
    const sm = spec.match(/^(.+?)\s+as\s+(.+)$/);
    const local = sm ? sm[2].trim() : spec;
    if (declSymbols.has(local)) {
      removedSpecs.push(spec);
    } else {
      declSymbols.set(local, i);
      kept.push(spec);
    }
  }
  if (removedSpecs.length > 0) {
    if (kept.length === 0) {
      // Drop the entire import
      dropIdx.add(i);
    } else {
      // Reconstruct the import with only kept specs
      lines[i] = line.replace(/\{[^}]+\}/, `{ ${kept.join(', ')} }`);
    }
  } else {
    // Register all locals
    for (const spec of specs) {
      const sm = spec.match(/^(.+?)\s+as\s+(.+)$/);
      const local = sm ? sm[2].trim() : spec;
      declSymbols.set(local, i);
    }
  }
}

// Pass 3: dedupe single-line `const NAME = '...';` and numeric consts (top-level uppercase)
const seenConst = new Map();
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const line = lines[i];
  const m = line.match(/^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`][^'"`]*['"`]|-?\d+(?:\.\d+)?)\s*;?\s*$/);
  if (!m) continue;
  const name = m[1];
  if (seenConst.has(name) || declSymbols.has(name)) dropIdx.add(i);
  else { seenConst.set(name, i); declSymbols.set(name, i); }
}

// Pass 4: dedupe `async function test()` and `function test()` etc.
// Rename duplicates.
const testNames = new Set(['test', 'testTokenSaving', 'testCoding', 'testDevAux']);
const fnOccurrences = new Map(); // name -> [lineIdx]
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
  if (!m) continue;
  const name = m[1];
  if (!testNames.has(name)) continue;
  if (!fnOccurrences.has(name)) fnOccurrences.set(name, []);
  fnOccurrences.get(name).push(i);
}
const renames = new Map(); // lineIdx -> newName
for (const [name, occs] of fnOccurrences) {
  if (occs.length <= 1) continue;
  for (let n = 1; n < occs.length; n++) {
    const newName = `${name}_${n + 1}`;
    renames.set(occs[n], newName);
    lines[occs[n]] = lines[occs[n]].replace(new RegExp(`\\b${name}\\s*\\(`), `${newName}(`);
  }
}

// Pass 5: update `export { test }` lines to match renames
// For each export line, find the most recent function declaration above it with matching name
const fnDecls = []; // {lineIdx, name}
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
  if (m) fnDecls.push({ lineIdx: i, name: m[1] });
}
for (let i = 0; i < lines.length; i++) {
  if (dropIdx.has(i)) continue;
  const m = lines[i].match(/^export\s*\{\s*([^}]+)\s*\}\s*;?\s*$/);
  if (!m) continue;
  const inner = m[1];
  const parts = inner.split(',').map(p => p.trim()).filter(Boolean);
  const newParts = [];
  let changed = false;
  for (const part of parts) {
    const tm = part.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/);
    if (!tm) { newParts.push(part); continue; }
    const [_, source, alias] = tm;
    // Find the most recent function decl above with this source name
    let mostRecent = null;
    for (const fd of fnDecls) {
      if (fd.name === source && fd.lineIdx < i) mostRecent = fd;
    }
    if (mostRecent && renames.has(mostRecent.lineIdx)) {
      const newName = renames.get(mostRecent.lineIdx);
      newParts.push(alias ? `${newName} as ${alias}` : newName);
      changed = true;
    } else {
      newParts.push(part);
    }
  }
  if (changed) {
    lines[i] = `export { ${newParts.join(', ')} };`;
  }
}

const out = lines.filter((_, i) => !dropIdx.has(i));
const removed = dropIdx.size;
const renamed = renames.size;
await writeFile(F, out.join('\n'), 'utf8');
console.log(`Removed ${removed} duplicate import lines, renamed ${renamed} duplicate functions, ${out.length} lines remain`);
