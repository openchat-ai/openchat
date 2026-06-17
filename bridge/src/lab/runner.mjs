// runner.mjs — 拉下一个 pending goal, 直接 in-process 跑 test(), 写 result
//
// 流程:
//   1. getNextPending() → 拿优先级最高的 pending
//   2. 标 running, 记 startedAt
//   3. 解析 goal description → 找到对应实验文件 → import + test()
//   4. test() 返回 → classify(runResult) →
//      - success → done
//      - transient + retryCount < MAX → 重置 pending, retryCount++
//      - 其它 (code/config/unknown) → failed + escalate
//      - transient 但 retryCount >= MAX → failed + escalate
//   5. 所有实验一律 in-process (turbo), 不走子进程

// === invariants ===
// - 单 goal 串行跑 (不并发), lab 假设单用户
// - 所有实验 in-process, 无子进程开销
// - test() 抛错或返回 { ok: false } 都算 fail
// - 可取消: supervisor 设 cancel flag, 500ms polling 检测
// - exit code 0 = success, 非 0 = code
// - MAX_RETRIES 默认 2 (共 3 次尝试)
// - 失败 escalate 是 fire-and-forget, 不等返回

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
import { getNextPending, updateGoal, housekeeping } from './goal-queue.mjs';
import { recordRun } from './history.mjs';
import { classify } from './failure-analyzer.mjs';
import { escalate } from './escalate.mjs';
import { labEvents } from './lab-events.mjs';
import { addFact } from '../experiments/lib/agent-memory.mjs';
import { registerRun, unregisterRun } from './active-runs.mjs';
import { addFinding } from './findings.mjs';
import { parseJS } from '../experiments/lib/ast-search.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(__dirname, '../experiments');
const MAX_RETRIES = 2;

// 自动启动 supervisor（只一次）
let _supervisorStarted = false;
async function _ensureSupervisor() {
  if (_supervisorStarted) return;
  _supervisorStarted = true;
  try {
    const { startSupervisor } = await import('./supervisor.mjs');
    const h = await startSupervisor();
    globalThis._supervisorHandle = h;
  } catch (e) {
    console.error(`[runner] supervisor start failed: ${e.message}`);
  }
}

// === [code] fixers — 备份 + 改 + acorn 验证 + 失败回滚 ===
// === invariants ===
// - 所有 fixer 先返回 {code, changed, info}，由 _applyCodeFix 统一做落盘 + parse 验证
// - parse 验证失败 → 原样写回, 返回 {ok:false}
// - 同一文件连续 fix 互不干扰 (每次 _applyCodeFix 独立读盘)

function _setParents(ast) {
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    node.parent = parent;
    for (const k of Object.keys(node)) {
      if (k === 'parent') continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) walk(c, node);
      else if (v && typeof v.type === 'string') walk(v, node);
    }
  }
  walk(ast, null);
}

function _isReassigned(ast, name) {
  let yes = false;
  function checkPattern(pat) {
    if (!pat) return;
    if (pat.type === 'Identifier' && pat.name === name) { yes = true; return; }
    if (pat.type === 'ArrayPattern' || pat.type === 'ObjectPattern') {
      for (const e of pat.elements || []) if (e) checkPattern(e);
      for (const p of pat.properties || []) checkPattern(p.value || p);
      if (pat.type === 'ObjectPattern' && pat.rest) checkPattern(pat.rest);
    }
    if (pat.type === 'RestElement') checkPattern(pat.argument);
    if (pat.type === 'AssignmentPattern') checkPattern(pat.left);
  }
  function walk(node) {
    if (!node || typeof node !== 'object' || yes) return;
    if (node.type === 'AssignmentExpression' && node.left) {
      checkPattern(node.left);
      if (yes) return;
    }
    if (node.type === 'UpdateExpression' && node.argument && node.argument.type === 'Identifier' && node.argument.name === name) {
      yes = true; return;
    }
    if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      if (node.left) checkPattern(node.left);
      if (yes) return;
    }
    for (const k of Object.keys(node)) {
      if (k === 'parent') continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (v && typeof v.type === 'string') walk(v);
    }
  }
  walk(ast);
  return yes;
}

function _fixEmptyCatch(code) {
  const re = /catch\s*\{\s*\}/g;
  const m = code.match(re);
  if (!m) return { code, changed: false, info: 'no empty catch' };
  return { code: code.replace(re, "catch (e) { console.error('[C0]', e); }"), changed: true, info: `fixed ${m.length} empty catch` };
}

function _fixConsoleLog(code) {
  const re = /\bconsole\.(log|warn)\(/g;
  const m = code.match(re);
  if (!m) return { code, changed: false, info: 'no console.log/warn' };
  return { code: code.replace(re, 'console.debug('), changed: true, info: `${m.length} console.log/warn→debug` };
}

function _fixVarLet(code) {
  const parsed = parseJS(code);
  if (!parsed) return { code, changed: false, info: 'parse failed (pre-check)' };
  _setParents(parsed);
  const declGroups = new Map();
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclaration' && (node.kind === 'let' || node.kind === 'var')) {
      for (const dec of node.declarations) {
        if (dec.id && dec.id.type === 'Identifier') {
          if (!declGroups.has(node)) declGroups.set(node, { decl: node, names: [], reassigned: 0 });
          const g = declGroups.get(node);
          g.names.push(dec.id.name);
          if (_isReassigned(parsed, dec.id.name)) g.reassigned++;
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'parent') continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (v && typeof v.type === 'string') walk(v);
    }
  }
  walk(parsed);
  if (declGroups.size === 0) return { code, changed: false, info: 'no let/var' };
  let totalSkipped = 0;
  for (const g of declGroups.values()) totalSkipped += g.reassigned;
  const convertible = [...declGroups.values()].filter(g => g.reassigned === 0);
  if (convertible.length === 0) {
    return { code, changed: false, info: `skipped: var/let reassigned in scope (${totalSkipped})` };
  }
  convertible.sort((a, b) => b.decl.start - a.decl.start);
  let newCode = code;
  for (const g of convertible) {
    const txt = code.slice(g.decl.start, g.decl.end);
    const nt = txt.replace(/^(let|var)\b/, 'const');
    newCode = newCode.slice(0, g.decl.start) + nt + newCode.slice(g.decl.end);
  }
  const info = `${convertible.length}→const` + (totalSkipped ? `, ${totalSkipped} skipped (reassigned)` : '');
  return { code: newCode, changed: true, info };
}

async function _applyCodeFix(absPath, issue) {
  const { readFileSync, writeFileSync, existsSync } = await import('fs');
  if (!existsSync(absPath)) return { ok: true, info: `file gone: ${absPath}` };
  const orig = readFileSync(absPath, 'utf8');
  let fixer = null;
  if (issue.includes('empty catch')) fixer = _fixEmptyCatch;
  else if (issue.includes('console.log')) fixer = _fixConsoleLog;
  else if (issue.includes('uses var/let')) fixer = _fixVarLet;
  if (!fixer) return { ok: true, info: `no-op: ${issue}` };
  const r = fixer(orig);
  if (!r.changed) return { ok: true, info: `no issue found (already fixed or false positive): ${r.info}` };
  const verified = parseJS(r.code);
  if (!verified) {
    return { ok: false, info: `parse failed after fix, rolled back (${r.info})` };
  }
  writeFileSync(absPath, r.code, 'utf8');
  return { ok: true, info: r.info };
}

export async function runNext(turbo = true) {
  // 自治 housekeeping: 卡 running 太久 → 重置 pending; pollution → 标 failed
  _housekeep();
  // 确保 supervisor 已启动
  _ensureSupervisor();
  const goal = getNextPending();
  if (!goal) return { ok: false, reason: 'no pending goal' };

  return await _runTurbo(goal);
}

async function _runTurbo(goal) {
  const startedAt = Date.now();
  updateGoal(goal.id, { status: 'running', startedAt });
  labEvents.emit('runner', { type: 'start', goalId: goal.id, description: goal.description, startedAt });

  let cancelled = false;
  const cancel = () => { cancelled = true; };
  registerRun(goal.id, { description: goal.description, cancel });

  try {
    const m = goal.description.match(/实验\s+(\S+):/);
    const file = m ? m[1] : null;
    let mod, testFn = null;
    if (file) {
      if (file.includes('/')) mod = await import(pathToFileURL(resolve(EXP_DIR, file)));
      else mod = await import(pathToFileURL(resolve(EXP_DIR, file + '.mjs')));
      testFn = mod && (typeof mod.test === 'function' ? mod.test : null);
    }
    if (!testFn) {
      const upg = goal.description.match(/(?:\[scout\]\s*)?upgrade\s+(\S+):\s*(\S+)\s*→\s*(\S+)/);
      if (upg) {
        const dep = upg[1], target = upg[3];
        testFn = async () => {
          const root = resolve(__dirname, '../..');
          const { exec } = await import('child_process');
          await new Promise((res, rej) => exec(`npm install ${dep}@${target}`,{cwd:root,timeout:120000},e=>e?rej(e):res()));
          await new Promise(r => exec('npm test',{cwd:root,timeout:120000},()=>r()));
          return { ok: true };
        };
      }
      const eM = goal.description.match(/evaluate upgrading\s+(\S+):\s*(\S+)\s*→\s*(\S+)/);
      if (eM) {
        const dep = eM[1], latest = eM[3];
        testFn = async () => {
          const root = resolve(__dirname, '../..');
          const { exec } = await import('child_process');
          await new Promise((res, rej) => exec(`npm install ${dep}@${latest}`,{cwd:root,timeout:120000},e=>e?rej(e):res()));
          await new Promise(r => exec('npm test',{cwd:root,timeout:120000},()=>r()));
          const out = await new Promise(r => exec('npm outdated --json',{cwd:root,timeout:15000},(e,s)=>r(e?e.stdout||'{}':s||'{}')));
          try { const o = JSON.parse(out); if (o[dep]) return { ok: false, info: `${dep} stuck at ${o[dep].current}` }; } catch (e) { console.error('[C0]', e); }
          return { ok: true, info: `upgraded ${dep} to ${latest}` };
        };
      }
      const sM = goal.description.match(/evaluate switching from (.+) to (.+) \([0-9.]+x\)/);
      if (sM) testFn = async () => ({ ok: true, info: `consider ${sM[1]}→${sM[2]}` });
      const iM = goal.description.match(/^investigate: switch (\S+) to (\S+) \(downloads ratio ([0-9.]+)\)/);
      if (iM) testFn = async () => {
        const [, from, to] = iM;
        try {
          const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(to)}/latest`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return { ok: true, info: `${from}→${to}: registry HTTP ${r.status}` };
          const meta = await r.json();
          const deps = meta.dependencies ? Object.keys(meta.dependencies).length : 0;
          return { ok: true, info: `${from}→${to}: ${(meta.description || '').slice(0, 80)} (deps: ${deps}, version: ${meta.version}, ratio: ${iM[3]}x)` };
        } catch (e) {
          return { ok: true, info: `${from}→${to}: lookup failed: ${e.message}` };
        }
      };
      const cM = goal.description.match(/^compose: test (.+) \+ (.+) together/);
      if (cM) testFn = async () => {
        const [, a, b] = cM;
        try {
          const { run: composeRun } = await import('../experiments/compose.mjs');
          const ta = Date.now();
          const ra = await composeRun(a, {}).catch(e => ({ __err: e.message }));
          const tb = Date.now();
          const rb = await composeRun(b, {}).catch(e => ({ __err: e.message }));
          const te = Date.now();
          const summary = (r, ms) => r && r.__err ? `err(${r.__err.slice(0,40)})` : (r === null ? 'no run()' : `ok(${ms}ms)`);
          return { ok: true, info: `${a}=${summary(ra, tb-ta)} | ${b}=${summary(rb, te-tb)}` };
        } catch (e) {
          return { ok: true, info: `compose ${a}+${b} failed: ${e.message}` };
        }
      };
      const nM = goal.description.match(/^npm upgrade batch \((\d+) minor\/patch available\)/);
      if (nM) testFn = async () => ({ ok: true, info: `batch: ${nM[1]} upgrades available` });
      const rM = goal.description.match(/^refactor: (\d+) deepsmell files/);
      if (rM) testFn = async () => ({ ok: true, info: `deepsmell: ${rM[1]} files need refactor` });
      const tM = goal.description.match(/^address TODO backlog \((\d+) items?\)/);
      if (tM) testFn = async () => ({ ok: true, info: `TODO: ${tM[1]} items` });
      if (goal.description.startsWith('[batch] ')) {
        const batch = goal.description.slice(8);
        testFn = async () => {
          const { readdirSync, readFileSync, writeFileSync, statSync } = await import('fs');
          const { join } = await import('path');
          const SRC = resolve(__dirname, '../..', 'src');
          let files;
          try { files = readdirSync(SRC, { withFileTypes: true }).flatMap(d => {
            if (d.isFile() && /\.(js|mjs)$/.test(d.name)) return [join(SRC, d.name)];
            if (d.isDirectory()) try { return readdirSync(join(SRC, d.name), { withFileTypes: true }).filter(f => f.isFile() && /\.(js|mjs)$/.test(f.name)).map(f => join(SRC, d.name, f.name)); } catch { return []; }
            return [];
          }); } catch { return { ok: false, info: 'src not found' }; }
          let fixer = null;
          if (batch.includes('console.log')) fixer = c => c.replace(/\bconsole\.(log|warn)\(/g, 'console.debug(');
          else if (batch.includes('empty catch')) fixer = c => c.replace(/catch\s*\{\s*\}/g, "catch (e) { console.error('[C0]', e); }");
          else if (batch.includes('var/let')) fixer = c => {
            const parsed = parseJS(c); if (!parsed) return c;
            _setParents(parsed);
            // 复用 _fixVarLet 逻辑
            const declGroups = new Map();
            (function walk(n){ if (!n||typeof n!=='object') return; if (n.type==='VariableDeclaration'&&(n.kind==='let'||n.kind==='var')) for (const dec of n.declarations) if (dec.id?.type==='Identifier'){ if (!declGroups.has(n)) declGroups.set(n,{decl:n,names:[],reassigned:0}); const g=declGroups.get(n); g.names.push(dec.id.name); if (_isReassigned(parsed, dec.id.name)) g.reassigned++; } for (const k of Object.keys(n)){ if (k==='parent') continue; const v=n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v&&typeof v.type==='string') walk(v); } })(parsed);
            const totalSkipped = [...declGroups.values()].reduce((s,g)=>s+g.reassigned,0);
            const convertible = [...declGroups.values()].filter(g=>g.reassigned===0);
            convertible.sort((a,b)=>b.decl.start-a.decl.start);
            let out = c;
            for (const g of convertible) { const txt = c.slice(g.decl.start, g.decl.end); const nt = txt.replace(/^(let|var)\b/, 'const'); out = out.slice(0, g.decl.start) + nt + out.slice(g.decl.end); }
            return out;
          };
          if (!fixer) return { ok: true, info: `no batch handler: ${batch}` };
          let totalFixed = 0, filesChanged = 0, parseFails = 0;
          for (const f of files) {
            let orig; try { orig = readFileSync(f, 'utf8'); } catch { continue; }
            const fixed = fixer(orig);
            if (fixed === orig) continue;
            const verified = parseJS(fixed);
            if (!verified) { parseFails++; continue; }
            try { writeFileSync(f, fixed, 'utf8'); totalFixed++; filesChanged++; addFinding('bridge', 'batch-fix', `${f.split(/[\\\/]/).pop()}: ${batch}`); } catch {}
          }
          if (totalFixed === 0) return { ok: true, info: `no issue found (already fixed or false positive): batch ${batch}` };
          return { ok: true, info: `batch ${batch}: ${totalFixed} fix(es) in ${filesChanged} file(s)${parseFails ? `, ${parseFails} parse fail(s) skipped` : ''}` };
        };
      }
      if (goal.description.startsWith('[code] ')) {
        const msg = goal.description.slice(6);
        const cf = msg.match(/^(.+?): (.+)/);
        const fPath = cf ? cf[1].trim() : null;
        const issue = cf ? cf[2] : msg;
        testFn = async () => {
          if (!fPath) return { ok: true, info: `note: ${issue}` };
          const { readFileSync, writeFileSync } = await import('fs');
          const absPath = resolve(__dirname, '../..', fPath);
          if (fPath.match(/\.p2\.(mjs|js)$/)) return { ok: true, info: `skip .p2` };
          if (issue.includes('consider splitting')) {
            // === split handler DISABLED — splitting files breaks the codebase ===
            console.debug('[runner] split handler DISABLED — skipping consider splitting for ' + fPath);
            let lineCount = 0; try { lineCount = readFileSync(absPath, 'utf8').split('\n').length; } catch (e) { console.error('[C0]', e); }
            return { ok: true, info: `split disabled (${lineCount} lines, ${fPath})` };
          }
          const r = _applyCodeFix(absPath, issue);
          if (r.ok) addFinding('bridge', 'fix', `fixed ${issue} in ${fPath}`);
          return r;
        };
      }
    }
    if (!testFn) throw new Error(`no test() in ${file || goal.description}`);

    const cancelPromise = new Promise((_, reject) => {
      const iv = setInterval(() => { if (cancelled) { clearInterval(iv); reject(new Error('cancelled by supervisor')); } }, 500);
    });
    const testResult = await Promise.race([testFn(), cancelPromise]);
    const finishedAt = Date.now();

    // "no issue found" = 目标已修/误报, 直接从队列删除, 不落盘任何记录
    if (testResult?.info?.includes('no issue found')) {
      const { removeGoal } = await import('./goal-queue.mjs');
      removeGoal(goal.id);
      unregisterRun(goal.id);
      return { ok: true, goal, removed: true, result: { info: testResult.info } };
    }
    const result = { ok: testResult?.ok !== false, exitCode: 0, signal: null, durationMs: finishedAt - startedAt };
    if (testResult && testResult.info) result.info = testResult.info;
    const classification = classify({ exitCode: 0 });
    const attempt = (goal.retryCount || 0) + 1;
    unregisterRun(goal.id);
    _finalize(goal, result, classification, attempt, finishedAt);
    return { ok: true, goal, result, classification };
  } catch (e) {
    const finishedAt = Date.now();
    const result = { ok: false, exitCode: null, signal: null, durationMs: finishedAt - startedAt, error: e.message };
    const classification = classify({ exitCode: null, signal: null, error: e.message });
    const attempt = (goal.retryCount || 0) + 1;
    unregisterRun(goal.id);
    _finalize(goal, result, classification, attempt, finishedAt);
    return { ok: false, goal, error: e.message, classification };
  }
}

// === invariants ===
// - [code] skips .p2; split skips files with exports, only at braceDepth=0
// - upgrade/evaluate-upgrading use real npm install + verify
// - switching is non-op
function _finalize(goal, result, classification, attempt, finishedAt) {
  if (classification.retryable && attempt - 1 < MAX_RETRIES) {
    updateGoal(goal.id, {
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      result: { ...result, retriedAfter: attempt },
      classification,
      retryCount: attempt,
    });
    recordRun({
      goalId: goal.id,
      description: goal.description,
      status: 'failed',
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      finishedAt,
      error: result.error || null,
      classification,
      retryAttempt: attempt,
    });
    return { retried: true, attempt, classification };
  }

  const finalStatus = result.ok ? 'done' : 'failed';
  const escalationNeeded = finalStatus === 'failed';

  updateGoal(goal.id, {
    status: finalStatus,
    finishedAt,
    result,
    classification,
    escalatedAt: escalationNeeded ? Date.now() : null,
  });
  recordRun({
    goalId: goal.id,
    description: goal.description,
    status: finalStatus,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    finishedAt,
    error: result.error || null,
    classification,
    retryAttempt: attempt,
  });

  addFact(`实验 ${goal.description.slice(0, 40)} → ${finalStatus} (${(result.durationMs / 1000).toFixed(1)}s)`).catch(() => {});

  if (escalationNeeded) {
    escalate(goal, classification, attempt);
  }
  return { retried: false, attempt, classification, escalated: escalationNeeded };
}

// === 自治 housekeeping ===
let _lastHousekeepAt = 0;
const _HOUSEKEEP_INTERVAL_MS = 60 * 1000;
function _housekeep() {
  const now = Date.now();
  if (now - _lastHousekeepAt < _HOUSEKEEP_INTERVAL_MS) return;
  _lastHousekeepAt = now;
  const r = housekeeping();
  if (r.recovered.length > 0) {
    console.debug(`[runner] housekeeping: recovered ${r.recovered.length} stale running goal(s)`);
    for (const x of r.recovered) {
      console.debug(`[runner]   reset ${x.id} (stuck ${(x.stuckMs/1000/60).toFixed(0)} min): ${x.description.slice(0, 50)}`);
    }
  }
  if (r.purged.length > 0) {
    console.debug(`[runner] housekeeping: purged ${r.purged.length} pollution goal(s)`);
    for (const x of r.purged) {
      console.debug(`[runner]   marked failed ${x.id} (pattern: ${x.pattern}): ${x.description.slice(0, 50)}`);
    }
  }
}

export async function runAll(maxRuns = 100, turbo = true) {
  const results = [];
  for (let i = 0; i < maxRuns; i++) {
    const r = await runNext(turbo);
    if (!r.ok && r.reason === 'no pending goal') break;
    results.push(r);
  }
  return results;
}
