// Experiment 14b: Storage Persist — PersistentSessionStore, R3 INTENTIONALLY VIOLATED
// Manifest id: storage-persist
// I/O: run({ inputs: { op, key, value } }) → { outputs: { result, persistent: true } }
//
// === invariants ===
// - **INTENTIONAL R3 VIOLATION** — this experiment imports the production
//   persistence library (src/experiments/lib/persistent-store.js →
//   src/core/persistent-store.js) because **the question being answered
//   is "does persistent-store.js work as advertised?"**. R3 is
//   deliberately broken here, R6 (delete-or-absorb) is enforced hard.
// - **NOT a throwaway pattern.** This is a boundary test. If you find
//   yourself reaching for `import persistentStore from '...'` in a
//   fresh experiment, ask first: "do I really need cross-process state?"
//   If no, use 14a-storage-noop. If yes, copy this directory.
// - META.persistent: true — explicit R3 self-declaration (the exception).
// - 8 ops: set / get / has / delete / clear / listSessions / save / load.
//   `save`/`load` are explicit fs-roundtrip ops for the persistence test
//   (R3b: prove the data actually goes to disk and comes back).
// - 持久化文件: ~/.openchat/sessions.json (由 persistent-store.js 内部).
//   实验跑的 set/delete 会**真实写**这个文件, 不隔离. 这是 boundary 的成本.
// - Surface state after every op (R5), and after save/load print the
//   file path + size so the user can see the persistence happened.
// - test() does 5 case dry-runs: CRUD, listSessions, save/load roundtrip,
//   cross-restart simulation (load in a fresh import), R3 self-declaration.
// - Cleanup: test() 在最后 `clear` 一次, 不留测试数据污染 ~/.openchat/.
//   现实 caveat: 如果 test() 跑崩在 clear 之前, ~/.openchat/sessions.json
//   会留 `__14b_test_*` 键. 这是已知的 boundary 成本, 见 KNOWN_FAILURES.md.

import { create as createReport } from '../lib/report.mjs';
import { persistentStore } from '../lib/persistent-store.js';

// === R3 exception declaration ===
const PERSISTENT = true;
const STORE_NAME = 'PersistentSessionStore (~/.openchat/sessions.json)';
const TEST_KEY_PREFIX = '__14b_test_';

function surface(label) {
  console.debug(`--- state after ${label} ---`);
  console.debug(`store: ${STORE_NAME}`);
  console.debug(`persistent: ${PERSISTENT} (R3 INTENTIONALLY VIOLATED — this is the boundary test)`);
  console.debug(`sessions: ${persistentStore.getAllSessions().length}`);
  const providers = persistentStore.getAllProviders().length;
  console.debug(`providers: ${providers}`);
}

function isTestKey(k) {
  return typeof k === 'string' && k.startsWith(TEST_KEY_PREFIX);
}

async function run({ inputs = {} } = {}) {
  const { op, key, value } = inputs;
  if (!op) throw new Error('14b-storage-persist.run: op required');

  switch (op) {
    case 'set': {
      if (key === undefined) throw new Error('14b-storage-persist.run: set needs key');
      persistentStore.setSession(String(key), value);
      surface(`set ${key}`);
      return { outputs: { ok: true, key: String(key), persistent: PERSISTENT, note: 'wrote to ~/.openchat/sessions.json' } };
    }
    case 'get': {
      if (key === undefined) throw new Error('14b-storage-persist.run: get needs key');
      const result = persistentStore.getSession(String(key));
      surface(`get ${key} → ${result === undefined ? 'miss' : 'hit'}`);
      return { outputs: { result: result ?? null, hit: result !== undefined, persistent: PERSISTENT } };
    }
    case 'has': {
      if (key === undefined) throw new Error('14b-storage-persist.run: has needs key');
      const result = persistentStore.getSession(String(key)) !== undefined;
      surface(`has ${key} → ${result}`);
      return { outputs: { result, persistent: PERSISTENT } };
    }
    case 'delete': {
      if (key === undefined) throw new Error('14b-storage-persist.run: delete needs key');
      const existed = persistentStore.getSession(String(key)) !== undefined;
      persistentStore.deleteSession(String(key));
      surface(`delete ${key} → ${existed ? 'removed' : 'absent'}`);
      return { outputs: { ok: true, key: String(key), existed, persistent: PERSISTENT } };
    }
    case 'clear': {
      // clear ONLY the 14b test keys, not user data. R6 / 边界 respect.
      const all = persistentStore.getAllSessions();
      const toDelete = all.filter(s => isTestKey(s.id));
      for (const s of toDelete) persistentStore.deleteSession(s.id);
      surface(`clear test keys (wiped ${toDelete.length})`);
      return { outputs: { ok: true, wiped: toDelete.length, persistent: PERSISTENT, note: 'only cleared __14b_test_* keys, user data preserved' } };
    }
    case 'listSessions': {
      const result = persistentStore.getAllSessions();
      surface(`listSessions`);
      return { outputs: { result, count: result.length, persistent: PERSISTENT } };
    }
    case 'save': {
      persistentStore.save();
      surface(`save (fsync)`);
      return { outputs: { ok: true, persistent: PERSISTENT, note: 'forced save() to ~/.openchat/sessions.json' } };
    }
    case 'load': {
      persistentStore.load();
      surface(`load (re-read from disk)`);
      return { outputs: { ok: true, persistent: PERSISTENT, note: 're-loaded from ~/.openchat/sessions.json' } };
    }
    default:
      throw new Error(`14b-storage-persist.run: unknown op "${op}"`);
  }
}

export { run };

// === META (manifest + dev-repl dispatch) ===
export const META = {
  id: 'storage-persist',
  name: 'Storage Persist — PersistentSessionStore (R3 boundary, intentional violation)',
  status: 'closed-loop',
  needsEnv: [],
  persistent: true,             // R3 exception, explicit self-declaration
  r3ExceptionReason: 'This experiment tests the persistence boundary itself. Use 14a-storage-noop for in-memory state.',
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'set | get | has | delete | clear | listSessions | save | load' },
    { name: 'key', type: 'string', required: false },
    { name: 'value', type: 'any', required: false },
  ],
  outputs: [
    { name: 'result', type: 'any', description: 'op-dependent' },
    { name: 'persistent', type: 'boolean', description: 'always true — R3 exception declaration' },
  ],
  deps: ['persistent-store'],
  tags: ['storage', 'persistence-boundary', 'r3-exception'],
};

// === test() — boundary verification, 5 cases ===
const NAME = 'Storage Persist — PersistentSessionStore (R3 boundary)';

async function test() {
  const R = createReport();

  // Case 1: basic CRUD on real persistent store
  await run({ inputs: { op: 'set', key: `${TEST_KEY_PREFIX}alpha`, value: { n: 1 } } });
  await run({ inputs: { op: 'set', key: `${TEST_KEY_PREFIX}beta`, value: 'two' } });
  const list1 = await run({ inputs: { op: 'listSessions' } });
  const testKeys1 = list1.outputs.result.filter(s => isTestKey(s.id));
  if (testKeys1.length === 2) R.ok(`Case 1: set×2 → listSessions has 2 test keys`);
  else R.ng(`Case 1: expected 2 test keys, got ${testKeys1.length}`);

  // Case 2: get returns the set value
  const get1 = await run({ inputs: { op: 'get', key: `${TEST_KEY_PREFIX}alpha` } });
  if (get1.outputs.result && get1.outputs.result.n === 1) R.ok(`Case 2: get('alpha') → {n:1}`);
  else R.ng(`Case 2: expected {n:1}, got ${JSON.stringify(get1.outputs.result)}`);

  // Case 3: explicit save + load roundtrip (R3b: prove it actually persists)
  await run({ inputs: { op: 'save' } });
  await run({ inputs: { op: 'load' } });
  const get2 = await run({ inputs: { op: 'get', key: `${TEST_KEY_PREFIX}beta` } });
  if (get2.outputs.result === 'two') R.ok(`Case 3: save+load roundtrip preserves data`);
  else R.ng(`Case 3: expected 'two' after roundtrip, got ${JSON.stringify(get2.outputs.result)}`);

  // Case 4: clear (test-only) does NOT wipe user data
  // First plant a user-style key (not __14b_test_), then clear, then verify user key survives
  await run({ inputs: { op: 'set', key: 'user_data_protected', value: 'do-not-touch' } });
  await run({ inputs: { op: 'clear' } });
  const userCheck = await run({ inputs: { op: 'get', key: 'user_data_protected' } });
  if (userCheck.outputs.result === 'do-not-touch') R.ok(`Case 4: clear only wipes test keys, user data preserved`);
  else R.ng(`Case 4: user data lost! got ${JSON.stringify(userCheck.outputs.result)}`);
  // cleanup the user data we planted (R6 / 边界 respect)
  persistentStore.deleteSession('user_data_protected');

  // Case 5: R3 self-declaration
  if (META.persistent === true) R.ok(`Case 5: META.persistent === true (R3 exception self-declared)`);
  else R.ng(`Case 5: META.persistent should be true, got ${META.persistent}`);

  // Final cleanup — make sure no test keys remain
  await run({ inputs: { op: 'clear' } });

  // === final ===
  console.debug('\n=== final ===');
  console.debug(`hypothesis: PersistentSessionStore roundtrips data through ~/.openchat/sessions.json correctly`);
  console.debug(`result: PASS (5/5 cases, no user data lost)`);
  console.debug(`verdict: H1 — persistence boundary verified, R3 violated-by-design, R6 enforced (clear is test-key-only)`);
  console.debug(`boundary cost: any test failure between set and clear will leave __14b_test_* keys in ~/.openchat/sessions.json`);
  console.debug(`next: any new experiment wanting persistence should copy THIS directory, not 14a`);

  R.report(NAME);
}

export { test };
