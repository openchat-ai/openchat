import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

function dir() {
  const h = process.env.HOME || process.env.USERPROFILE;
  return resolve(h || process.cwd(), '.openchat');
}

const FILE = () => resolve(dir(), 'agent-memory.json');

let _cache = null;

export async function load() {
  if (_cache) return _cache;
  try {
    const raw = await readFile(FILE(), 'utf8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    _cache = { facts: [], preferences: [], learnedPatterns: [], createdAt: Date.now(), updatedAt: Date.now() };
    return _cache;
  }
}

export async function save() {
  if (!_cache) return;
  _cache.updatedAt = Date.now();
  if (!existsSync(dir())) await mkdir(dir(), { recursive: true });
  await writeFile(FILE(), JSON.stringify(_cache, null, 2), 'utf8');
}

export async function addFact(fact) {
  const m = await load();
  m.facts.push({ text: fact, ts: Date.now() });
  if (m.facts.length > 100) m.facts.splice(0, m.facts.length - 100);
  await save();
  return m.facts.length;
}

export async function addPreference(key, value) {
  const m = await load();
  m.preferences = m.preferences.filter(p => p.key !== key);
  m.preferences.push({ key, value, ts: Date.now() });
  await save();
}

export async function addPattern(pattern) {
  const m = await load();
  m.learnedPatterns.push({ text: pattern, ts: Date.now(), count: 1 });
  await save();
}

export function summary() {
  if (!_cache) return '(not loaded)';
  return `${_cache.facts.length} facts, ${_cache.preferences.length} preferences, ${_cache.learnedPatterns.length} patterns`;
}

export const META = { id: 'agent-memory' };
