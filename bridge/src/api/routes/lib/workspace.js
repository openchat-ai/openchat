/**
 * Workspace 管理：CLI 模式 / API 模式切换 + Git 初始化 + 文件写入
 */
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

const PROJECTS_ROOT_API = path.resolve('workspaces');

/** CLI 模式用 cwd，API 模式用 workspaces/{name} */
export function getProjectPath(project) {
  const isCLI = process.argv.includes('--cli') || process.env.OPENCHAT_CLI === 'true';
  const root = isCLI ? process.cwd() : PROJECTS_ROOT_API;
  return path.resolve(root, project);
}

export async function ensureProject(project) {
  const projectPath = getProjectPath(project);
  await fs.mkdir(projectPath, { recursive: true });
  const gitDir = path.join(projectPath, '.git');
  try {
    await fs.access(gitDir);
  } catch {
    try {
      execSync('git init', { cwd: projectPath, stdio: 'pipe' });
      execSync('git config user.email "agent@openchat" && git config user.name "OpenChat Agent"', { cwd: projectPath, stdio: 'pipe' });
    } catch {}
  }
  return projectPath;
}

/** 写入文件 + git commit，自动去重（同一内容不重复 commit） */
export async function writeWithGit(project, filePath, content) {
  const projectPath = await ensureProject(project);
  const fullPath = path.join(projectPath, filePath);
  const patchPath = fullPath + '.patch';

  let result = { action: 'created', path: filePath, size: content.length, commit: null };
  try {
    const existing = await fs.readFile(fullPath, 'utf8');
    if (existing !== content) {
      const diff = computeDiff(existing, content);
      await fs.writeFile(fullPath, content, 'utf8');
      try {
        execSync('git add .', { cwd: projectPath, stdio: 'pipe' });
        const msg = `${new Date().toISOString()} update ${filePath}`;
        const hash = execSync(`git commit -m "${msg}"`, { cwd: projectPath, stdio: 'pipe' }).toString().trim();
        result = { action: 'committed', path: filePath, size: content.length, commit: hash.slice(0, 8), diff };
      } catch {
        result = { action: 'written', path: filePath, size: content.length, commit: null };
      }
    } else {
      result = { action: 'unchanged', path: filePath, size: content.length };
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
      try {
        execSync('git add .', { cwd: projectPath, stdio: 'pipe' });
        const msg = `${new Date().toISOString()} create ${filePath}`;
        const hash = execSync(`git commit -m "${msg}"`, { cwd: projectPath, stdio: 'pipe' }).toString().trim();
        result = { action: 'committed', path: filePath, size: content.length, commit: hash.slice(0, 8) };
      } catch {
        result = { action: 'created', path: filePath, size: content.length, commit: null };
      }
    } else {
      throw e;
    }
  }
  return result;
}

function computeDiff(oldStr, newStr) {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const out = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i] ?? null;
    const n = newLines[i] ?? null;
    if (o === n) out.push(`  ${o ?? ''}`);
    else {
      if (o !== null) out.push(`- ${o}`);
      if (n !== null) out.push(`+ ${n}`);
    }
  }
  return out.join('\n');
}

/** 扫描项目现有文件（排除 .git 和 .spec.md） */
export async function scanProjectFiles(project) {
  const projectPath = getProjectPath(project);
  const files = [];
  try {
    const entries = await fs.readdir(projectPath, { recursive: true, withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const rel = path.relative(projectPath, path.join(projectPath, e.name));
      if (rel.startsWith('.git') || rel.endsWith('.spec.md') || rel.endsWith('.patch')) continue;
      try {
        const content = await fs.readFile(path.join(projectPath, e.name), 'utf8');
        files.push({ path: rel, content });
      } catch {}
    }
  } catch {}
  return files;
}

/** 列项目文件 + git log */
export async function describeProject(project) {
  const projectPath = getProjectPath(project);
  const files = await scanProjectFiles(project);
  let gitLog = '';
  try { gitLog = execSync('git log --oneline -10', { cwd: projectPath, stdio: 'pipe' }).toString().trim(); } catch {}
  return { project, path: projectPath, files, gitLog };
}
