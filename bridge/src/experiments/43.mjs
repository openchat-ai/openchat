// Experiment 43: dna-agent-loop
// DNA 符号检索 + hashline 锚点编辑接成自主闭环（对标 Cursor agent，确定性路线）。
// 见 43.spec.md / ROADMAP-CURSOR.md §2。
//
// === invariants ===
// - 所有 hash_edit 只作用于临时目录 _tmp_dna_agent，绝不触碰真实源码
// - executeTool('hash_edit') 失配返回 HASH_STALE 结构化（不抛）；hashEdit() 直调仍抛
// - runLoop maxRounds 有上限，防死循环
// - dna_query/read_file/grep 只读，hash_edit 写

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { writeFile, readFile as fsRead, rm, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { executeTool } from './lib/coding-lib.mjs';

export const META = { id: 'dna-agent-loop' };
const NAME = 'dna-agent-loop — DNA 检索 + hashline 锚点编辑自主闭环';

const hashline = (line) => createHash('md5').update(line).digest('hex').substring(0, 8);
const TMP = resolve(fileURLToPath(new URL('.', import.meta.url)), '_tmp_dna_agent');

// 轻量 agent 循环：逐 step 执行 tool call（经 coding-lib.executeTool 分发），收集 trace。
export async function runLoop({ steps = [], maxRounds = 8 } = {}) {
  const trace = [];
  let ok = true;
  for (let i = 0; i < Math.min(steps.length, maxRounds); i++) {
    const { tool, args } = steps[i];
    let result;
    try { result = await executeTool(tool, args); }
    catch (e) { result = { ok: false, error: e.message }; ok = false; }
    trace.push({ round: i, tool, result });
  }
  return { ok, rounds: trace.length, trace };
}

export async function run({ inputs = {} } = {}) {
  const q = inputs.query || 'find function answerFromDNA';
  const r = await executeTool('dna_query', { query: q });
  return { outputs: { info: String(r).slice(0, 120) } };
}

export async function test() {
  const log = [];
  const ok = (m) => log.push('✓ ' + m);
  const ng = (m) => { throw new Error(m + ' | ' + log.join('; ')); };
  try {
    // C1: 真实 dna_query 检索（只读，绝不改真实源码）
    const dnaAns = await executeTool('dna_query', { query: 'find function answerFromDNA' });
    console.debug('[C1] dna_query ->', String(dnaAns).slice(0, 90));
    if (/answerFromDNA/.test(dnaAns) && /42\.mjs/.test(dnaAns) && /[0-9a-f]{8}/.test(dnaAns)) ok('C1 dna_query 命中 file:line:hash');
    else ng(`C1 dna_query 未命中: ${dnaAns}`);

    // 临时文件：编辑只作用于此
    await mkdir(TMP, { recursive: true });
    const file = resolve(TMP, 'target.js');
    const rel = file.replace(process.cwd(), '').replace(/^[/\\]/, '');
    const target = 'const API_KEY = "OLD";';
    await writeFile(file, ['// header', target, 'export const x = 1;'].join('\n'), 'utf8');
    const goodHash = hashline(target);

    // C2: hash_edit 命中改行
    const newLine = 'const API_KEY = process.env.API_KEY;';
    const loop1 = await runLoop({ steps: [
      { tool: 'read_file', args: { path: rel } },
      { tool: 'hash_edit', args: { path: rel, hash: goodHash, newContent: newLine } },
    ] });
    const editRes = loop1.trace.find((t) => t.tool === 'hash_edit').result;
    console.debug('[C2] hash_edit ok ->', JSON.stringify(editRes));
    if (editRes && editRes.line === 1) ok('C2 hash_edit 命中第 1 行');
    else ng(`C2 hash_edit 未命中: ${JSON.stringify(editRes)}`);

    // C3: HASH_STALE 自修 — 改后旧 hash 失效 → 结构化错误 → 重查刷新 → 成功
    const staleRes = await executeTool('hash_edit', { path: rel, hash: goodHash, newContent: 'x' });
    console.debug('[C3] HASH_STALE ->', JSON.stringify(staleRes));
    if (staleRes && staleRes.code === 'HASH_STALE') ok('C3 失配返回 HASH_STALE 结构化');
    else ng(`C3 未返回 HASH_STALE: ${JSON.stringify(staleRes)}`);
    const cur = await fsRead(file, 'utf8');
    const freshHash = hashline(cur.split('\n')[1]);
    const recover = await executeTool('hash_edit', { path: rel, hash: freshHash, newContent: 'const API_KEY = process.env.FIXED;' });
    if (recover && recover.line === 1) ok('C3 重查刷新 hash 后自修成功');
    else ng(`C3 自修失败: ${JSON.stringify(recover)}`);

    // C4: 验证文件内容闭环
    const final = await fsRead(file, 'utf8');
    console.debug('[C4] verify');
    if (final.includes('process.env.FIXED') && !final.includes('"OLD"')) ok('C4 文件内容闭环正确');
    else ng(`C4 内容错: ${final}`);

    await rm(TMP, { recursive: true, force: true }).catch(() => {});
    return { ok: true, info: log.join('; ') };
  } catch (e) {
    await rm(TMP, { recursive: true, force: true }).catch(() => {});
    return { ok: false, info: e.message };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  test().then((r) => { console.log(`\n${NAME}\n${r.ok ? '✓ PASS' : '✗ FAIL'}: ${r.info}`); process.exit(r.ok ? 0 : 1); });
}
