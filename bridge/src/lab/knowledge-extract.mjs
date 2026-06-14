import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function home() {
  const h = process.env.HOME || process.env.USERPROFILE;
  return h || resolve(__dirname, '../../');
}

const MEMORY_DIR = resolve(home(), '.openchat');
const MEMORY_PATH = resolve(MEMORY_DIR, 'MEMORY.md');

function parseExperimentLabel(description) {
  const m = description.match(/实验\s+(\S+):\s+(.+)/);
  return m ? { file: m[1], name: m[2] } : { file: '?', name: description.slice(0, 60) };
}

export async function extract(runs) {
  if (!runs || runs.length === 0) return { ok: true, wrote: false };
  const pass = runs.filter(r => r.result?.ok);
  const fail = runs.filter(r => !r.result?.ok);
  const lines = [];
  lines.push('');
  lines.push('---');
  lines.push(`## 实验知识 (自动萃取 ${new Date().toISOString().slice(0, 10)})`);
  lines.push('');
  lines.push(`> ${runs.length} 实验 · ${pass.length} pass · ${fail.length} fail`);
  lines.push('');
  if (pass.length > 0) {
    lines.push('### ✅ 通过实验');
    for (const r of pass) {
      const { name } = parseExperimentLabel(r.goal.description);
      lines.push(`- ${name}`);
    }
  }
  if (fail.length > 0) {
    lines.push('');
    lines.push('### ❌ 失败实验');
    for (const r of fail) {
      const { name } = parseExperimentLabel(r.goal.description);
      const err = r.result?.error || '';
      lines.push(`- ${name} — ${err.slice(0, 80)}`);
    }
  }
  lines.push('');
  const knowledgeBlock = lines.join('\n');
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
  let existing = '';
  try { existing = await readFile(MEMORY_PATH, 'utf8'); } catch { existing = ''; }
  const updated = existing + knowledgeBlock;
  await writeFile(MEMORY_PATH, updated, 'utf8');
  return { ok: true, wrote: true, path: MEMORY_PATH, linesAdded: lines.length };
}

export const META = { id: 'knowledge-extract' };
