// Experiment: verify-commit — 提交前质量门禁
// Manifest id: verify-commit
// I/O: { op, files?, diffLines? } → { errors, warnings, passed }

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import fsp from 'fs/promises';
import { create } from './lib/report.mjs';

export const META = {
  id: 'verify-commit',
  name: 'Verify Commit — 提交前质量门禁',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'check | check_files' },
    { name: 'files', type: 'array', required: false, description: 'check_files: [{path, content, new?}]' },
    { name: 'diffLines', type: 'number', required: false },
  ],
  outputs: [
    { name: 'errors', type: 'array' },
    { name: 'warnings', type: 'array' },
    { name: 'passed', type: 'boolean' },
    { name: 'stats', type: 'object' },
  ],
  deps: [],
  tags: ['commit', 'quality', 'gate', 'spec'],
};

const SPEC_REQUIRED = [
  'openchat-flutter/lib/core/audio/lmdn_codec.dart',
  'openchat-flutter/lib/core/audio/audio_pipeline.dart',
  'openchat-flutter/lib/core/api/qiniu_client.dart',
  'openchat-flutter/lib/core/sdui_config.dart',
  'openchat-flutter/lib/ui/screens/chat_voice_recorder.dart',
  'openchat-flutter/lib/ui/screens/voice_room_screen.dart',
  'openchat-flutter/lib/ui/screens/room_screen.dart',
];

const REQUIRED_SPEC_SECTIONS = ['## 数据流', '## 接口签名', '## 边界条件', '## 文件清单'];

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('verify-commit.run: op required');
  switch (op) {
    case 'check':
      return { outputs: await _checkStaged() };
    case 'check_files':
      return { outputs: await _checkFiles(args.files || [], args.diffLines || 0) };
    default:
      throw new Error(`verify-commit.run: unknown op "${op}"`);
  }
}

async function _checkStaged() {
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { return ''; }
  };
  const changedRaw = run('git diff --cached --name-only --diff-filter=ACMR');
  const allFiles = changedRaw.split('\n').filter(Boolean);
  const dartFiles = allFiles.filter(f => f.endsWith('.dart'));
  const specFiles = allFiles.filter(f => f.endsWith('.spec.md'));
  const newDartFiles = run('git diff --cached --diff-filter=A --name-only')
    .split('\n').filter(f => f.endsWith('.dart'));
  const diffStat = run('git diff --cached --stat');
  const totalLines = diffStat.split('\n')
    .filter(l => l.includes('insertion') || l.includes('deletion'))
    .reduce((sum, l) => { const m = l.match(/(\d+) insertion/); return sum + (m ? parseInt(m[1]) : 0); }, 0);
  return _runChecks(dartFiles, specFiles, newDartFiles, totalLines);
}

async function _checkFiles(fileList, diffLines) {
  const dartFiles = fileList.filter(f => f.path.endsWith('.dart')).map(f => f.path);
  const specFiles = fileList.filter(f => f.path.endsWith('.spec.md')).map(f => f.path);
  const newDartFiles = fileList.filter(f => f.path.endsWith('.dart') && f.new).map(f => f.path);
  return _runChecks(dartFiles, specFiles, newDartFiles, diffLines, fileList);
}

async function _runChecks(dartFiles, specFiles, newDartFiles, totalLines, fileList) {
  const errors = [];
  const warnings = [];
  const fileMap = {};
  if (fileList) for (const f of fileList) fileMap[f.path] = f.content;

  const getContent = async (p) => {
    if (fileMap[p]) return fileMap[p];
    try { return await fsp.readFile(p, 'utf-8'); } catch { return ''; }
  };
  const exists = (p) => fileMap[p] ? true : existsSync(p);

  for (const f of dartFiles) {
    const content = await getContent(f);
    const lineCount = content.split('\n').length;
    const specPath = f.replace(/\.dart$/, '.spec.md');
    const isNew = newDartFiles.includes(f);

    if (lineCount > 200) warnings.push(`${f}: ${lineCount} 行（建议 ≤200）`);
    if (lineCount > 100 && !content.includes('// === invariants ==='))
      warnings.push(`${f}: >100 行但缺少 invariants 约束块`);
    if (isNew && lineCount > 50 && !exists(specPath))
      errors.push(`${f}: 新增 >50 行但无对应 ${specPath}`);

    const inWhitelist = SPEC_REQUIRED.includes(f);
    if (inWhitelist && !isNew && lineCount > 100) {
      if (!specFiles.includes(specPath))
        errors.push(`${f}: 白名单文件改动但未同步 ${specPath}`);
    }
    if (inWhitelist && !exists(specPath))
      errors.push(`${f}: 白名单模块缺少 ${specPath}`);
  }

  for (const f of specFiles) {
    const content = await getContent(f);
    for (const section of REQUIRED_SPEC_SECTIONS) {
      if (!content.includes(section)) errors.push(`${f}: 缺少 "${section}"`);
    }
  }

  if (totalLines > 500) errors.push(`总 diff ${totalLines} 行（>500），R4 违规`);
  else if (totalLines > 300) warnings.push(`总 diff ${totalLines} 行（>300），接近 R4 上限`);

  return { errors, warnings, passed: errors.length === 0, stats: { dartFiles: dartFiles.length, specFiles: specFiles.length, totalLines } };
}

const { ok, ng, skip, report } = create();
const NAME = 'Verify Commit — 提交前质量门禁';

async function test() {
  const result = await run({ inputs: { op: 'check' } });
  if (result.outputs.passed || result.outputs.errors.length > 0) ok(`check 完成: ${result.outputs.errors.length} err, ${result.outputs.warnings.length} warn`);
  else ng('check failed');
  report(NAME);
}

export { test };
