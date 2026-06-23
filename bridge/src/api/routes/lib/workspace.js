import { resolve } from 'path';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const BASE_DIR = resolve('workspaces');

export async function ensureProject(name) {
  const dir = resolve(BASE_DIR, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function walkDir(base, dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = resolve(dir, entry.name);
    const relPath = fullPath.slice(base.length + 1);
    if (entry.isDirectory()) {
      await walkDir(base, fullPath, files);
    } else {
      let content = '';
      try { content = await readFile(fullPath, 'utf8'); } catch (e) { console.debug('[walkDir] read error:', e.message); }
      files.push({ path: relPath, content });
    }
  }
}

export async function scanProjectFiles(name) {
  const dir = resolve(BASE_DIR, name);
  if (!existsSync(dir)) return [];
  const files = [];
  await walkDir(dir, dir, files);
  return files;
}

export async function writeWithGit(workspace, filePath, content) {
  const dir = resolve(BASE_DIR, workspace);
  await mkdir(dir, { recursive: true });
  const fullPath = resolve(dir, filePath);
  await mkdir(resolve(fullPath, '..'), { recursive: true });

  const exists = existsSync(fullPath);
  let existingContent = '';
  if (exists) try { existingContent = await readFile(fullPath, 'utf8'); } catch (e) { console.debug('[writeWithGit] read error:', e.message); }
  const action = !exists ? 'created' : (existingContent !== content ? 'updated' : 'unchanged');

  await writeFile(fullPath, content, 'utf8');

  let commit = '';
  try {
    if (!existsSync(resolve(dir, '.git'))) execSync('git init', { cwd: dir, stdio: 'pipe' });
    execSync(`git add "${filePath}"`, { cwd: dir, stdio: 'pipe' });
    const out = execSync(`git commit -m "auto: ${action} ${filePath}"`, { cwd: dir, stdio: 'pipe' });
    const m = out.toString().match(/\[.*?([0-9a-f]{7,40})\]/);
    if (m) commit = m[1];
  } catch (e) {
    console.debug('[workspace] git skipped:', e.message);
  }

  return { action, commit };
}

export async function describeProject(name) {
  const dir = resolve(BASE_DIR, name);
  const files = await scanProjectFiles(name);
  let gitLog = '';
  try {
    if (existsSync(resolve(dir, '.git'))) {
      gitLog = execSync('git log --oneline -10', { cwd: dir, stdio: 'pipe' }).toString().trim();
    }
  } catch (e) { console.debug('[describeProject] git error:', e.message); }
  return { name, files, gitLog };
}

export function getProjectPath(name) {
  return resolve(BASE_DIR, name);
}
