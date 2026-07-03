// tui/data.mjs — TUI 数据源：manifest 实验清单 + DNA 查询桥接
// === invariants ===
// - 只读数据，不改任何文件
// - loadExperiments 归一 id 为 string（manifest 里 id 有 string 也有 number）
// - LEVEL_ORDER 决定分组显示顺序，未知 level 落 '—'

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const EXP_DIR = resolve(__dirname, '..');

const LEVEL_ORDER = ['L4', 'L2+', 'L1.5', 'L1', 'L0', '—'];

export async function loadExperiments() {
  const raw = await readFile(resolve(EXP_DIR, 'manifest.json'), 'utf8');
  const m = JSON.parse(raw);
  return m.experiments.map((e) => ({
    id: String(e.id),
    name: e.name || String(e.id),
    file: e.file || '',
    level: e.intelligenceLevel || '—',
    status: e.status || 'closed-loop',
    deps: (e.deps || []).map(String),
    category: e.category || 'general',
    pure: !!e.pure,
    desc: e.description || '',
  }));
}

export function groupByLevel(exps) {
  const g = {};
  for (const e of exps) (g[e.level] ||= []).push(e);
  return LEVEL_ORDER.filter((l) => g[l]).map((l) => ({ level: l, items: g[l] }));
}

export function findDependents(exps, id) {
  return exps.filter((e) => e.deps.includes(id)).map((e) => e.id);
}

export async function dnaContext() {
  try {
    const { getDNAContext } = await import('../42.mjs');
    return await getDNAContext();
  } catch (e) {
    return `DNA 不可用: ${e.message}`;
  }
}

export async function dnaQuery(query) {
  try {
    const { answerFromDNA } = await import('../42.mjs');
    const r = await answerFromDNA(query);
    return r?.answer || '(无结果)';
  } catch (e) {
    return `DNA 查询失败: ${e.message}`;
  }
}
