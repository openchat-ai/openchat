// failure-analyzer.mjs — 把 run result 分类, 决定能不能 auto-retry
//
// 分类:
//   - success:  exit 0           → 不重试
//   - transient: SIGTERM/SIGKILL → 重试 (可能是 OOM / 外部 kill / timeout)
//   - code:      其它非 0 exit   → 不重试 (真 bug, 修代码)
//   - config:    spawn 失败      → 不重试 (binary 缺失 / 路径错 / 权限)
//
// 输出 Classification: { category, reason, retryable }
// 后续 P3 可加 stderr 文本分析 (e.g. "rate limit", "API key invalid") 进一步细分

export function classify(runResult) {
  // runResult: { exitCode, signal, error? }
  if (runResult.error) {
    return {
      category: 'config',
      reason: `spawn error: ${runResult.error}`,
      retryable: false,
    };
  }
  if (runResult.signal === 'SIGTERM' || runResult.signal === 'SIGKILL' || runResult.signal === 'SIGABRT') {
    return {
      category: 'transient',
      reason: `killed by ${runResult.signal} (likely OOM / external kill / timeout)`,
      retryable: true,
    };
  }
  if (runResult.exitCode === 0) {
    return { category: 'success', reason: 'exit 0', retryable: false };
  }
  // exit code 143 = 128 + SIGTERM(15) — 子进程被系统 kill, 大概率超时/OOM
  // 归为 transient 以触发 auto-retry
  if (runResult.exitCode === 143) {
    return {
      category: 'transient',
      reason: 'exit code 143 (SIGTERM) — likely timeout / OOM',
      retryable: true,
    };
  }
  if (runResult.exitCode === null) {
    // 没 exit code 也没 signal — 异常
    return { category: 'unknown', reason: 'no exit code or signal', retryable: false };
  }
  return {
    category: 'code',
    reason: `exit code ${runResult.exitCode}`,
    retryable: false,
  };
}
