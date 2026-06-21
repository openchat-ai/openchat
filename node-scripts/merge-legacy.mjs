// Append legacy.js into all-routes.mjs
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge', 'src', 'api', 'routes');
const allRoutesPath = join(ROOT, 'all-routes.mjs');
const legacyPath = join(ROOT, 'legacy.js');

let allContent = readFileSync(allRoutesPath, 'utf8');
const legacyContent = readFileSync(legacyPath, 'utf8');

// Check if legacy is already merged
if (allContent.includes('legacyRouter')) {
  console.log('legacy already merged');
  process.exit(0);
}

// Process legacy.js lines
const lines = legacyContent.split('\n');
const outputLines = [];
const newExports = [];

// Track what imports legacy already provides vs what all-routes.mjs already has
for (const line of lines) {
  // Handle imports — skip external imports already in all-routes.mjs
  // Keep ./lib/ imports (internal routes/ files)
  const importMatch = line.match(/^import\s+(?:(.+?)\s+from\s+)?['"](.+)['"];?$/);
  if (importMatch) {
    const specifier = importMatch[2];
    if (specifier.startsWith('./lib/')) {
      // Keep — internal to routes/
      outputLines.push(line);
    }
    // Skip everything else (already in scope or merged)
    continue;
  }

  // Rename router → legacyRouter
  if (line === 'const router = express.Router();') {
    outputLines.push('const legacyRouter = express.Router();');
    continue;
  }

  // Handle exports
  const exportFunc = line.match(/^export\s+(function|const|async\s+function)\s+(\w+)/);
  if (exportFunc) {
    newExports.push(exportFunc[2]);
    outputLines.push(line.replace(/^export\s+/, ''));
    continue;
  }

  if (line === 'export default router;') {
    continue; // handled in export block
  }

  if (line.match(/^export\s*\{/)) continue;

  outputLines.push(line);
}

// Replace last `export { ... };` line in all-routes.mjs
const exportLineMatch = allContent.match(/\nexport \{ [^}]+\};?\n?$/);
if (!exportLineMatch) {
  console.error('Cannot find export line in all-routes.mjs');
  process.exit(1);
}

const currentExports = exportLineMatch[0].replace(/^export \{ /, '').replace(/\s+\};?$/, '').split(', ').filter(Boolean);
const mergedExports = [...currentExports, 'legacyRouter', ...newExports];

const exportBlock = `\nexport { ${mergedExports.join(', ')} };\n`;

// Insert legacy code before the export block (at the end of allContent)
const insertPoint = allContent.lastIndexOf('\nexport {');
const newContent = allContent.slice(0, insertPoint) +
  '\n// ===============================\n// Legacy Routes (from legacy.js)\n// ===============================\n\n' +
  outputLines.join('\n') +
  exportBlock;

writeFileSync(allRoutesPath, newContent, 'utf8');
console.log(`Merged: ${newExports.length} new exports, ${newContent.length} bytes`);
