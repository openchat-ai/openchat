# DELETE-NOTES: 14-storage (2026-06-11)

## 拆解原因

14-storage (manifest id `storage`, 实际文件 `src/experiments/27.mjs`) 在 design-spec audit 中 3/12, R3 重违: 实验**自己**就是测 persistence, 又 import `persistent-store.js` 跑持久化操作, throwaway 边界 + 持久化行为两层混淆, 不像 prototype 倒像 integration test.

按 design-spec R6 "delete or absorb when done" 处理: **absorb** 进 2 个更细的实验, 拆 R3 边界.

## 拆解后

- **`14a-storage-noop/`** — 测 non-persistence 场景, in-memory Map, R3 干净正例 (30/30).
  Manifest id: `storage-noop`, META.persistent: false.
- **`14b-storage-persist/`** — 测 persistence 场景, 真实 import persistent-store.js, R3 例外 (22/30, R1 减分因 R3 exception).
  Manifest id: `storage-persist`, META.persistent: true + r3ExceptionReason.

## 原 27.mjs (manifest id `storage`)

- 状态: **保留文件, manifest entry 已删除** (旧 entry 已从 manifest.json 移除, 见 git diff).
- 原因: 27.mjs 同时覆盖 persistent-store / provider-service / tool-registry 3 件事, 本次只拆 storage 部分 (R3 边界), provider-service + tool-registry 由后续 P1 重构处理.
- 影响: 旧 manifest entry `id=storage` 引用 `./27.mjs` 已不可达. 任何代码用 `manifest.find(e => e.id === 'storage')` 会拿到 `undefined`. 已知 caller: 暂无 (grep 过). 若有, 改用 `storage-noop` 或 `storage-persist` 或 `provider-kit` (待 P1 重构).

## 后续

- P1: 27.mjs 的 provider-service + tool-registry 部分 → 单独 experiment (e.g. `27a-provider-service` + `27b-tool-registry`).
- P1: 写 `scripts/check-experiment-design.mjs` (design-spec Step 3), 强制 `META.persistent` 字段 + 自动打分 6 rules.
- 38 个其它实验, audit 抽样 10 个, 平均 6.4/12, 后续按 P0/P1 顺序重构.
