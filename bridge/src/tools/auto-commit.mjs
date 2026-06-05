// Auto commit: git stage + commit with generated message.
// === invariants ===
// - autoCommit(filePaths) stages files, generates message from git diff, commits
// - commitMessage() calls `git diff --cached` to generate descriptive message
// - Falls back to "feat: auto-commit" if diff is empty
// - commitFormat: "type(scope): description"
// - Only works inside a git repo

import { execSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = process.cwd();

export function hasGitRepo(cwd = PROJECT_ROOT) {
  try {
    execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', windowsHide: true });
    return true;
  } catch { return false; }
}

export function gitAdd(filePaths, cwd = PROJECT_ROOT) {
  const files = Array.isArray(filePaths) ? filePaths.join(' ') : filePaths;
  execSync(`git add ${files}`, { cwd, encoding: 'utf8', windowsHide: true });
  return { staged: filePaths };
}

export function gitDiff(cwd = PROJECT_ROOT) {
  try {
    const diff = execSync('git diff --cached', { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
    return diff.trim();
  } catch { return ''; }
}

export function generateMessage(diff, cwd = PROJECT_ROOT) {
  if (!diff) return 'chore: auto-commit';
  // Parse diff for type/scope hints
  const lines = diff.split('\n');
  const addedFiles = lines.filter(l => l.startsWith('+') && l.includes('import') && !l.startsWith('+++'));
  const changedFiles = lines.filter(l => l.startsWith('diff --git')).length;
  const isNewFile = lines.some(l => l.startsWith('new file mode'));

  // Determine type
  let type = 'feat';
  if (lines.some(l => l.includes('fix') || l.includes('bug') || l.includes('error'))) type = 'fix';
  if (lines.some(l => l.includes('refactor') || l.includes('rename') || l.includes('move'))) type = 'refactor';
  if (lines.some(l => l.includes('docs') || l.includes('README') || l.includes('.md'))) type = 'docs';
  if (lines.some(l => l.includes('test') || l.includes('.spec.') || l.includes('.test.'))) type = 'test';
  if (lines.some(l => l.includes('chore') || l.includes('config') || l.includes('.json'))) type = 'chore';

  // Determine scope from first changed file
  const diffHeader = lines.find(l => l.startsWith('diff --git'));
  let scope = '';
  if (diffHeader) {
    const file = diffHeader.replace('diff --git a/', '').replace(' b/', '/');
    scope = file.split('/')[0];
  }

  // Description from the most meaningful line
  const descLines = lines.filter(l =>
    (l.startsWith('+') && !l.startsWith('+++') && l.length > 5 && l.length < 80) ||
    (l.startsWith('-') && !l.startsWith('---') && l.length > 5 && l.length < 80)
  ).slice(0, 5);
  const description = descLines[0]?.replace(/^[+-]\s*/, '').substring(0, 50) || 'update';

  const scopePart = scope ? `(${scope})` : '';
  return `${type}${scopePart}: ${description.substring(0, 60)}`;
}

export async function autoCommit(filePaths, cwd = PROJECT_ROOT) {
  if (!hasGitRepo(cwd)) return { committed: false, error: 'Not a git repository' };
  gitAdd(filePaths, cwd);
  const diff = gitDiff(cwd);
  const message = generateMessage(diff, cwd);
  try {
    execSync(`git commit -m "${message}"`, { cwd, encoding: 'utf8', windowsHide: true });
    return { committed: true, message, files: Array.isArray(filePaths) ? filePaths : [filePaths] };
  } catch (e) {
    return { committed: false, error: e.message, message };
  }
}
