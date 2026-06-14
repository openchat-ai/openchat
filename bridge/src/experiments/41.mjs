import { test as test35 } from './35.mjs';
import { test as test36 } from './36.mjs';
import { test as test37 } from './37.mjs';
import { test as test38 } from './38.mjs';

const CHAIN = [
  { id: '35-chat-poller', fn: test35, name: 'Chat-Poller (walking-skeleton)' },
  { id: '36-poll-one', fn: test36, name: '复合实验 — qiniu+isolation+agent' },
  { id: '37-dream', fn: test37, name: '记忆归并引擎' },
  { id: '38-goal', fn: test38, name: '拆解目标 + 多轮执行' },
];

export async function test() {
  const errors = [];
  const results = [];

  for (const { id, fn, name } of CHAIN) {
    console.log(`\n  ▶ ${name}`);
    try {
      const r = await fn();
      // 有些实验用内部 report() 不返对象, 没抛就算过
      const ok = r === undefined || r === null || r.ok !== false;
      results.push({ id, ok, errors: r?.errors || [] });
      console.log(`    ${ok ? '✓' : '✗'} ${id}`);
      if (!ok && r?.errors) for (const e of r.errors) console.log(`      FAIL: ${e.slice(0, 100)}`);
    } catch (e) {
      results.push({ id, ok: false, errors: [e.message] });
      console.log(`    ✗ ${id} crash: ${e.message.slice(0, 100)}`);
    }
  }

  const pass = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\n  e2e chain: ${pass}/${total} passed`);
  if (pass < total) {
    for (const r of results) {
      if (!r.ok) errors.push(`${r.id} failed`);
    }
  }
  return { ok: pass === total, errors };
}
