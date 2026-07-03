// Experiment 46: edit-gate — 编辑审查门（Cursor 式 Diff + Accept/Reject 的确定性版）
// 见 46.spec.md / ROADMAP-CURSOR.md §7。
//
// === invariants ===
// - previewEdit 为 dry-run：调用后文件内容必须不变（本 test 断言）
// - accept 路径 = applyEdit 落盘；reject 路径 = 不调 applyEdit，文件不变
// - 所有编辑作用于临时目录，绝不触碰真实源码

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { writeFile, readFile as fsRead, rm, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { previewEdit, unifiedDiff, applyEdit, isWriteTool } from './lib/edit-gate.mjs';

export const META = { id: 'edit-gate' };
const NAME = 'edit-gate — 编辑审查门（Diff + Accept/Reject）';

const hashline = (l) => createHash('md5').update(l).digest('hex').slice(0, 8);
const stripAnsi = (s) => s.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
const TMP = resolve(fileURLToPath(new URL('.', import.meta.url)), '_tmp_edit_gate');

export async function run() {
  return { outputs: { info: `isWriteTool(hash_edit)=${isWriteTool('hash_edit')} dna_query=${isWriteTool('dna_query')}` } };
}

export async function test() {
  const log = [];
  const ok = (m) => log.push('✓ ' + m);
  const ng = (m) => { throw new Error(m + ' | ' + log.join('; ')); };
  try {
    // 分类：只读工具不过门，写工具过门
    if (isWriteTool('hash_edit') && isWriteTool('edit_file') && !isWriteTool('dna_query') && !isWriteTool('read_file')) ok('工具分类正确（写过门，只读直通）');
    else ng('isWriteTool 分类错');

    await mkdir(TMP, { recursive: true });
    const file = resolve(TMP, 'target.js');
    const rel = file.replace(process.cwd(), '').replace(/^[/\\]/, '');
    const target = 'const API_KEY = "OLD";';
    const original = ['// header', target, 'export const x = 1;'].join('\n');
    await writeFile(file, original, 'utf8');

    // C1: previewEdit dry-run（命中）→ before/after 正确，且文件未改
    const pv = await previewEdit('hash_edit', { path: rel, hash: hashline(target), newContent: 'const API_KEY = process.env.KEY;' });
    console.debug('[C1] previewEdit ok=', pv.ok, 'line=', pv.line);
    if (pv.ok && pv.before === original && /process\.env\.KEY/.test(pv.after)) ok('C1 previewEdit before/after 正确');
    else ng(`C1 previewEdit 异常: ${JSON.stringify(pv).slice(0, 120)}`);
    const afterPreview = await fsRead(file, 'utf8');
    if (afterPreview === original) ok('C1 dry-run 未落盘（文件不变）');
    else ng('C1 dry-run 竟改了文件');

    // C2: unifiedDiff 含 -旧行 +新行
    const diff = stripAnsi(unifiedDiff(pv.before, pv.after, rel));
    console.debug('[C2] diff:\n' + diff);
    if (/-\s*const API_KEY = "OLD";/.test(diff) && /\+\s*const API_KEY = process\.env\.KEY;/.test(diff)) ok('C2 unifiedDiff 标注 -旧 +新');
    else ng(`C2 diff 异常: ${diff}`);

    // C3: previewEdit 失配 → HASH_STALE
    const stale = await previewEdit('hash_edit', { path: rel, hash: 'deadbeef', newContent: 'x' });
    console.debug('[C3] HASH_STALE code=', stale.code);
    if (!stale.ok && stale.code === 'HASH_STALE') ok('C3 失配返回 HASH_STALE');
    else ng(`C3 未返回 HASH_STALE: ${JSON.stringify(stale)}`);

    // C4a: reject 路径 — 不调 applyEdit，文件不变
    const beforeReject = await fsRead(file, 'utf8');
    if (beforeReject === original) ok('C4 reject（不 apply）文件不变');
    else ng('C4 reject 文件竟变了');
    // C4b: accept 路径 — applyEdit 落盘，文件变
    await applyEdit('hash_edit', { path: rel, hash: hashline(target), newContent: 'const API_KEY = process.env.KEY;' });
    const afterApply = await fsRead(file, 'utf8');
    if (afterApply.includes('process.env.KEY') && !afterApply.includes('"OLD"')) ok('C4 accept（apply）文件已落盘');
    else ng(`C4 accept 落盘失败: ${afterApply}`);

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
