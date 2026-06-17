import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const LAB_DIR = join(homedir(), '.openchat', 'lab');
const FINDINGS_FILE = join(LAB_DIR, 'findings.jsonl');

const _seenKeys = new Set();

function ensureDir() {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
}

function _key(type, desc, files) {
  const filesKey = Array.isArray(files) ? files.join('|') : (files || '');
  return createHash('sha256').update(`${type}|${desc}|${filesKey}`).digest('hex').slice(0, 16);
}

export function addFinding(project, type, desc, files = null) {
  const k = _key(type, desc, files);
  if (_seenKeys.has(k)) return null;
  _seenKeys.add(k);
  ensureDir();
  const entry = { ts: Date.now(), project, type, desc };
  if (files) entry.files = files;
  const line = JSON.stringify(entry) + '\n';
  try {
    writeFileSync(FINDINGS_FILE, line, { flag: 'as+', encoding: 'utf8' });
  } catch {
    const existing = existsSync(FINDINGS_FILE) ? readFileSync(FINDINGS_FILE, 'utf8') : '';
    writeFileSync(FINDINGS_FILE, existing + line, 'utf8');
  }
  return entry;
}

export function _resetDedup() { _seenKeys.clear(); }
