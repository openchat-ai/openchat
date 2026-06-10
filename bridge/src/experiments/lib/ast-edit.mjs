// AST edit — syntax-aware editing for JS/JSX files using acorn.
// === invariants ===
// - Only works for .js/.jsx/.mjs files (falls back to error for other types)
// - Uses acorn to parse, walks AST to find target node by selector
// - Edits source by replacing at AST position — no codegen needed
// - Selectors: function:{name}, class:{name}, const:{name}, let:{name}, var:{name}
// - edit: rename, replace_body (replace function body)

import { readFile, writeFile } from './coding-tools.mjs';
import path from 'path';

const JS_EXT = /\.(js|jsx|mjs|cjs)$/;

// Simple AST walker (no acorn-walk dependency)
function walkFind(node, test) {
  if (!node || typeof node !== 'object') return null;
  if (test(node)) return node;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = walkFind(item, test);
        if (found) return found;
      }
    } else if (child && typeof child.type === 'string') {
      const found = walkFind(child, test);
      if (found) return found;
    }
  }
  return null;
}

function parseSelector(selector) {
  const colonIdx = selector.indexOf(':');
  if (colonIdx === -1) return { type: 'all', name: selector };
  return { type: selector.substring(0, colonIdx), name: selector.substring(colonIdx + 1) };
}

function buildTest(parsed) {
  return (node) => {
    if (parsed.type === 'all') return true;
    if (parsed.type === 'function') {
      return (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
        && node.id?.name === parsed.name;
    }
    if (parsed.type === 'class') {
      return node.type === 'ClassDeclaration' && node.id?.name === parsed.name;
    }
    if (['const', 'let', 'var'].includes(parsed.type)) {
      return node.type === 'VariableDeclaration'
        && node.declarations?.some(d => d.id?.name === parsed.name);
    }
    return false;
  };
}

export async function astEdit(filePath, selector, action, newValue) {
  if (!JS_EXT.test(filePath)) {
    throw new Error(`AST edit only supports .js/.jsx/.mjs/.cjs files, got: ${filePath}`);
  }

  const acorn = await import('acorn');
  const content = await readFile(filePath);
  const parsed = parseSelector(selector);

  let ast;
  try {
    ast = acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true });
  } catch (e) {
    throw new Error(`Parse error in ${filePath}: ${e.message}`);
  }

  const test = buildTest(parsed);
  const node = walkFind(ast, test);
  if (!node) {
    throw new Error(`No node matching selector "${selector}" found in ${filePath}`);
  }

  let result;
  if (action === 'rename') {
    if (!node.id) throw new Error('Node has no identifier to rename');
    const start = node.id.start;
    const end = node.id.end;
    result = content.substring(0, start) + newValue + content.substring(end);
  } else if (action === 'replace_body') {
    // Find the body node
    const body = node.body || (node.expression?.type === 'ArrowFunctionExpression' ? node.expression.body : null);
    if (!body) throw new Error('Node has no body to replace');
    // For block bodies, replace inside the braces
    if (body.type === 'BlockStatement') {
      result = content.substring(0, body.start + 1) + '\n' + newValue + '\n' + content.substring(body.end - 1);
    } else {
      result = content.substring(0, body.start) + newValue + content.substring(body.end);
    }
  } else {
    throw new Error(`Unknown action: "${action}". Supported: rename, replace_body`);
  }

  await writeFile(filePath, result);
  const oldBytes = content.length;
  return { path: filePath, action, selector, oldBytes, newBytes: result.length };
}

// Unified dispatch for dev.mjs tool loop
export async function executeTool(name, args) {
  if (name === 'ast_edit') {
    return astEdit(args.path, args.selector, args.action, args.newValue);
  }
  throw new Error(`Unknown tool: ${name}`);
}
