import { on, runPre, runPost, listHooks, clear } from './lib/agent-hooks.mjs';
import { enableLoggingHook, enableRateLimitHook, getCallLog, clearCallLog } from './lib/hooks-builtin.mjs';

export async function test() {
  const errors = [];

  // 清理已有 hooks (避免影响其他实验)
  clear();

  // 1. preTool hook — permission deny
  const unsubDeny = on('preTool', 'test-deny', async (tool) => {
    if (tool === 'forbidden-tool') throw new Error('forbidden by test');
  });
  try {
    await runPre('forbidden-tool', {});
    errors.push('preTool: should have thrown for forbidden-tool');
  } catch (e) {
    if (!e.message.includes('forbidden')) errors.push('preTool: wrong error for forbidden-tool');
  }

  // 2. preTool hook — permission allow
  let allowed = false;
  await runPre('allowed-tool', {});
  allowed = true;
  if (!allowed) errors.push('preTool: allowed tool should not throw');

  unsubDeny();

  // 3. postTool hook — result transformation
  on('postTool', 'test-wrap', async (tool, args, result) => {
    return `[wrapped] ${result}`;
  });
  const postResult = await runPost('any-tool', {}, 'hello');
  if (postResult !== '[wrapped] hello') errors.push(`postTool: expected [wrapped] hello, got ${postResult}`);

  // 4. postTool chain — multiple hooks compose
  // test-wrap runs first (inserted first), wraps → '[wrapped] base'
  // test-wrap2 runs second, wraps again → '[wrapped] base (wrapped2)'
  on('postTool', 'test-wrap2', async (tool, args, result) => {
    return `${result} (wrapped2)`;
  });
  const chainResult = await runPost('any-tool', {}, 'base');
  if (chainResult !== '[wrapped] base (wrapped2)') errors.push(`postTool chain: wrong result: ${chainResult}`);

  // 5. listHooks — test-deny was unsubscribed, test-wrap remains
  const hooksBeforeClear = listHooks();
  if (hooksBeforeClear.preTool?.includes('test-deny')) errors.push('listHooks: test-deny should have been unsubscribed');
  if (!hooksBeforeClear.postTool?.includes('test-wrap')) errors.push('listHooks: missing test-wrap in postTool');
  if (!hooksBeforeClear.postTool?.includes('test-wrap2')) errors.push('listHooks: missing test-wrap2 in postTool');

  // 6. built-in logging hook
  clearCallLog();
  enableLoggingHook();
  await runPre('log-me', { x: 1 });
  await runPost('log-me', { x: 1 }, 'result');
  const log = getCallLog();
  if (log.length !== 2) errors.push(`logging hook: expected 2 entries, got ${log.length}`);
  else {
    if (log[0].type !== 'pre') errors.push('logging hook: first entry should be pre');
    if (log[0].tool !== 'log-me') errors.push(`logging hook: expected tool log-me, got ${log[0].tool}`);
    if (log[1].type !== 'post') errors.push('logging hook: second entry should be post');
  }

  // 7. built-in rate limit hook
  clear();
  const unsubRate = enableRateLimitHook(3);
  await runPre('a', {}); // 1
  await runPre('b', {}); // 2
  await runPre('c', {}); // 3
  try {
    await runPre('d', {}); // should exceed limit
    errors.push('rate-limit: should have thrown on 4th call');
  } catch (e) {
    if (!e.message.includes('Rate limit')) errors.push(`rate-limit: wrong error: ${e.message}`);
  }
  unsubRate();

  // 8. preTool hook exception — not throw, passes through to postTool cleanup
  clear();

  // 9. clear works
  clear();
  const afterClear = listHooks();
  if (afterClear.preTool?.length || afterClear.postTool?.length) errors.push('clear: hooks should be empty after clear');

  return { ok: errors.length === 0, errors };
}
