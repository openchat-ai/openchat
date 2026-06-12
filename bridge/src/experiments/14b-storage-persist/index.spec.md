# spec: 14b-storage-persist
> **Status**: P0 — design-spec R3 EXCEPTION. Sister to 14a-storage-noop. This is the intentional R3 violation; 14a is the clean R3 positive.
> **R3 status**: INTENTIONALLY VIOLATED. R6 (delete-or-absorb) is enforced: META.persistent=true, META.r3ExceptionReason is required.
> **Sister experiment**: `14a-storage-noop` — same ops, in-memory only.

## 假设

- H0 (零假设): PersistentSessionStore doesn't actually roundtrip data through `~/.openchat/sessions.json` — read-after-write fails, file format breaks, etc.
- H1 (备择假设): PersistentSessionStore correctly persists sessions + providers to JSON files, supports CRUD + save/load + listSessions, and `load()` reconstructs the in-memory Map from disk.

## 数据流

```
inputs: { op, key, value }
  ↓
switch on op
  ↓
persistentStore.{setSession|getSession|deleteSession|save|load|getAllSessions}
  ↓
fs.writeFileSync / fs.readFileSync to ~/.openchat/sessions.json
  ↓
outputs: { result | {ok, key, size}, persistent: true, note: 'wrote to ~/.openchat/...' }
  ↓
console.log state via `---` separator (R5)
```

## 接口签名

```js
// 输入
{
  op:    'set' | 'get' | 'has' | 'delete' | 'clear' | 'listSessions' | 'save' | 'load',
  key?:  string,
  value?: any,
}

// 输出
{
  result?:     any,         // get→value|null, has→bool, listSessions→array
  ok?:         boolean,     // set/delete/clear/save/load
  key?:        string,
  count?:      number,      // listSessions only
  existed?:    boolean,     // delete only
  wiped?:      number,      // clear only
  persistent:  true,        // R3 EXCEPTION declaration, present in EVERY output
  note?:       string,      // human-readable hint (e.g. 'wrote to ~/.openchat/sessions.json')
}
```

## 6 Hard Rules 自评 (design-spec audit)

```
R1 throwaway  ............ 2/5  // 路径 experiments/14b-storage-persist/index.mjs, 但 persistent=true
                                // 违反 throwaway 默认, 是 R6 exception, R1 部分满足 (路径对, 头部声明对)
R2 one-cmd    ............ 5/5  // node src/experiments/14b-storage-persist/test.mjs 一行可跑
R3 no-persist ............ 0/5  // **故意违反**: META.persistent=true, 真实写 ~/.openchat/
                                // 这是 R3 exception, 不是 bug. R6 接管, 强制声明 r3ExceptionReason
R4 skip-polish ............ 5/5  // 8 op + 5 test case, ~150 行, 无 class/strategy/factory
R5 surface-state .......... 5/5  // 每次 surface() 打印完整 state, 含 === final === block, 含 boundary cost 警告
R6 delete-or-absorb ....... 5/5  // 强制: clear() 只清 __14b_test_* 键, 不动 user data
                                // META.persistent=true + META.r3ExceptionReason 显式声明 R3 exception
                                // 跑完 clean up, 不污染 ~/.openchat/ 的 user 键
                            ─────
总分: 22/30  // R3 故意违 (0/5), R1 因 R3 exception 减分 (2/5)
                其它 4 条全满分
                这是 design-spec 期望的 "R3 boundary 强声明 + R6 强化" 形态
```

## 边界条件

- `inputs.op` 缺失 → throw `14b-storage-persist.run: op required`
- `inputs.op='set'` 且 `key` 缺失 → throw `set needs key`
- `inputs.op='get'` 且 key 不存在 → 返回 `{result: null, hit: false, persistent: true}`, 不 throw
- `inputs.op='clear'` → **只**清 `__14b_test_*` 前缀的键, **不**动 user data. 这是 R6 强约束.
- `~/.openchat/sessions.json` 不存在 → PersistentSessionStore.load() 静默吞错, getAllSessions 返回 [], 不抛
- 写入失败 (e.g. 磁盘满 / 权限) → persistent-store.js 内部 try/catch 吞, 输出仍返回 {ok:true}, 这是库的行为, 不是 14b 的 bug
- 进程退出后, 数据**真的**在 `~/.openchat/sessions.json` 里. 下次进程启动, `load()` 会读回. 这是 R3 violation 的成本.

## 副作用 (boundary cost)

- **真实写 `~/.openchat/sessions.json`** — 不隔离, 不沙箱. 跟生产配置共用文件.
- **前缀隔离**: 所有测试数据用 `__14b_test_` 前缀, `clear()` 只清这个前缀, **不**碰 user data.
- **崩溃残留**: 如果 test() 在 clear 之前崩了, 残留 `__14b_test_*` 键. 检测:
  ```bash
  grep '__14b_test_' ~/.openchat/sessions.json
  ```
  清理: `node -e "import('./src/experiments/14b-storage-persist/index.mjs').then(m => m.run({inputs:{op:'clear'}}))"`
- **不**写 `~/.openchat/providers.json` (那是 provider-service 的, 14b 不碰).

## 文件清单

- `src/experiments/14b-storage-persist/index.mjs` — 主实验 (run/test/META, 真实 persistent-store.js)
- `src/experiments/14b-storage-persist/test.mjs` — 5 case boundary verification 入口
- `src/experiments/14b-storage-persist/index.spec.md` — 本 spec 文件
- `src/experiments/manifest.json` — 注册 storage-persist entry (id=storage-persist, file=14b-storage-persist/index.mjs, persistent:true)

## 何时用 14a vs 14b (再强调)

| 场景 | 14a | 14b |
|------|-----|-----|
| Throwaway 临时 state | **是** | 反模式 |
| Process-local 缓存 | **是** | 反模式 |
| 测试 14a-vs-14b 边界 | n/a | **是** |
| Session 跨进程 / 重启恢复 | 反模式 | **是** |
| Provider 配置持久化 | n/a | 用 src/core/persistent-config.js (production), 不是 14b |
| **临时脚本用 14b** | **严拒** | **严拒** |

**反模式警告 (2 条)**:
1. 临时 throwaway 脚本用 14b = 偷偷持久化到 `~/.openchat/`, 违反 prototype 原则.
2. 14b 写到 `~/.openchat/sessions.json`, 跟 production 共用文件. 高频跑测试 = 写放大. 别在 run-all 里跑 14b 的 test(), 那是 14b test.mjs 一次跑一次.

## 测试

5 case dry-run, 全部 expect pass:
- Case 1: set×2 → listSessions has 2 test keys
- Case 2: get returns the set value
- Case 3: save+load roundtrip preserves data
- Case 4: clear only wipes test keys, user data preserved
- Case 5: META.persistent === true
