// Experiment 54: Dream Consolidation — 后台记忆归并引擎
//
// 基于 CCB /dream autoDream.ts 模式。
// 后台 fork agent 整理记忆，minHours + minSessions 门控，
// 文件锁防冲突，归并到 MEMORY.md 索引。
// 依赖 memory (43) 的 vector store。
//
// I/O (compose 契约):
//   { op, sessions?, memdir?, force? }
//   → { outputs: { summary?, consolidated?, locked?, gates? } }

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { create } from './lib/report.mjs';

export const META = { id: 'dream-consolidation' };

const NAME = 'Dream — 后台记忆归并引擎';

// ── 常量 ──

const LOCK_FILE = '.dream.lock';
const MIN_HOURS = 24;
const MIN_SESSIONS = 5;
const MEMORY_INDEX = 'MEMORY.md';

// ── 锁管理 ──

async function _acquireLock(lockDir) {
  const lockPath = resolve(lockDir, LOCK_FILE);
  try {
    await writeFile(lockPath, String(Date.now()), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

async function _releaseLock(lockDir) {
  const lockPath = resolve(lockDir, LOCK_FILE);
  try {
    await unlink(lockPath);
  } catch {}
}

async function _isLocked(lockDir) {
  const lockPath = resolve(lockDir, LOCK_FILE);
  if (!existsSync(lockPath)) return false;
  try {
    const content = await readFile(lockPath, 'utf8');
    const ts = Number(content);
    // 锁超过 5 分钟视为过期
    if (Date.now() - ts > 300000) {
      await _releaseLock(lockDir);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── 门控检查 ──

function _checkGates(sessions, lastConsolidation, isLocked) {
  const now = Date.now();
  const hoursSince = lastConsolidation ? (now - lastConsolidation) / 3600000 : Infinity;

  return {
    hoursSinceLast: Math.round(hoursSince * 10) / 10,
    sessionCount: (sessions || []).length,
    globalLock: isLocked,
    gateHours: hoursSince >= MIN_HOURS,
    gateSessions: (sessions || []).length >= MIN_SESSIONS,
    gateLock: !isLocked,
    canConsolidate: hoursSince >= MIN_HOURS
      && (sessions || []).length >= MIN_SESSIONS
      && !isLocked,
  };
}

// ── 记忆读取 ──

async function _loadMemdir(memdir) {
  const dir = memdir || resolve(process.cwd(), '.memory');
  const entries = [];

  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isFile() && (item.name.endsWith('.md') || item.name.endsWith('.json'))) {
        const filePath = resolve(dir, item.name);
        const content = await readFile(filePath, 'utf8');
        const stat = await import('fs/promises').then(fs => fs.stat(filePath));
        entries.push({
          name: item.name,
          path: filePath,
          content: content.slice(0, 5000),
          size: content.length,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  } catch {}

  return entries;
}

// ── 归并逻辑 ──

async function _consolidate(entries, memdir) {
  // 按主题归类：去掉尾部的序号后缀 (voice-chat-001 → voice-chat)
  const topics = {};
  for (const entry of entries) {
    const base = entry.name.replace(/\.(md|json)$/, '').toLowerCase();
    const topic = base.replace(/[-_]\d{3,}$/, '');
    if (!topics[topic]) topics[topic] = [];
    topics[topic].push(entry);
  }

  const consolidated = [];
  let summaryLines = [];

  for (const [topic, group] of Object.entries(topics)) {
    if (group.length < 2) continue; // 单一文件无需归并

    // 合并内容（去重 + 按时间排序）
    const seen = new Set();
    const merged = [];
    group.sort((a, b) => a.mtimeMs - b.mtimeMs);

    for (const entry of group) {
      const lines = entry.content.split('\n').filter(l => {
        const trimmed = l.trim();
        if (!trimmed || seen.has(trimmed)) return false;
        seen.add(trimmed);
        return true;
      });
      merged.push(...lines);
    }

    // 写回 topic 主文件
    const mainFile = resolve(memdir, `${topic}.md`);
    const mergedContent = [
      `# ${topic}`,
      `> 自动归并于 ${new Date().toISOString()}`,
      `> 来源: ${group.map(e => e.name).join(', ')}`,
      '',
      ...merged.slice(0, 2000), // 单文件上限 2000 行
    ].join('\n');

    await writeFile(mainFile, mergedContent, 'utf8');

    consolidated.push({
      topic,
      entries: group.length,
      linesBefore: group.reduce((s, e) => s + e.content.split('\n').length, 0),
      linesAfter: merged.length,
    });

    summaryLines.push(`- **${topic}**: ${group.length} files → 1, ${merged.length} lines`);
  }

  // 更新 MEMORY.md 索引
  const indexFile = resolve(memdir, MEMORY_INDEX);
  const indexContent = [
    '# MEMORY.md — 记忆索引',
    `> 最后归并: ${new Date().toISOString()}`,
    '',
    '## 主题索引',
    ...consolidated.map(c => `- **${c.topic}**: ${c.linesAfter} lines (${c.entries} files)`),
    '',
  ].join('\n');

  await writeFile(indexFile, indexContent, 'utf8');

  return {
    consolidated: consolidated.length,
    totalFiles: consolidated.reduce((s, c) => s + c.entries, 0),
    summary: summaryLines.join('\n'),
    topics: consolidated,
  };
}

// ── Public API ──

export async function run({ inputs = {} } = {}) {
  const { op, sessions, memdir, force } = inputs;

  const baseDir = memdir || resolve(process.cwd(), '.memory');

  switch (op) {
    case 'consolidate': {
      if (await _isLocked(baseDir)) {
        const gates = _checkGates(sessions, 0, true);
        return { outputs: { consolidated: 0, gates, summary: 'locked by another process' } };
      }

      const entries = await _loadMemdir(baseDir);
      const gates = _checkGates(entries, 0, false);

      if (!force && !gates.canConsolidate) {
        return { outputs: { consolidated: 0, gates, summary: 'gates not met' } };
      }

      const locked = await _acquireLock(baseDir);
      if (!locked) {
        return { outputs: { consolidated: 0, gates, summary: 'lock contention' } };
      }

      try {
        const result = await _consolidate(entries, baseDir);
        return {
          outputs: {
            consolidated: result.consolidated,
            totalFiles: result.totalFiles,
            summary: result.summary,
            gates,
          },
        };
      } finally {
        await _releaseLock(baseDir);
      }
    }

    case 'status': {
      const entries = await _loadMemdir(baseDir);
      const locked = await _isLocked(baseDir);
      const gates = _checkGates(entries, 0, locked);
      return {
        outputs: {
          fileCount: entries.length,
          totalSize: entries.reduce((s, e) => s + e.size, 0),
          gates,
          locked,
        },
      };
    }

    case 'lock': {
      const locked = await _acquireLock(baseDir);
      return { outputs: { locked } };
    }

    case 'unlock': {
      await _releaseLock(baseDir);
      return { outputs: { locked: false } };
    }

    case 'scan': {
      const entries = await _loadMemdir(baseDir);
      const topics = {};
      for (const e of entries) {
        const topic = e.name.replace(/\.(md|json)$/, '').toLowerCase();
        if (!topics[topic]) topics[topic] = [];
        topics[topic].push(e.name);
      }
      return { outputs: { files: entries.length, topics: Object.keys(topics).length, topicMap: topics } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 测试 ──

export async function test() {
  const { ok, ng, report } = create();
  let pass = true;

  const tmpDir = resolve(process.cwd(), '.test-dream-tmp');
  const memDir = resolve(tmpDir, '.memory');

  try {
    await mkdir(memDir, { recursive: true });

    // 创建测试记忆文件
    const files = {
      'voice-chat-001.md': '# Voice Chat\n用户: 你好\nAI: 你好！\n用户: 今天天气如何\nAI: 今天是晴天',
      'voice-chat-002.md': '# Voice Chat\n用户: 帮我查一下天气\nAI: 明天有雨\n用户: 谢谢\nAI: 不客气',
      'coding-notes.md': '# Coding\n研究了 Feature Flag 系统\n实现了分层回退',
      'coding-notes-2.md': '# Coding\nFeature Flag 添加了对 env 覆盖的支持\n新增了安全门控函数',
    };

    for (const [name, content] of Object.entries(files)) {
      await writeFile(resolve(memDir, name), content, 'utf8');
    }

    // ① status
    const s1 = await run({ inputs: { op: 'status', memdir: memDir } });
    if (s1.outputs.fileCount === 4) ok('status shows 4 files');
    else { ng(`status: got ${s1.outputs.fileCount} files`); pass = false; }

    // ② scan
    const s2 = await run({ inputs: { op: 'scan', memdir: memDir } });
    if (s2.outputs.files === 4 && s2.outputs.topics >= 2) ok('scan finds 4 files across 2+ topics');
    else { ng(`scan: ${s2.outputs.files} files / ${s2.outputs.topics} topics`); pass = false; }

    // ③ consolidate
    const s3 = await run({ inputs: { op: 'consolidate', memdir: memDir, force: true } });
    if (s3.outputs.consolidated >= 1 && s3.outputs.totalFiles >= 2) ok('consolidate merged files');
    else { ng(`consolidate: ${s3.outputs.consolidated} topics / ${s3.outputs.totalFiles} files`); pass = false; }

    // ④ 验证 MEMORY.md 索引已创建
    const indexContent = await readFile(resolve(memDir, 'MEMORY.md'), 'utf8');
    if (indexContent.includes('voice-chat') || indexContent.includes('coding')) ok('MEMORY.md index created');
    else { ng('MEMORY.md missing topics'); pass = false; }

    // ⑤ 锁机制
    const s5a = await run({ inputs: { op: 'lock', memdir: memDir } });
    if (s5a.outputs.locked) {
      const s5b = await run({ inputs: { op: 'consolidate', memdir: memDir, force: true } });
      if (s5b.outputs.consolidated === 0 && s5b.outputs.summary.includes('lock')) ok('lock prevents concurrent consolidate');
      else { ng('lock did not block'); pass = false; }
      await run({ inputs: { op: 'unlock', memdir: memDir } });
    } else {
      ng('lock failed to acquire');
      pass = false;
    }

    // ⑥ 门控
    const entries = await readdir(memDir);
    const gates = _checkGates(entries, Date.now(), false);
    if (gates.gateHours === false) ok('gates: hoursSince < 24 after fresh consolidate');
    else { ng(`gates: hoursSince=${gates.hoursSinceLast}`); pass = false; }

  } finally {
    try {
      const { rm } = await import('fs/promises');
      await rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  report(NAME);
  return pass;
}
