// Memory tools for LLM agent — read/write TF-IDF vector memory
import { vectorMemory } from '../core/memory/vector-memory.js';

async function readMemory({ query, scope, limit = 5 }) {
  if (!query) return { error: 'query is required' };
  const results = vectorMemory.search(query, { scope, limit });
  return { memories: results.map(r => ({ content: r.value, score: r.score, source: r.source })) };
}

async function writeMemory({ text, scope, source = 'agent' }) {
  if (!text) return { error: 'text is required' };
  const id = vectorMemory.store({ text, metadata: { scope }, source });
  if (!id) return { error: 'failed to store (text empty or too long)' };
  return { ok: true, id };
}

async function getCwd() {
  return { cwd: process.cwd() };
}

export const TOOLS = [
  { type: 'function', function: { name: 'get_cwd', description: 'Get the current working directory path.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'read_memory', description: 'Search memory/knowledge base. Input: query string. Output: matching memories.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'search query' }, scope: { type: 'string', description: 'optional scope filter' }, limit: { type: 'number', description: 'max results', default: 5 } }, required: ['query'] } } },
  { type: 'function', function: { name: 'memory_store', description: 'Store text into memory for future recall. Input: text + optional scope.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'content to remember' }, scope: { type: 'string', description: 'optional scope tag' } }, required: ['text'] } } },
];

export async function executeTool(name, args) {
  switch (name) {
    case 'get_cwd': return await getCwd();
    case 'read_memory': return await readMemory(args);
    case 'memory_store': return await writeMemory(args);
    default: throw new Error(`memory-tools: unknown tool "${name}"`);
  }
}
