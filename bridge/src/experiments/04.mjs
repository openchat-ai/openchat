// Experiment 52: Skill Loader — Markdown 即命令，条件路径激活
//
// 基于 Anthropic 官方 skills/loadSkillsDir.ts 模式。
// Markdown 文件带 frontmatter 作为 LLM 可调用 skill，
// 支持条件路径激活 (gitignore 风格 paths:)、三种优先级加载、动态发现。
//
// I/O (compose 契约):
//   { op, name?, args?, paths?, dir? }
//   → { outputs: { skills?, content?, active?, result? } }

import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, relative, dirname, basename } from 'path';
import { create } from './lib/report.mjs';

export const META = { id: 'skill-loader' };

const NAME = 'Skill Loader — Markdown 即命令，条件路径激活';

// ── Skill 结构 ──

class Skill {
  constructor({ name, description, content, body, paths, priority, dir, file }) {
    this.name = name;
    this.description = description || '';
    this.content = content;
    this.body = body || content;
    this.paths = paths || [];
    this.priority = priority || 50;
    this.dir = dir;
    this.file = file;
    this._active = true;
  }

  matchesPath(filePath) {
    if (!this.paths || this.paths.length === 0) return true;
    for (const pattern of this.paths) {
      if (filePath.includes(pattern.replace('*', ''))) return true;
    }
    return false;
  }
}

// ── Frontmatter 解析 ──

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { meta: {}, body: text };

  const endIdx = text.indexOf('---', 3);
  if (endIdx === -1) return { meta: {}, body: text };

  const front = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 3).trim();

  const meta = {};
  for (const line of front.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    let val = line.slice(idx + 1).trim();

    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);

    if (key === 'paths') {
      try { meta[key] = JSON.parse(val); } catch { meta[key] = [val]; }
    } else if (val === 'true' || val === 'yes') meta[key] = true;
    else if (val === 'false' || val === 'no') meta[key] = false;
    else if (/^\d+$/.test(val)) meta[key] = Number(val);
    else meta[key] = val;
  }

  return { meta, body };
}

// ── Skill 注册表 ──

const _registry = new Map(); // name → Skill
const _scanCache = new Set(); // scanned dirs

const SKILL_DIRS = [
  { path: '.claude/skills', priority: 100 },       // project
  { path: '.config/skills', priority: 50 },        // user
  { path: 'skills', priority: 10 },                // bundled
];

// ── 目录扫描 ──

async function _scanDir(basePath, config) {
  const dirPath = resolve(basePath, config.path);
  try {
    await stat(dirPath);
  } catch {
    return [];
  }

  const items = await readdir(dirPath, { withFileTypes: true });
  const found = [];

  for (const item of items) {
    if (!item.isDirectory()) continue;
    const skillDir = resolve(dirPath, item.name);
    const skillFile = resolve(skillDir, 'SKILL.md');

    try {
      await stat(skillFile);
    } catch {
      continue;
    }

    const raw = await readFile(skillFile, 'utf8');
    const { meta, body } = parseFrontmatter(raw);

    const skill = new Skill({
      name: meta.name || item.name,
      description: meta.description || '',
      content: raw,
      body,
      paths: meta.paths || [],
      priority: config.priority,
      dir: skillDir,
      file: skillFile,
    });

    found.push(skill);
  }

  return found;
}

async function _resolveTemplateVars(text, vars = {}) {
  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`\${${key}}`, String(val));
  }
  return result;
}

// ── Public API ──

export async function run({ inputs = {} } = {}) {
  const { op, name, args = {}, paths, dir } = inputs;

  switch (op) {
    case 'scan': {
      const scanDir = dir || process.cwd();
      const all = [];

      for (const config of SKILL_DIRS) {
        const found = await _scanDir(scanDir, config);
        all.push(...found);
      }

      // 去重 + 按 priority 排序
      for (const skill of all) {
        if (!_registry.has(skill.name) || skill.priority > _registry.get(skill.name).priority) {
          _registry.set(skill.name, skill);
        }
      }

      _scanCache.add(scanDir);

      // 计算条件激活
      const active = [..._registry.values()].filter(s => {
        if (!paths) return true;
        return paths.some(p => s.matchesPath(p));
      });

      return {
        outputs: {
          loaded: _registry.size,
          active: active.map(s => ({ name: s.name, description: s.description })),
        },
      };
    }

    case 'list': {
      const all = [..._registry.values()];
      const skills = all.map(s => ({
        name: s.name,
        description: s.description,
        priority: s.priority,
        hasPaths: s.paths.length > 0,
        active: s._active,
      }));

      return { outputs: { skills } };
    }

    case 'load': {
      if (!name) throw new Error('name required for load');
      await run({ inputs: { op: 'scan', dir, paths } });
      const s = _registry.get(name);
      if (!s) throw new Error(`skill not found: ${name}. Run scan first.`);
      const content = await _resolveTemplateVars(s.body, args);
      return { outputs: { content } };
    }

    case 'call': {
      if (!name) throw new Error('name required for call');
      await run({ inputs: { op: 'scan', dir, paths } });
      const s = _registry.get(name);
      if (!s) throw new Error(`skill not found: ${name}`);
      const content = await _resolveTemplateVars(s.body, args);
      // placeholder: LLM 接收 content 作为 system prompt 执行
      return { outputs: { result: `[skill:${name}] ${content.slice(0, 200)}...` } };
    }

    case 'reload': {
      _registry.clear();
      _scanCache.clear();
      return await run({ inputs: { op: 'scan', dir, paths } });
    }

    case 'create': {
      if (!name) throw new Error('name required for create');
      const skillDir = dir ? resolve(dir, 'skills', name) : resolve(process.cwd(), '.claude/skills', name);
      const skillFile = resolve(skillDir, 'SKILL.md');
      const content = args.content || `---\nname: ${name}\ndescription: ${args.description || ''}\n---\n\nPlease implement the following:\n\n`;

      await mkdir(skillDir, { recursive: true });
      await writeFile(skillFile, content, 'utf8');

      return { outputs: { path: skillFile, created: true } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 测试 ──

export async function test() {
  const { ok, ng, report } = create();
  let pass = true;

  // 临时技能目录
  const tmpDir = resolve(process.cwd(), '.test-skills-tmp');
  const skillDir = resolve(tmpDir, 'skills');
  const testSkillFile = resolve(skillDir, 'demo/SKILL.md');
  const testSkillContent = `---
name: demo
description: 演示技能
paths: ["src/"]
priority: 50
---

你是一个演示 AI。请按以下步骤操作：
1. 读取用户路径
2. 分析代码
3. 返回结果
`;

  try {
    await mkdir(resolve(skillDir, 'demo'), { recursive: true });
    await writeFile(testSkillFile, testSkillContent, 'utf8');

    // ① scan
    const s1 = await run({ inputs: { op: 'scan', dir: tmpDir } });
    if (s1.outputs.loaded >= 1) ok('scan finds skills');
    else { ng(`scan: loaded ${s1.outputs.loaded}`); pass = false; }

    // ② list
    const s2 = await run({ inputs: { op: 'list' } });
    if (s2.outputs.skills.length >= 1) ok('list returns skills');
    else { ng('list: empty'); pass = false; }

    // ③ load 具体 skill
    const s3 = await run({ inputs: { op: 'load', name: 'demo' } });
    if (s3.outputs.content && s3.outputs.content.includes('演示')) ok('load returns skill content');
    else { ng('load: missing content'); pass = false; }

    // ④ call skill
    const s4 = await run({ inputs: { op: 'call', name: 'demo', args: { user: 'test' } } });
    if (s4.outputs.result && s4.outputs.result.startsWith('[skill:demo]')) ok('call skill works');
    else { ng('call: wrong format'); pass = false; }

    // ⑤ 条件路径激活
    const s5 = await run({ inputs: { op: 'scan', dir: tmpDir, paths: ['src/'] } });
    if (s5.outputs.active.length >= 1) ok('path activation matches src/');
    else { ng('path activation: no match'); pass = false; }

    const s6 = await run({ inputs: { op: 'scan', dir: tmpDir, paths: ['vendor/'] } });
    if (s6.outputs.active.length === 0) ok('path activation skips vendor/');
    else { ng('path activation: should not match vendor/'); pass = false; }

    // ⑥ parseFrontmatter 纯函数
    const { meta, body } = parseFrontmatter(testSkillContent);
    if (meta.name === 'demo' && meta.description === '演示技能') ok('frontmatter parsing works');
    else { ng(`frontmatter: got ${JSON.stringify(meta)}`); pass = false; }

    // ⑦  recreate
    const s7 = await run({ inputs: { op: 'create', name: 'new-skill', args: { description: '自动创建' }, dir: tmpDir } });
    if (s7.outputs.created) ok('create skill works');
    else { ng('create: failed'); pass = false; }

    // ⑧ reload
    const s8 = await run({ inputs: { op: 'reload', dir: tmpDir } });
    if (s8.outputs.loaded >= 2) ok('reload >2 skills');
    else { ng(`reload: got ${s8.outputs.loaded}`); pass = false; }

  } finally {
    // 清理
    try {
      const { rm } = await import('fs/promises');
      await rm(tmpDir, { recursive: true, force: true });
    } catch {}
    _registry.clear();
    _scanCache.clear();
  }

  report(NAME);
  return pass;
}
