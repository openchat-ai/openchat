// Diff review — shows a diff and asks for user approval before finalizing changes.
// === invariants ===
// - diffReview() computes git diff for staged/unstaged changes
// - confirmDiff() asks user via stdin for y/n — interactive only
// - For non-interactive (chat), returns diff text for LLM to present

import { execSync } from 'child_process';

export function getGitDiff(cwd = process.cwd()) {
  try {
    const diff = execSync('git diff 2>&1', { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
    const staged = execSync('git diff --cached 2>&1', { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
    const output = [];
    if (staged.trim()) output.push('=== Staged ===\n' + staged);
    if (diff.trim()) output.push('=== Unstaged ===\n' + diff);
    return output.join('\n') || '(no changes)';
  } catch {
    return '(not a git repo or git unavailable)';
  }
}

export function executeTool(name, args) {
  if (name === 'diff_review' || name === 'getGitDiff') {
    return getGitDiff(args?.cwd);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function confirmDiff(diffText, promptText = 'Apply these changes? (Y/n): ') {
  if (!diffText || diffText === '(no changes)' || diffText.startsWith('(not a git repo')) {
    return true;
  }
  const rl = await import('readline').then(m => m.createInterface({ input: process.stdin, output: process.stdout }));
  return new Promise(resolve => {
    rl.question(`\n${diffText}\n\n${promptText}`, answer => {
      rl.close();
      resolve(answer.toLowerCase() !== 'n');
    });
  });
}

export function revertChanges(cwd = process.cwd()) {
  try {
    execSync('git checkout -- . 2>&1', { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true });
    return { reverted: true };
  } catch (e) {
    return { reverted: false, error: e.message };
  }
}
