// Merge lab modules into lab-core.mjs
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge', 'src', 'lab');

// All lab files EXCEPT runner/cron/scout/supervisor
const files = [
  'lab-events.mjs',
  'active-runs.mjs',
  'findings.mjs',
  'scout-shared.mjs',
  'goal-queue.mjs',
  'history.mjs',
  'failure-analyzer.mjs',
  'notifier.mjs',
  'aggregator.mjs',
  'digest.mjs',
  'regression.mjs',
  'escalate.mjs',
  'auto-heal.mjs',
  'path-explorer.mjs',
  'dependency-graph.mjs',
  'knowledge-extract.mjs',
  'lab-health.mjs',
  'git-diff.mjs',
  join('fixers', 'empty-catch.mjs'),
  join('fixers', 'index.mjs'),
];

const externalImports = new Map(); // source -> { default, named }
const bodyParts = [];
const allExports = [];
const META_RENAMES = {
  'active-runs.mjs': 'META_activeRuns',
  'auto-heal.mjs': 'META_autoHeal',
  'digest.mjs': 'META_digest',
  'knowledge-extract.mjs': 'META_knowledgeExtract',
  'path-explorer.mjs': 'META_pathExplorer',
};
let errors = [];

for (const f of files) {
  const filePath = join(LAB, f);
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    errors.push(`Cannot read ${f}: ${e.message}`);
    continue;
  }

  const lines = content.split('\n');
  const outputLines = [];
  let hasMETA = false;

  for (let line of lines) {
    // Handle imports
    const importMatch = line.match(/^import\s+(?:(.+?)\s+from\s+)?['"](.+)['"];?$/);
    if (importMatch) {
      const specifier = importMatch[2];
      if (specifier.startsWith('.')) {
        // Internal import — skip
        continue;
      }
      // External import — collect
      const clause = importMatch[1] || '';
      if (!externalImports.has(specifier)) {
        externalImports.set(specifier, { default: null, named: [] });
      }
      const entry = externalImports.get(specifier);
      if (clause) {
        if (clause.startsWith('{')) {
          const names = clause.replace(/[{}]/g, '').split(',').map(n => n.trim()).filter(Boolean);
          for (const n of names) {
            if (!entry.named.includes(n)) entry.named.push(n);
          }
        } else if (clause.startsWith('* as ')) {
          // namespace import
        } else {
          // default import
          entry.default = clause;
        }
      }
      continue;
    }

    // Handle export function/const/async function
    const exportMatch = line.match(/^export\s+(function|const|async\s+function|let|var)\s+/);
    if (exportMatch) {
      // Strip "export "
      const stripped = line.replace(/^export\s+/, '');
      outputLines.push(stripped);

      // Collect export name
      const nameMatch = line.match(/export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/);
      if (nameMatch) {
        let name = nameMatch[1];

        // Handle META renaming
        if (name === 'META' && META_RENAMES[f]) {
          // Replace META in the output with renamed version
          const idx = outputLines.length - 1;
          outputLines[idx] = outputLines[idx].replace(/\bMETA\b/, META_RENAMES[f]);
          allExports.push({ orig: 'META', renamed: META_RENAMES[f] });
          hasMETA = true;
          continue;
        }

        allExports.push({ orig: name, renamed: null });
      }
      continue;
    }

    // Handle export default (none in lab modules)
    const exportDefault = line.match(/^export\s+default\s+/);
    if (exportDefault) {
      outputLines.push(line.replace(/^export\s+default\s+/, '// default: '));
      continue;
    }

    // Handle bare export { ... }
    const exportBlock = line.match(/^export\s*\{/);
    if (exportBlock) {
      // Skip individual export blocks — we'll emit one at end
      continue;
    }

    outputLines.push(line);
  }

  bodyParts.push(outputLines.join('\n'));
}

// Build consolidated imports
const importLines = [];
for (const [spec, entry] of externalImports) {
  if (entry.default && entry.named.length > 0) {
    importLines.push(`import ${entry.default}, { ${entry.named.join(', ')} } from '${spec}';`);
  } else if (entry.default) {
    importLines.push(`import ${entry.default} from '${spec}';`);
  } else if (entry.named.length > 0) {
    importLines.push(`import { ${entry.named.join(', ')} } from '${spec}';`);
  } else {
    importLines.push(`import '${spec}';`);
  }
}

// Build final export block
const exportNames = allExports.map(e => e.renamed || e.orig);
const exportBlock = `\nexport { ${exportNames.join(', ')} };\n`;

const merged = `// === lab-core.mjs — Merged lab modules ===\n// Combined from: ${files.map(f => typeof f === 'string' ? f : f.join('/')).join(', ')}\n\n${importLines.join('\n')}\n\n// ===============================\n// Module code\n// ===============================\n\n${bodyParts.join('\n\n')}${exportBlock}`;

writeFileSync(join(LAB, 'lab-core.mjs'), merged, 'utf8');

console.log(`Written ${merged.length} bytes`);
console.log(`Exports: ${exportNames.length} symbols`);
if (errors.length > 0) {
  console.error(`Errors: ${errors.join('; ')}`);
}
