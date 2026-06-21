// Merge runner.mjs, cron.mjs, scout.mjs, supervisor.mjs into lab-runner.mjs
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge', 'src', 'lab');

const KEEP_RELATIVE = ['./scouts/'];
const files = ['runner.mjs', 'cron.mjs', 'scout.mjs', 'supervisor.mjs'];

// First pass: collect all exports from merged files
const mergedExports = new Set();
for (const f of files) {
  const content = readFileSync(join(LAB, f), 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/);
    if (m) mergedExports.add(m[1]);
  }
}

// Second pass: process files
const externalImports = new Map();
const allExports = [];
const bodyParts = [];
const coreImports = new Set(); // symbols needed from lab-core.mjs

for (const f of files) {
  const filePath = join(LAB, f);
  const lines = readFileSync(filePath, 'utf8').split('\n');
  const outputLines = [];

  for (let line of lines) {
    // Handle imports
    const importMatch = line.match(/^import\s+(?:(.+?)\s+from\s+)?['"](.+)['"];?$/);
    if (importMatch) {
      const specifier = importMatch[2];
      const clause = importMatch[1] || '';

      if (specifier.startsWith('.')) {
        // Keep broken paths as-is
        if (KEEP_RELATIVE.some(p => specifier.startsWith(p))) {
          outputLines.push(line);
          continue;
        }
        // Extract symbols and check if they come from merged files or core
        if (clause) {
          const match = clause.match(/\{\s*([^}]+)\s*\}/);
          if (match) {
            for (const s of match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
              if (!mergedExports.has(s)) {
                coreImports.add(s);
              }
            }
          }
        }
        continue; // skip import
      }

      // External import
      if (!externalImports.has(specifier)) {
        externalImports.set(specifier, { default: null, named: [] });
      }
      const entry = externalImports.get(specifier);
      if (clause) {
        if (clause.startsWith('{')) {
          const names = clause.replace(/[{}]/g, '').split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
          for (const n of names) {
            if (!entry.named.includes(n)) entry.named.push(n);
          }
        } else {
          entry.default = clause;
        }
      }
      continue;
    }

    // Export declarations
    const exportMatch = line.match(/^export\s+(function|const|async\s+function|let|var)\s+/);
    if (exportMatch) {
      outputLines.push(line.replace(/^export\s+/, ''));
      const nameMatch = line.match(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/);
      if (nameMatch) allExports.push(nameMatch[1]);
      continue;
    }
    if (line.match(/^export\s*\{/)) continue;

    outputLines.push(line);
  }
  bodyParts.push({ file: f, lines: outputLines.join('\n') });
}

// Build imports
const importLines = [];
for (const [spec, entry] of externalImports) {
  if (entry.default && entry.named.length > 0) {
    importLines.push(`import ${entry.default}, { ${entry.named.join(', ') } } from '${spec}';`);
  } else if (entry.default) {
    importLines.push(`import ${entry.default} from '${spec}';`);
  } else if (entry.named.length > 0) {
    importLines.push(`import { ${entry.named.join(', ') } } from '${spec}';`);
  }
}

// Core import
if (coreImports.size > 0) {
  importLines.push(`import { ${[...coreImports].sort().join(', ') } } from './lab-core.mjs';`);
}

const exportBlock = `\nexport { ${allExports.join(', ') } };\n`;

const merged = `// === lab-runner.mjs — Merged lab runner modules ===\n// Combined from: ${files.join(', ')}\n\n${importLines.join('\n')}\n\n// ===============================\n// Module code\n// ===============================\n\n${bodyParts.map(b => `// --- ${b.file} ---\n${b.lines}`).join('\n\n')}${exportBlock}`;

writeFileSync(join(LAB, 'lab-runner.mjs'), merged, 'utf8');
console.log(`Done: ${(merged.length / 1024).toFixed(1)}KB, ${allExports.length} exports, ${coreImports.size} core deps`);
