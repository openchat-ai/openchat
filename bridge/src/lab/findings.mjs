import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LAB_DIR = join(homedir(), '.openchat', 'lab');
const FINDINGS_FILE = join(LAB_DIR, 'findings.jsonl');

function ensureDir() {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
}

export function addFinding(project, type, desc, files = null) {
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
