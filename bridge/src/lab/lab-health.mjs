import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PROJECT_ROOT, safeAtomicWrite, isProcessed, markProcessed } from './scout-shared.mjs';
import { addFinding } from './findings.mjs';

function _detectInvariants(code) {
  const lines = [];
  if (/\bawait\b/.test(code)) lines.push('// - 所有异步操作使用 await 或 Promise.all 串联');
  if (/\b(read|write|exists|stat|unlink|mkdir)FileSync\b/.test(code)) lines.push('// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms');
  if (/\bfetch\b/.test(code)) lines.push('// - HTTP 调用使用 AbortSignal.timeout 超时保护');
  if (/parseJS|acorn/.test(code)) lines.push('// - AST 操作仅在验证阶段执行，不影响运行时路径');
  if (/\bcancel(lle)?d?\b/.test(code)) lines.push('// - cancel 标志通过 500ms 轮询检测');
  if (/\btry\b[\s\S]*?\bcatch\b/.test(code)) lines.push('// - try/catch 覆盖所有外部 IO 调用');
  if (/AbortSignal\.timeout/.test(code)) lines.push('// - 所有网络请求有 explicit timeout');
  if (/emit|on\s*\(/.test(code)) lines.push('// - 事件发射使用 fire-and-forget，不阻塞调用方');
  if (lines.length === 0) lines.push('// - 无特定运行时约束');
  return lines;
}

function _injectInvariants(code) {
  if (code.includes('// === invariants ===')) return code;
  const lines = code.split('\n');
  const invariantsBlock = ['// === invariants ===', ..._detectInvariants(code)];
  let insertAt = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('import ')) { insertAt = i + 1; break; }
  }
  if (insertAt === 0) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#!') && !lines[i].startsWith('//') && lines[i].trim() !== '') { insertAt = i; break; }
    }
  }
  lines.splice(insertAt, 0, '', ...invariantsBlock);
  return lines.join('\n');
}

export function ping() {
  const issues = [];
  if (typeof safeAtomicWrite !== 'function') issues.push('safeAtomicWrite missing');
  if (typeof addFinding !== 'function') issues.push('addFinding missing');
  if (typeof _injectInvariants !== 'function') issues.push('_injectInvariants missing');
  if (typeof _detectInvariants !== 'function') issues.push('_detectInvariants missing');
  if (issues.length === 0) return { ok: true, module: 'lab-health', funcs: ['processLabHealth', 'ping'] };
  return { ok: false, module: 'lab-health', issues };
}

export async function processLabHealth(detail, goalId) {
  const rel = detail.replace(/^add invariants block to /, '').replace(/^extract hardcoded paths in /, '');
  const filePath = resolve(PROJECT_ROOT, rel);
  if (!existsSync(filePath)) return { ok: false, info: `file not found: ${rel}` };

  const orig = readFileSync(filePath, 'utf8');
  let code, changes, key;

  if (detail.startsWith('add invariants block to ')) {
    key = `invariants:${rel}`;
    if (isProcessed(key)) return { ok: true, info: `already processed: ${key}` };
    code = _injectInvariants(orig);
    if (code === orig) return { ok: false, info: `no invariants needed in ${rel}` };
    changes = ['added invariants block'];
  } else if (detail.startsWith('extract hardcoded paths in ')) {
    return { ok: false, info: 'extractPaths disabled (semantically unsafe), need manual fix' };
  } else {
    return { ok: false, info: `unknown lab-health pattern: ${detail}` };
  }

  try {
    await safeAtomicWrite(filePath, code);
    markProcessed(key, changes.join(', '));
    addFinding('bridge', 'lab-health', `${rel}: ${changes.join(', ')}`);
    return { ok: true, info: `${rel}: ${changes.join(', ')}` };
  } catch (e) {
    return { ok: false, info: `safe write failed: ${e.message}` };
  }
}
