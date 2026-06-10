// lib/mock-backends.mjs — 60.mjs 用的 mock backend (LLM 实际调的对象)
// 行为确定性, 无副作用, 无网络

import { ERROR_KIND } from './retry-state.mjs';

// === invariants ===
// - 同一实例多次 call(), 内部 count 自增
// - 返回 shape: { ok: bool, error?: Error, kind?: ERROR_KIND, data?: any }
// - kind 仅在 ok=false 时有意义, ok=true 时省略

// 行为: 前 failTimes 次 fail transient, 之后 success
export function mockFlaky({ failTimes = 2 } = {}) {
  let count = 0;
  return async function call() {
    count++;
    if (count <= failTimes) {
      const err = new Error(`mockFlaky transient #${count}`);
      err.code = 'ETIMEDOUT';
      return { ok: false, error: err, kind: ERROR_KIND.TRANSIENT };
    }
    return { ok: true, data: { count } };
  };
}

// 行为: 第 1 次 fail, 之后 success — 用于改 kind 测试
export function mockFailOnce({ kind = ERROR_KIND.THRESHOLD } = {}) {
  let count = 0;
  return async function call() {
    count++;
    if (count === 1) {
      const err = new Error(`mockFailOnce ${kind} #1`);
      return { ok: false, error: err, kind };
    }
    return { ok: true, data: { count } };
  };
}

// 行为: 永远 fail transient
export function mockAlwaysFail() {
  let count = 0;
  return async function call() {
    count++;
    const err = new Error(`mockAlwaysFail 500 #${count}`);
    err.code = 500;
    return { ok: false, error: err, kind: ERROR_KIND.TRANSIENT };
  };
}
