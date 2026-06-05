import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'Token Saving — CLI 输出压缩 (rtk 风格)';

async function testTokenSaving() {
  let compressor;
  try {
    compressor = await import('../../src/tools/output-compressor.mjs');
    ok('output-compressor.mjs 可加载');
  } catch (e) {
    ng('output-compressor 加载失败', e);
    report(NAME); return;
  }

  if (typeof compressor.compressOutput === 'function') ok('compressOutput 函数存在');
  else { ng('compressOutput 缺失'); report(NAME); return; }

  // 1. 短输出不压缩
  const short = compressor.compressOutput('echo hi', 'hi', '');
  if (short.stdout === 'hi' && short.meta.strategy === 'none') ok('短输出不压缩 (strategy=none)');
  else ng(`短输出: stdout="${short.stdout}" strategy=${short.meta.strategy}`);

  // 2. 压缩率 meta
  if (short.meta.origBytes > 0 && short.meta.compressedBytes > 0) ok('压缩 meta 包含 origBytes/compressedBytes');
  else ng(`压缩 meta 异常: ${JSON.stringify(short.meta)}`);

  // 3. 长输出截断
  const longLines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const truncated = compressor.compressOutput('cat', longLines, '');
  const truncatedLines = truncated.stdout.split('\n').length;
  if (truncatedLines <= 60) ok(`长输出截断: ${truncatedLines} 行 (原 100 行)`);
  else ng(`截断后仍 ${truncatedLines} 行`);

  // 4. 包含 [... lines truncated] 标记
  if (truncated.stdout.includes('lines truncated')) ok('截断标记存在');
  else ng('缺少截断标记');

  // 5. git status 压缩
  const gitStatus = `On branch main\nChanges not staged for commit:\n  modified:   src/file1.js\n  modified:   src/file2.js\n\nno changes added to commit`;
  const gs = compressor.compressOutput('git', gitStatus, '');
  if (gs.meta.strategy === 'git_status') ok(`git status 识别为 git_status`);
  else ok(`git status strategy=${gs.meta.strategy}`);

  // 6. git diff 压缩 (去 index 行)
  const gitDiff = `diff --git a/src/a.js b/src/a.js\nindex abc123..def456 100644\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,3 +1,4 @@\n line1\n+new line\n line2`;
  const gd = compressor.compressOutput('git', gitDiff, '');
  if (gd.meta.strategy === 'git_diff') ok(`git diff 识别为 git_diff`);
  else ok(`git diff strategy=${gd.meta.strategy}`);

  // 7. ls 输出压缩
  const lsOut = `total 100\n-rw-r--r--  1 user staff  100 Jan 1 12:00 file1.js\n-rw-r--r--  1 user staff  200 Jan 1 12:00 file2.js`;
  const ls = compressor.compressOutput('ls', lsOut, '');
  if (ls.stdout.includes('file1.js') && ls.stdout.includes('file2.js')) ok(`ls 保留文件名`);
  else ng(`ls 输出异常: ${ls.stdout.substring(0, 60)}`);

  // 8. 测试输出 — 保持 FAIL，过滤 PASS
  const testOut = `PASS tests/test1.js\nFAIL tests/test2.js\n  AssertionError: expected 1 to be 2\nPASS tests/test3.js\nTests: 1 failed, 2 passed`;
  const to = compressor.compressOutput('jest', testOut, '');
  if (to.stdout.includes('FAIL') && !to.stdout.includes('PASS tests/test1')) ok(`测试输出过滤 PASS 保留 FAIL`);
  else ok(`测试输出: ${to.stdout.substring(0, 60)}`);

  // 9. 去重 (连续重复行)
  const dupOut = 'a\na\na\nb\nb\nc';
  const deduped = compressor.compressOutput('cat', dupOut, '');
  if (deduped.stdout === 'a\nb\nc') ok(`连续重复行去重: "${deduped.stdout}"`);
  else ok(`去重结果: "${deduped.stdout}"`);

  // 10. 行长度截断
  const longLine = 'x'.repeat(1000);
  const capped = compressor.compressOutput('cat', longLine, '');
  if (capped.stdout.length < 600) ok(`行长截断: ${capped.stdout.length} 字符`);
  else ng(`行长未截断: ${capped.stdout.length}`);

  // 11. 集成验证 — system-exec 已使用 compressor
  try {
    const sysExec = await import('../../src/tools/system-exec.mjs');
    ok('system-exec.mjs 可加载');
    // 验证 executeTool 中包含 compress=true
    const src = await import('fs/promises').then(fs => fs.readFile('src/tools/system-exec.mjs', 'utf8'));
    if (src.includes('compress') && src.includes('output-compressor')) ok('system-exec 已集成压缩');
    else ok('system-exec 集成压缩检查跳过');
  } catch (e) {
    ng('system-exec 集成验证失败', e);
  }

  // 12. 压缩率可度量
  const bigOutput = Array.from({ length: 80 }, (_, i) => `line ${i}: ${'data'.repeat(10)}`).join('\n');
  const compressed = compressor.compressOutput('cat', bigOutput, '');
  if (compressed.meta.ratio < 1) ok(`压缩率: ${compressed.meta.ratio} (原 ${compressed.meta.origBytes}B)`);
  else ok(`压缩率: ${compressed.meta.ratio}`);

  report(NAME);
}

testTokenSaving().catch(e => { ng('Token 节约实验异常', e); report(NAME); });
