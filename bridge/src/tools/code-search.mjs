// === invariants ===
// - grepSearch uses ripgrep (rg) when available, falls back to Node.js recursive grep
// - findReferences only parses JS/TS import/export syntax via regex (no full AST)
// - All paths are relative to PROJECT_ROOT; path traversal denied

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = process.cwd();

function safeResolve(filePath) {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) throw new Error('Path traversal denied');
  return resolved;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function hasRipgrep() {
  try { execSync('rg --version', { stdio: 'ignore' }); return true; } catch { return false; }
}

export async function grepSearch(query, options = {}) {
  const root = options.rootDir ? safeResolve(options.rootDir) : PROJECT_ROOT;
  const include = options.include || '';
  const exclude = options.exclude || '';
  const maxResults = options.maxResults || 200;
  const results = [];

  if (hasRipgrep()) {
    const args = ['--line-number', '--with-filename', '--color', 'never', '-m', '1', '-g', `!node_modules`];
    if (include) args.push('-g', include);
    if (exclude) args.push('-g', `!${exclude}`);
    args.push('--', query, root);
    const stdout = execSync(`rg ${args.join(' ')}`, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (let i = 0; i < Math.min(lines.length, maxResults); i++) {
      const [file, lineNum, ...rest] = lines[i].split(':');
      results.push({ file: path.relative(PROJECT_ROOT, path.resolve(file)), line: parseInt(lineNum, 10), content: rest.join(':').trim() });
    }
  } else {
    async function walk(dir) {
      if (results.length >= maxResults) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          if (include && !entry.name.match(new RegExp(include.replace(/\*/g, '.*')))) continue;
          try {
            const content = await fs.readFile(full, 'utf8');
            const lines = content.split('\n');
            for (let l = 0; l < lines.length && results.length < maxResults; l++) {
              if (lines[l].includes(query)) results.push({ file: path.relative(PROJECT_ROOT, full), line: l + 1, content: lines[l].trim() });
            }
          } catch { /* skip unreadable */ }
        }
      }
    }
    await walk(root);
  }
  return results;
}

export async function findReferences(symbol, options = {}) {
  const root = options.rootDir ? safeResolve(options.rootDir) : PROJECT_ROOT;
  const maxResults = options.maxResults || 100;
  const definitions = [];
  const usages = [];

  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.(js|mjs|cjs|ts|jsx|tsx)$/i.test(entry.name)) {
        try {
          const content = await fs.readFile(full, 'utf8');
          const lines = content.split('\n');
          for (let l = 0; l < lines.length; l++) {
            const line = lines[l];
            const relPath = path.relative(PROJECT_ROOT, full);

            // Export detection
            if (new RegExp(`(export\\s+(default\\s+)?(function|class|const|let|var|interface|type)\\s+)?${symbol}\\b`).test(line)) {
              definitions.push({ file: relPath, line: l + 1, content: line.trim(), kind: 'definition' });
            }

            // Import detection
            if (new RegExp(`(import|require)\\s*[\\s\\S]*?['"\`]${symbol}['"\`]|from\\s+['"\`].*${symbol}`).test(line)) {
              definitions.push({ file: relPath, line: l + 1, content: line.trim(), kind: 'import' });
            }

            // Usage (not def/import)
            if (line.includes(symbol) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
              const isDef = definitions.some(d => d.file === relPath && d.line === l + 1);
              if (!isDef) usages.push({ file: relPath, line: l + 1, content: line.trim() });
            }

            if (definitions.length + usages.length >= maxResults * 2) return;
          }
        } catch { /* skip */ }
      }
    }
  }

  await walk(root);
  return { definitions: definitions.slice(0, maxResults), usages: usages.slice(0, maxResults) };
}

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents by text pattern. Uses ripgrep if available, falls back to Node.js recursive search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text pattern to search for' },
          include: { type: 'string', description: 'Glob pattern to include files (e.g. "*.{js,mjs}")' },
          exclude: { type: 'string', description: 'Glob pattern to exclude files' },
          rootDir: { type: 'string', description: 'Root directory relative to project root' },
          maxResults: { type: 'number', description: 'Max results (default 200)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_refs',
      description: 'Find symbol definitions and usages across JS/TS files. Parses import/export syntax.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to find' },
          rootDir: { type: 'string', description: 'Root directory relative to project root' },
          maxResults: { type: 'number', description: 'Max results per category (default 100)' },
        },
        required: ['symbol'],
      },
    },
  },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'grep': return grepSearch(args.query, { include: args.include, exclude: args.exclude, rootDir: args.rootDir, maxResults: args.maxResults });
    case 'find_refs': return findReferences(args.symbol, { rootDir: args.rootDir, maxResults: args.maxResults });
    default: throw new Error(`Unknown code-search tool: ${name}`);
  }
}
