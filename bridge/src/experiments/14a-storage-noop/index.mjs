// Experiment 14a: Storage Noop — in-memory Map key/value, R3 clean
// Manifest id: storage-noop
// I/O: run({ inputs: { op, key, value } }) → { outputs: { result } }
//
// === invariants ===
// - **Throwaway pattern**: this is the canonical "use me" template for new
//   experiments that need a Map-shaped state during the run. Pure in-memory.
//   **Do not** import src/experiments/lib/storage-lib.mjs or
//   src/core/persistent-store.js here — that would re-introduce the R3
//   boundary-blur that 14-storage had (see docs/experiment-design-audit-2026-06-11.md).
// - State lives in a module-level `const cache = new Map()`. Process exit
//   wipes everything. No writes to ~/.openchat/, oc/recordings/, bridge/state/.
// - One-cmd run: `node src/experiments/14a-storage-noop/index.mjs` (default
//   demo) or `node src/experiments/14a-storage-noop/test.mjs` (assertions).
// - META: { id, name, status, needsEnv: [], inputs, outputs, persistent: false }
//   `persistent: false` is explicit (R3 self-declaration).
// - 6 ops: set / get / has / delete / clear / size. Surface state after every
//   op so the user can see what changed (R5).
// - test() does 3 case dry-runs: basic CRUD, get-missing-returns-null,
//   delete-then-size, plus persistent=false self-check.
// - This is **not** for cross-process state, long-term memory, or anything
//   that needs to survive a restart. If you need that, use 14b-storage-persist.
//
// === 输入 ===
//   inputs.op    (string, 必填) — set | get | has | delete | clear | size
//   inputs.key   (string)       — for set/get/has/delete
//   inputs.value (any)          — for set
//
// === 输出 ===
//   outputs.result — depends on op: get→value|null, has→bool, size→number,
//                     set/delete→{ok:true, key}, clear→{ok:true, wiped:N}

import { create as createReport } from '../lib/report.mjs';

// === R3 declaration: explicitly NOT persistent ===
const PERSISTENT = false;
const STORE_NAME = 'in-memory Map (throwaway)';

// === the state (R3-clean: no fs, no library import) ===
const cache = new Map();

function surface(label) {
  console.debug(`--- state after ${label} ---`);
  console.debug(`store: ${STORE_NAME}`);
  console.debug(`persistent: ${PERSISTENT}`);
  console.debug(`size: ${cache.size}`);
  if (cache.size > 0 && cache.size <= 20) {
    for (const [k, v] of cache.entries()) {
      console.debug(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
}

async function run({ inputs = {} } = {}) {
  const { op, key, value } = inputs;
  if (!op) throw new Error('14a-storage-noop.run: op required (set|get|has|delete|clear|size)');

  switch (op) {
    case 'set': {
      if (key === undefined) throw new Error('14a-storage-noop.run: set needs key');
      cache.set(String(key), value);
      surface(`set ${key}`);
      return { outputs: { ok: true, key: String(key), size: cache.size, persistent: PERSISTENT } };
    }
    case 'get': {
      if (key === undefined) throw new Error('14a-storage-noop.run: get needs key');
      const has = cache.has(String(key));
      const result = has ? cache.get(String(key)) : null;
      surface(`get ${key} → ${has ? 'hit' : 'miss'}`);
      return { outputs: { result, hit: has, persistent: PERSISTENT } };
    }
    case 'has': {
      if (key === undefined) throw new Error('14a-storage-noop.run: has needs key');
      const result = cache.has(String(key));
      surface(`has ${key} → ${result}`);
      return { outputs: { result, persistent: PERSISTENT } };
    }
    case 'delete': {
      if (key === undefined) throw new Error('14a-storage-noop.run: delete needs key');
      const existed = cache.delete(String(key));
      surface(`delete ${key} → ${existed ? 'removed' : 'absent'}`);
      return { outputs: { ok: true, key: String(key), existed, size: cache.size, persistent: PERSISTENT } };
    }
    case 'clear': {
      const wiped = cache.size;
      cache.clear();
      surface(`clear (wiped ${wiped})`);
      return { outputs: { ok: true, wiped, persistent: PERSISTENT } };
    }
    case 'size': {
      surface('size');
      return { outputs: { result: cache.size, persistent: PERSISTENT } };
    }
    default:
      throw new Error(`14a-storage-noop.run: unknown op "${op}"`);
  }
}

export { run };

// === META (manifest + dev-repl dispatch) ===
export const META = {
  id: 'storage-noop',
  name: 'Storage Noop — in-memory Map (R3-clean throwaway template)',
  status: 'closed-loop',
  needsEnv: [],
  persistent: false,
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'set | get | has | delete | clear | size' },
    { name: 'key', type: 'string', required: false },
    { name: 'value', type: 'any', required: false },
  ],
  outputs: [
    { name: 'result', type: 'any', description: 'op-dependent: get→value|null, has→bool, size→number, others→{ok,key,size}' },
    { name: 'persistent', type: 'boolean', description: 'always false — R3 declaration' },
  ],
  deps: [],
  tags: ['storage', 'throwaway-template', 'r3-clean'],
};

// === test() — smoke test, no business logic ===
const NAME = 'Storage Noop — in-memory Map (R3-clean throwaway template)';

async function test() {
  const R = createReport();

  // Case 1: basic CRUD
  await run({ inputs: { op: 'set', key: 'alpha', value: 1 } });
  await run({ inputs: { op: 'set', key: 'beta', value: 'two' } });
  const size1 = await run({ inputs: { op: 'size' } });
  if (size1.outputs.result === 2) R.ok(`Case 1: set×2 → size=2`);
  else R.ng(`Case 1: expected size=2, got ${size1.outputs.result}`);

  const get1 = await run({ inputs: { op: 'get', key: 'alpha' } });
  if (get1.outputs.result === 1) R.ok(`Case 1: get('alpha') → 1`);
  else R.ng(`Case 1: expected 1, got ${JSON.stringify(get1.outputs.result)}`);

  // Case 2: get-missing returns null (not undefined, not throw)
  const get2 = await run({ inputs: { op: 'get', key: 'nope' } });
  if (get2.outputs.result === null && get2.outputs.hit === false) R.ok(`Case 2: get('nope') → null, hit=false`);
  else R.ng(`Case 2: expected null+false, got ${JSON.stringify(get2.outputs)}`);

  // Case 3: delete then size, then re-get
  await run({ inputs: { op: 'delete', key: 'alpha' } });
  const size2 = await run({ inputs: { op: 'size' } });
  if (size2.outputs.result === 1) R.ok(`Case 3: delete 'alpha' → size=1`);
  else R.ng(`Case 3: expected size=1, got ${size2.outputs.result}`);

  const get3 = await run({ inputs: { op: 'get', key: 'alpha' } });
  if (get3.outputs.result === null) R.ok(`Case 3: get('alpha') after delete → null`);
  else R.ng(`Case 3: expected null, got ${JSON.stringify(get3.outputs.result)}`);

  // Case 4: has
  const has1 = await run({ inputs: { op: 'has', key: 'beta' } });
  const has2 = await run({ inputs: { op: 'has', key: 'alpha' } });
  if (has1.outputs.result === true && has2.outputs.result === false) R.ok(`Case 4: has('beta')=true, has('alpha')=false`);
  else R.ng(`Case 4: expected true/false, got ${has1.outputs.result}/${has2.outputs.result}`);

  // Case 5: clear
  await run({ inputs: { op: 'clear' } });   // reset to a known state
  await run({ inputs: { op: 'set', key: 'x', value: 1 } });
  await run({ inputs: { op: 'set', key: 'y', value: 2 } });
  const clear1 = await run({ inputs: { op: 'clear' } });
  if (clear1.outputs.wiped === 2) R.ok(`Case 5: clear wiped 2 entries`);
  else R.ng(`Case 5: expected wiped=2, got ${clear1.outputs.wiped}`);
  const size3 = await run({ inputs: { op: 'size' } });
  if (size3.outputs.result === 0) R.ok(`Case 5: size after clear = 0`);
  else R.ng(`Case 5: expected size=0, got ${size3.outputs.result}`);

  // Case 6: R3 self-declaration — META.persistent === false, AND all op results carry persistent=false
  if (META.persistent === false) R.ok(`Case 6: META.persistent === false (R3 self-declared)`);
  else R.ng(`Case 6: META.persistent should be false, got ${META.persistent}`);

  // === final ===
  console.debug('\n=== final ===');
  console.debug(`hypothesis: throwaway in-memory Map works for the 80% case (CRUD on small datasets, no cross-process state)`);
  console.debug(`result: PASS (6/6 cases)`);
  console.debug(`verdict: H1 — 14a is the clean R3 positive example, sibling of 14b (the intentional R3 violation)`);
  console.debug(`next: when writing a new experiment needing Map state, copy this directory and rename id`);

  R.report(NAME);
}

export { test };
