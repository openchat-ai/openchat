# spec: 14a-storage-noop
> **Status**: P0 — design-spec R3 positive example. Splits the old `27.mjs` (manifest id `storage`) into a clean R3 throwaway + a separately-marked persistence boundary.
> **Why this exists**: 14-storage (audit 3/12, R3 heavy violation) blurred "experiment is persistence test" with "experiment itself persists". This file is the explicit R3-clean half.
> **Sister experiment**: `14b-storage-persist` — same ops but with persistent-store.js imported. R3 deliberately violated there.

## 假设

- H0 (零假设): most experiments needing Map-shaped state in-process don't need persistence; defaulting to `Map()` is fine, even for "looks like" state.
- H1 (备择假设): if a new experiment reaches for `fs.writeFileSync`, `~/.openchat/`, or imports `persistent-store.js`, it should be redirected to 14b (and only when the question explicitly involves cross-process state).

## data flow

```
inputs: { op, key, value }
  ↓
switch on op
  ↓
map.get / map.set / map.has / map.delete / map.clear / map.size
  ↓
outputs: { result | {ok, key, size}, persistent: false }
  ↓
console.log state via `---` separator (R5 surface-state)
```

## 接口签名

```js
// 输入
{
  op:    'set' | 'get' | 'has' | 'delete' | 'clear' | 'size',
  key?:  string,
  value?: any,
}

// 输出
{
  result?:     any,            // get→value|null, has→bool, size→number
  ok?:         boolean,        // set/delete/clear
  key?:        string,
  size?:       number,
  hit?:        boolean,        // get only
  existed?:    boolean,        // delete only
  wiped?:      number,         // clear only
  persistent:  false,          // R3 declaration, present in EVERY output
}
```

## 6 Hard Rules 自评 (design-spec audit)

```
R1 throwaway  ............ 5/5  // 路径 experiments/14a-storage-noop/index.mjs, 头部 invariants block 8 行
R2 one-cmd    ............ 5/5  // node src/experiments/14a-storage-noop/test.mjs 一行可跑
R3 no-persist ............ 5/5  // **干净正例**: META.persistent=false, 输出也带 persistent:false, 零 fs
R4 skip-polish ............ 5/5  // 6 个 op + 6 个 test case, 100+ 行, 无 class/strategy/factory
R5 surface-state .......... 5/5  // 每次 surface() 打印完整 state, 含 === final === block
R6 delete-or-absorb ....... 5/5  // META.status=closed-loop, test() 终判 H1, 是抛物线正例, 不需删
                            ─────
总分: 30/30  // 黄金正例
```

## 边界条件

- `inputs.op` 缺失 → throw `14a-storage-noop.run: op required (set|get|has|delete|clear|size)`
- `inputs.op='set'` 且 `key` 缺失 → throw `set needs key`
- `inputs.op='get'` 且 key 不存在 → 返回 `{result: null, hit: false, persistent: false}`, 不 throw
- `inputs.op='delete'` 且 key 不存在 → 返回 `{ok: true, existed: false, size: N}`, 不 throw
- `inputs.op='clear'` 在 size=0 时 → 返回 `{ok: true, wiped: 0}`, 不 throw
- 未知 op → throw `unknown op "<op>"`
- 不写盘. 不读盘. 进程退出即清. 跨进程 state 恢复 = 错误用法 → 用 14b.

## 文件清单

- `src/experiments/14a-storage-noop/index.mjs` — 主实验 (run/test/META, in-memory Map)
- `src/experiments/14a-storage-noop/test.mjs` — 6 case dry-run 入口
- `src/experiments/14a-storage-noop/index.spec.md` — 本 spec 文件
- `src/experiments/manifest.json` — 注册 storage-noop entry (id=storage-noop, file=14a-storage-noop/index.mjs, persistent:false)

## 何时用 14a vs 14b

| 场景 | 用 14a (this) | 用 14b |
|------|----------------|--------|
| 跑回归, 临时缓存, 计数器, dedupe set | 是 | 否 |
| LLM transcript / fingerprint cache (process-local) | 是 | 否 |
| 工具调用结果缓存 (跑完即弃) | 是 | 否 |
| 单次 run 的 scratch state | 是 | 否 |
| Session 跨重启 (relay resume) | 否 | 是 |
| Provider 配置 (apiKey, baseUrl) 持久化 | 否 | 是 |
| 录音/会话元数据, 进程挂了能恢复 | 否 | 是 |
| **临时脚本用 14b = 反模式** | 否 | **反模式** |

**反模式警告**: 临时 throwaway 脚本用 14b = 违反 prototype 原则, 等于偷偷持久化到 `~/.openchat/`, 会污染生产配置. 严拒.

## 测试

6 case dry-run, 全部 expect pass:
- Case 1: basic CRUD
- Case 2: get-missing → null
- Case 3: delete + re-get
- Case 4: has true/false
- Case 5: clear wiped=2 → size=0
- Case 6: META.persistent === false
