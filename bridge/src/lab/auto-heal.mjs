// auto-heal.mjs — 诊断+自愈模式
// P2: diagnose(goal) → pattern
// P5: 对 auto-severity 的 pattern 自动生成 patch

// === invariants ===
// - patch 生成不修改任何文件，只返回 diff 文本
// - 只有 severity === 'auto' 的 pattern 才生成 patch
// - 所有 I/O 用 fs/promises（不会阻塞 runner）

import { readFile, readdir, writeFile } from 'fs/promises';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(__dirname, '../experiments');

const PATTERNS = [
  {
    name: 'missing-export',
    test: (msg) => /is not a function|is not a constructor|Cannot find module/.test(msg),
    fix: async (msg) => {
      const m = msg.match(/(\S+) is not a function/);
      if (!m) return null;
      const funcName = m[1];
      return { severity: 'auto', suggestion: `Add export for "${funcName}" to the corresponding module`, confidence: 'high' };
    },
  },
  {
    name: 'missing-import',
    test: (msg) => /Cannot find module|ERR_MODULE_NOT_FOUND/.test(msg),
    fix: async (msg) => {
      const m = msg.match(/(['"])([^'"]+)\1/);
      if (!m) return null;
      return { severity: 'auto', suggestion: `Install or create missing module: ${m[2]}`, confidence: 'medium' };
    },
  },
  {
    name: 'config-missing',
    test: (msg) => /config\.json|apiKey.*missing/.test(msg),
    fix: async () => ({ severity: 'manual', suggestion: 'Add apiKey to ~/.openchat/config.json', confidence: 'high' }),
  },
  {
    name: 'timeout',
    test: (msg) => /timeout|ETIMEDOUT/.test(msg),
    fix: async () => ({ severity: 'retry', suggestion: 'Increase timeout or retry with longer timeout', confidence: 'medium' }),
  },
  {
    name: 'syntax-error',
    test: (msg) => /SyntaxError|Unexpected token/.test(msg),
    fix: async (msg) => {
      const m = msg.match(/(\S+\.mjs):(\d+)/);
      if (!m) return { severity: 'manual', suggestion: 'Fix syntax error in experiment file', confidence: 'high' };
      return { severity: 'manual', suggestion: `Fix syntax error in ${m[1]} at line ${m[2]}`, confidence: 'high' };
    },
  },
  {
    name: 'assertion-failed',
    test: (msg) => /AssertionError|assert\.strictEqual|assert\.deepStrictEqual|expected.*actual|not ok/i.test(msg),
    fix: async () => ({ severity: 'auto', suggestion: 'Review test assertion — expected value mismatch', confidence: 'medium' }),
  },
];

export async function diagnose(result) {
  if (result.ok) return { ok: true, diagnosis: null };
  const errorMsg = result.error || result.result?.error || '';
  for (const p of PATTERNS) {
    if (p.test(errorMsg)) {
      const diagnosis = await p.fix(errorMsg, result.goal?.id);
      if (diagnosis) return { ok: false, diagnosis: { pattern: p.name, ...diagnosis }, error: errorMsg };
    }
  }
  return { ok: false, diagnosis: { pattern: 'unknown', severity: 'manual', suggestion: 'Manual review needed', confidence: 'low' }, error: errorMsg };
}

export async function healGoal(goalId) {
  const { listGoals } = await import('./goal-queue.mjs');
  const goals = listGoals();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return { ok: false, error: 'goal not found' };
  if (goal.status !== 'failed') return { ok: false, error: 'goal not failed' };
  const result = goal.result || {};
  const diag = await diagnose({ ok: result.ok, error: result.error || (result.ok ? '' : 'FAIL'), goal });
  if (!diag.ok && diag.diagnosis && diag.diagnosis.severity === 'auto') {
    const patch = await generatePatch(goal, diag.diagnosis);
    return { ok: true, goal, ...diag, patch };
  }
  return { ok: true, goal, ...diag, patch: null };
}

// 根据诊断自动生成 patch（severity === 'auto' 时）
async function generatePatch(goal, diagnosis) {
  try {
    const desc = goal.description;
    const m = desc.match(/实验\s+(\S+):/);
    if (!m) return null;
    const file = m[1];
    const filePath = resolve(EXP_DIR, file.includes('/') ? file : file + '.mjs');
    const content = await readFile(filePath, 'utf8');

    if (diagnosis.pattern === 'missing-export') {
      const funcName = diagnosis.suggestion.match(/"([^"]+)"/)?.[1];
      if (funcName) {
        const exportLine = `export function ${funcName}() { throw new Error('${funcName} not implemented'); }\n`;
        if (!content.includes(funcName)) {
          return {
            file: relative(process.cwd(), filePath),
            patch: `Add stub for ${funcName}\n+ ${exportLine.trim()}`,
            apply: async () => {
              await writeFile(filePath, content + '\n' + exportLine, 'utf8');
              return { ok: true };
            },
          };
        }
      }
    }

    if (diagnosis.pattern === 'missing-import') {
      const modulePath = diagnosis.suggestion.match(/: ([^\s]+)/)?.[1];
      if (modulePath && !content.includes(modulePath)) {
        const importLine = `import {} from '${modulePath}';\n`;
        return {
          file: relative(process.cwd(), filePath),
          patch: `Add import for ${modulePath}\n+ ${importLine.trim()}`,
          apply: async () => {
            await writeFile(filePath, importLine + content, 'utf8');
            return { ok: true };
          },
        };
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

export const META = { id: 'auto-heal' };
