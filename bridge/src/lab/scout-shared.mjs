import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { resolve, join, extname, relative } from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';

// === invariants ===
// - 所有异步操作使用 await 或 Promise.all 串联
// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms
// - HTTP 调用使用 AbortSignal.timeout 超时保护
// - try/catch 覆盖所有外部 IO 调用
// - 所有网络请求有 explicit timeout
// - 事件发射使用 fire-and-forget，不阻塞调用方

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '../..');
export const SRC_DIR = join(PROJECT_ROOT, 'src');
export const EXP_DIR = join(SRC_DIR, 'experiments');
export const LAB_DIR = join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'lab');
export const PROJECTS_FILE = join(LAB_DIR, 'projects.json');
export const MANIFEST_FILE = join(EXP_DIR, 'manifest.json');
export const PERSISTENT_CONFIG = join(SRC_DIR, 'core/persistent-config.js');
export const DEDUP_FILE = join(LAB_DIR, 'self-mod-dedup.json');

export const CONCURRENCY = 20;
export const MIN_PENDING = 10;
export const FETCH_TIMEOUT = 5000;

export function loadDedup() {
  try { return JSON.parse(readFileSync(DEDUP_FILE, 'utf8')); } catch { return {}; }
}

export function saveDedup(d) {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
  writeFileSync(DEDUP_FILE, JSON.stringify(d, null, 2), 'utf8');
}

export function isProcessed(key) {
  return !!loadDedup()[key];
}

export function markProcessed(key, info) {
  const d = loadDedup();
  d[key] = { at: Date.now(), info };
  saveDedup(d);
}

export function safeAtomicWrite(targetPath, newContent) {
  const tmpPath = targetPath + '.new.mjs';
  writeFileSync(tmpPath, newContent, 'utf8');
  const cp = fork(tmpPath, [], { execArgv: ['--check'], stdio: 'pipe', silent: true });
  return new Promise((resolve, reject) => {
    cp.on('exit', (code) => {
      if (code === 0) {
        renameSync(tmpPath, targetPath);
        resolve(true);
      } else {
        try { unlinkSync(tmpPath); } catch {}
        reject(new Error(`syntax check failed (code ${code})`));
      }
    });
    cp.on('error', (err) => {
      try { unlinkSync(tmpPath); } catch {}
      reject(err);
    });
  });
}

export function readProjects() {
  try { return JSON.parse(readFileSync(PROJECTS_FILE, 'utf8')); } catch { return []; }
}

export function relPath(abs) {
  return relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

export function scanDir(dir, results = [], maxDepth = 10, depth = 0) {
  if (depth > maxDepth) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) scanDir(full, results, maxDepth, depth + 1);
      else if (['.js', '.mjs', '.cjs'].includes(extname(e.name))) results.push(full);
    }
  } catch {}
  return results;
}

export async function mapLimit(items, limit, fn) {
  if (items.length === 0) return [];
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx]); } catch {}
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
