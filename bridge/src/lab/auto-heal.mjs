import { readFile, readdir } from 'fs/promises';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(__dirname, '../experiments');

const PATTERNS = [
  {
    name: 'missing-export',
    test: (msg) => /is not a function|is not a constructor|Cannot find module/.test(msg),
    fix: async (msg, goalId) => {
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
  const { getStatus, listGoals } = await import('./goal-queue.mjs');
  const goals = listGoals();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return { ok: false, error: 'goal not found' };
  if (goal.status !== 'failed') return { ok: false, error: 'goal not failed' };
  const result = goal.result || {};
  const diag = await diagnose({ ok: result.ok, error: result.error || (result.ok ? '' : 'FAIL'), goal });
  return { ok: true, goal, ...diag };
}

export const META = { id: 'auto-heal' };
