// Experiment: memory — 轻量级向量存储 + 混合检索
// Manifest id: memory
// I/O: 见各 op
//
// 包装 src/memory/vector-store.js（零外部依赖，JSON 文件持久化）
// 提供向量相似度搜索、关键词搜索、混合检索

export const META = {
  id: 'memory',
  name: 'Vector Store — 轻量级向量存储 + 混合检索',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'init | store | search | similarity_search | keyword_search | hybrid_search | stats' },
    { name: 'id', type: 'string', required: false, description: '向量条目 id' },
    { name: 'embedding', type: 'array', required: false, description: '向量数组' },
    { name: 'content', type: 'string', required: false, description: '关联文本' },
    { name: 'metadata', type: 'object', required: false, description: '附加元数据' },
    { name: 'query', type: 'string', required: false, description: '关键词查询' },
    { name: 'topK', type: 'number', required: false, default: 10 },
    { name: 'type', type: 'string', required: false },
  ],
  outputs: [
    { name: 'results', type: 'array' },
    { name: 'stats', type: 'object' },
    { name: 'ok', type: 'boolean' },
  ],
  deps: [],
  tags: ['memory', 'vector', 'embedding', 'search'],
};

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('memory.run: op required');
  const { VectorStore } = await import('../memory/vector-store.js');
  const store = new VectorStore();

  switch (op) {
    case 'init':
      await store.initialize();
      return { outputs: { ok: true } };

    case 'store': {
      if (!args.id || !args.embedding) throw new Error('id and embedding required');
      await store.initialize();
      await store.addVector({ id: args.id, embedding: args.embedding, content: args.content, metadata: args.metadata, type: args.type });
      return { outputs: { ok: true, id: args.id } };
    }

    case 'similarity_search': {
      if (!args.embedding) throw new Error('embedding required');
      await store.initialize();
      const results = store.similaritySearch(args.embedding, { topK: args.topK || 10, type: args.type });
      return { outputs: { results } };
    }

    case 'keyword_search': {
      if (!args.query) throw new Error('query required');
      await store.initialize();
      const results = store.keywordSearch(args.query, { topK: args.topK || 10, type: args.type });
      return { outputs: { results } };
    }

    case 'hybrid_search': {
      if (!args.query || !args.embedding) throw new Error('query and embedding required');
      await store.initialize();
      const kw = store.keywordSearch(args.query, { topK: args.topK * 2 || 20, type: args.type });
      const vs = store.similaritySearch(args.embedding, { topK: args.topK * 2 || 20, type: args.type });
      const seen = new Set();
      const merged = [...vs, ...kw].filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      merged.sort((a, b) => b.score - a.score);
      return { outputs: { results: merged.slice(0, args.topK || 10) } };
    }

    case 'stats': {
      await store.initialize();
      const s = await store.getStats();
      return { outputs: { stats: s } };
    }

    default:
      throw new Error(`memory.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Memory — 轻量级向量存储';

async function test() {
  const { VectorStore } = await import('../memory/vector-store.js');
  const store = new VectorStore();
  await store.initialize();
  await store.clear();

  await store.addVector({ id: 't1', embedding: [1, 2, 3], content: 'hello world', metadata: { type: 'test' } });
  await store.addVector({ id: 't2', embedding: [4, 5, 6], content: 'goodbye', metadata: { type: 'test' } });

  const sim = await store.similaritySearch([1, 2, 3], { topK: 5 });
  const simHasT1 = sim.some(r => r.id === 't1');
  if (simHasT1) ok('similaritySearch: t1 in top results');
  else ng(`similaritySearch: t1 not in ${JSON.stringify(sim.map(r => r.id))}`);

  const kw = await store.keywordSearch('hello', { topK: 5 });
  const kwHasT1 = kw.some(r => r.id === 't1');
  if (kwHasT1) ok('keywordSearch: found hello');
  else ng(`keywordSearch: hello not in ${JSON.stringify(kw.map(r => ({id:r.id,content:r.content})))}`);

  const stats = await store.getStats();
  if (stats.totalCount >= 2) ok(`stats: ${stats.totalCount} entries`);
  else ng(`stats: expected >=2, got ${JSON.stringify(stats)}`);

  await store.clear();
  report(NAME);
}

export { test };
