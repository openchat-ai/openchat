// git-diff.mjs — 包 git diff (staged/working/last commit) 给 dependency-graph 用
//
// 用途: 知道"现在改了哪些文件", 给 check-affected / run-changed 用
//
// 接口:
//   getChangedFiles('staged')   → 即将 commit 的文件 (默认)
//   getChangedFiles('working')  → working tree 未 staged
//   getChangedFiles('last')     → 上次 commit 的文件
//   getChangedFiles('unstaged') → working tree 但未 staged (跟 'working' 同义, 兼容)
//
// 输出: repo-relative path 数组, 跟 dependency-graph 用的 key 一致

import { execSync } from 'child_process';

export function getChangedFiles(mode = 'staged', cwd = process.cwd()) {
  let cmd;
  if (mode === 'staged' || mode === 'cached') {
    cmd = 'git diff --cached --name-only --diff-filter=ACMR';
  } else if (mode === 'working' || mode === 'unstaged') {
    cmd = 'git diff --name-only --diff-filter=ACMR';
  } else if (mode === 'all') {
    // staged + working 都不漏
    cmd = 'git diff --name-only --diff-filter=ACMR HEAD';
  } else if (mode === 'last') {
    cmd = 'git diff --name-only --diff-filter=ACMR HEAD~1 HEAD';
  } else {
    throw new Error(`git-diff.getChangedFiles: unknown mode "${mode}" (use staged/working/all/last)`);
  }
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim() ? out.trim().split('\n').map(s => s.replace(/\\/g, '/')) : [];
  } catch (e) {
    // 没 git 仓库 / 没 commit → 返空
    return [];
  }
}
