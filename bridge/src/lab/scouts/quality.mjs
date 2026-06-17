import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { addGoal } from '../goal-queue.mjs';
import { addFinding } from '../findings.mjs';
import { parseJS } from '../../experiments/lib/ast-search.mjs';
import { SRC_DIR, EXP_DIR, MANIFEST_FILE, PERSISTENT_CONFIG, scanDir, relPath } from '../scout-shared.mjs';

// === invariants ===
// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms
// - AST 操作仅在验证阶段执行，不影响运行时路径
// - try/catch 覆盖所有外部 IO 调用

export function scanForLeftoverP2() {
  const files = scanDir(SRC_DIR);
  const re = /from\s+['"][^'"]*\.p2\.[^'"]*['"]/g;
  let count = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const m = content.match(re);
      if (m && m.length > 0) {
        count += m.length;
        addFinding('bridge', 'p1', `${relPath(f)}: ${m.length} leftover .p2. import(s)`);
        addGoal(`remove leftover .p2. import in ${relPath(f)}`, { priority: 1 });
      }
    } catch {}
  }
  return count;
}

export function scanForSyntaxErrors() {
  const files = scanDir(SRC_DIR);
  let count = 0;
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const r = parseJS(content);
      if (!r) {
        count++;
        addFinding('bridge', 'p2', `${relPath(f)}: parse failed`);
        addGoal(`fix syntax error in ${relPath(f)}`, { priority: 2 });
      }
    } catch (e) {
      count++;
      const msg = (e?.message || String(e)).split('\n')[0].slice(0, 120);
      addFinding('bridge', 'p2', `${relPath(f)}: ${msg}`);
      addGoal(`fix syntax error in ${relPath(f)}`, { priority: 2 });
    }
  }
  return count;
}

export function scanTestCoverage() {
  if (!existsSync(MANIFEST_FILE)) return 0;
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')); } catch { return 0; }
  const exps = (manifest.experiments || []).filter(e => e.status === 'closed-loop');
  let count = 0;
  for (const e of exps) {
    const file = join(EXP_DIR, e.file);
    if (!existsSync(file)) {
      count++;
      addFinding('bridge', 'testCoverage', `${e.id}: file ${e.file} missing (closed-loop)`);
      addGoal(`write test() for ${e.id} (file missing)`, { priority: 2 });
      continue;
    }
    try {
      const content = readFileSync(file, 'utf8');
      const hasTest = /(?:async\s+)?function\s+test\s*\(/.test(content)
        || /^\s*test\s*[=:]/m.test(content)
        || /export\s+(?:async\s+)?function\s+test\b/.test(content);
      if (!hasTest) {
        count++;
        addFinding('bridge', 'testCoverage', `${e.id}: no test() in ${e.file} (closed-loop)`);
        addGoal(`write test() for ${e.id}`, { priority: 2 });
      }
    } catch {}
  }
  return count;
}

export function scanDepsParity() {
  const candidates = ['F:/openliems', 'F:/openhxcc', 'F:/openchat-flutter/lib'];
  const ourModules = new Set();
  try {
    for (const f of scanDir(join(SRC_DIR, 'core'))) {
      const name = f.split(/[\\/]/).pop().replace(/\.(js|mjs|cjs)$/, '');
      if (name && !name.startsWith('_') && !name.includes('.spec.') && !name.includes('.json')) {
        ourModules.add(name);
      }
    }
  } catch {}
  const refCount = {};
  for (const proj of candidates) {
    if (!existsSync(proj)) continue;
    try {
      const files = scanDir(proj, [], 3);
      for (const f of files) {
        try {
          const txt = readFileSync(f, 'utf8');
          const importRe = /from\s+['"](?:\.\.?\/|\.\.?\/.*?\/)([a-zA-Z_$][\w$-]*)(?:\.[a-z]+)?['"]/g;
          let m;
          while ((m = importRe.exec(txt)) !== null) {
            const name = m[1];
            if (ourModules.has(name)) continue;
            if (name.startsWith('_')) continue;
            refCount[name] = refCount[name] || { sources: new Set(), total: 0 };
            refCount[name].sources.add(proj);
            refCount[name].total++;
          }
        } catch {}
      }
    } catch {}
  }
  let gaps = 0;
  const flagged = [];
  for (const [name, info] of Object.entries(refCount)) {
    if (info.total >= 3) {
      gaps++;
      const srcNames = Array.from(info.sources).map(s => s.split(/[\\/]/).pop()).join(',');
      addFinding('bridge', 'depsParity', `${name} (imported ${info.total}x across ${srcNames})`);
      flagged.push(name);
    }
  }
  flagged.slice(0, 10).forEach((name) => {
    addGoal(`adopt: ${name} (referenced ${refCount[name].total}x in other projects)`, { priority: 3 });
  });
  return gaps;
}

export function scanConfigSchema() {
  if (!existsSync(PERSISTENT_CONFIG)) return 0;
  let content;
  try { content = readFileSync(PERSISTENT_CONFIG, 'utf8'); } catch { return 0; }
  const defMatch = content.match(/DEFAULT_CONFIG\s*=\s*\{([\s\S]*?)\n\}/);
  if (!defMatch) return 0;
  const block = defMatch[1];
  const keyRe = /^\s{2,4}([a-zA-Z_$][\w$]*)\s*:/gm;
  const keys = new Set();
  let m;
  while ((m = keyRe.exec(block)) !== null) {
    if (!['if', 'for', 'return', 'const', 'let', 'var', 'function', 'export', 'import', 'while'].includes(m[1])) {
      keys.add(m[1]);
    }
  }
  const hasSchema = /\b(joi|Joi|ajv|Ajv|zod|Zod)\s*\.\s*(object|Object)\s*\(/.test(content)
    || /validate\s*\(/.test(content)
    || /schema\s*[:=]/i.test(content);
  if (!hasSchema) {
    const n = keys.size;
    if (n > 0) {
      addFinding('bridge', 'configSchema', `persistent-config.js: no schema validator, ${n} keys unvalidated`);
      addGoal(`add schema (joi/ajv) for persistent-config.js (${n} keys)`, { priority: 2 });
    }
    return n;
  }
  const schemaBlock = content.match(/Joi\s*\.\s*object\s*\(\s*\{([\s\S]*?)\}/i);
  if (schemaBlock) {
    const covered = new Set();
    const re = /([a-zA-Z_$][\w$]*)\s*:\s*Joi\./g;
    let mm;
    while ((mm = re.exec(schemaBlock[1])) !== null) covered.add(mm[1]);
    let missing = 0;
    for (const k of keys) {
      if (!covered.has(k)) {
        missing++;
        addFinding('bridge', 'configSchema', `${k}: not in schema`);
      }
    }
    if (missing > 0) {
      addGoal(`extend schema to cover ${missing} config key(s)`, { priority: 2 });
    }
    return missing;
  }
  return 0;
}
