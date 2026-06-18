/**
 * Resident IO — AI 居民持久化
 *
 * 底层文件读写，数据存储到 ~/.openchat/residents.json。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../monitoring/logger.js';

const DATA_FILE = path.join(os.homedir(), '.openchat', 'residents.json');

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return []; }
}

function writeAll(residents) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(residents, null, 2), 'utf8');
}

export { ensureFile, readAll, writeAll };
