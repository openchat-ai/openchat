// Multi-file edit — apply the same search/replace across multiple files matched by glob.
// === invariants ===
// - Uses built-in fs + minimatch-style pattern matching (no external deps)
// - Each file is edited via coding-tools' editFile with quality gate
// - Skips files where search string is not found (reports as skipped)
// - All results returned in a single batch

import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = process.cwd();

// Simple glob matching: * matches anything except /, ** matches everything
function matchGlob(filePath, pattern) {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '☯')
    .replace(/\*/g, '[^/]*')
    .replace(/☯/g, '.*');
  return new RegExp('^' + regexStr + '$').test(filePath.replace(/\\/g, '/'));
}

async function findFiles(dir, pattern, results = [], rootDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      await findFiles(fullPath, pattern, results, rootDir);
    } else if (entry.isFile() && matchGlob(relPath, pattern)) {
      results.push(relPath);
    }
  }
  return results;
}

export async function multiEdit(globPattern, search, newStr, options = {}) {
  const { force = false } = options;

  const files = await findFiles(PROJECT_ROOT, globPattern);
  if (files.length === 0) {
    return { edited: 0, skipped: 0, errors: 0, files: [], message: `No files matched "${globPattern}"` };
  }

  const { editFile, readFile } = await import('./coding-tools.mjs');
  const results = [];
  let editedCount = 0, skippedCount = 0, errorCount = 0;

  for (const f of files) {
    try {
      const content = await readFile(f);
      if (!content.includes(search)) {
        results.push({ file: f, status: 'skipped', reason: 'search not found' });
        skippedCount++;
        continue;
      }
      const r = await editFile(f, search, newStr, { force, lint: !force });
      results.push({ file: f, status: 'edited', oldBytes: r.oldBytes, newBytes: r.newBytes });
      editedCount++;
    } catch (e) {
      results.push({ file: f, status: 'error', error: e.message });
      errorCount++;
    }
  }

  return {
    edited: editedCount,
    skipped: skippedCount,
    errors: errorCount,
    files: results,
  };
}

// Unified dispatch for dev.mjs tool loop
export async function executeTool(name, args) {
  if (name === 'multi_edit') {
    return multiEdit(args.pattern, args.search, args.newStr, { force: args.force === true });
  }
  throw new Error(`Unknown tool: ${name}`);
}
