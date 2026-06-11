# 14a-storage-noop — 已知失败模式 / 边界

> **This is the throwaway pattern.** 当你需要 Map-shaped state 但又**不**需要持久化时, 用 14a. 不要复制 14b 的 import 模式.

## 1. 误用 14a 做持久化 (R3 静默违反)

- **症状**: 实验跑完了, 但用户发现 `~/.openchat/` 多了 `__14a_storage_noop__` 之类的奇怪 JSON.
- **根因**: 开发者加了 `import { persistentStore } from '...'`, 把 14a 写盘, 违反 R3 默认规则.
- **检测**: 任何 import 包含 `persistent-store` / `persistent-config` / `~/.openchat/` → 不准用 14a, 改用 14b 并**显式**声明.
- **修复**: 见 14b-storage-persist (KEEP) — 但用 14b 意味着你已经 answer 了"这个实验需要持久化", 那是 valid, 不是 bug.

## 2. 14a 的 cache 在跑 2 次时不一致

- **症状**: `node test.mjs` 第 2 次跑, 期望 size=0, 实际 size=2.
- **根因**: 14a 的 cache 是**模块级 const**, 同一进程内多次 import 共享 state. 不像 27.mjs 那种 进程退出即清.
- **检测**: 跑 `test.mjs` 看到 "size > 0 at start" 即可确认.
- **修复**: 在 `test()` 开头加 `cache.clear()` 显式 reset, 或在 run() 顶部加 `if (op === 'reset') cache.clear()`. **不要**给 14a 加文件 fallback.

## 3. 想用 14a 当 session manager

- **症状**: dev-repl 重启了, 但 session state 还在 → 用户希望"resume conversation".
- **根因**: 14a 故意不持久化, 进程退出即清. 这是设计, 不是 bug.
- **检测**: 任何"重启后还在"的需求, 都违反 14a 的本质.
- **修复**: 用 14b (持久化) 或 src/core/session-manager.js (生产模块). **不要**给 14a 加 fs 后门.

## 4. 误把 14a 当 production key/value store

- **症状**: 把 14a 复制到 src/memory/ 当生产模块.
- **根因**: "在 experiments/ 跑通了, 那搬到 core/ 也行吧" — 错. 14a 是 throwaway 模板, 不写错误处理, 不写并发保护, 不写 quota.
- **检测**: production code 引用 `experiments/14a-storage-noop/` → 立即重构.
- **修复**: 用 `src/core/persistent-store.js` (已存在, Map + JSON file, R3 例外是因为它就是持久化库本身).

## 5. META.persistent 漏写

- **症状**: 复制 14a 到新实验 30a-storage-thing, 改了 id, 删了 META.persistent 字段.
- **根因**: 复制粘贴的时候没注意 invariants block.
- **检测**: 实验跑 description-spec validator 看 META 字段, 缺 `persistent: false` 字段 → 警告.
- **修复**: 任何 in-memory 实验必带 `META.persistent: false` (自声明 R3). 这是 future `check-experiment-design.mjs` 必查项.

## 6. (隐性) 14a 不支持 stream / async iterator

- **症状**: 想用 `for await (const k of cache.keys())` 之类, 14a 的 Map 是同步的.
- **根因**: Map 不是 AsyncMap, 简单场景够用.
- **检测**: 看到 import 'node:stream' 或 for-await 在 14a 类实验里.
- **修复**: 14a 范围 = sync CRUD on small data. Stream / async / large dataset → 用 14b 或换库 (e.g. lru-cache), 不要给 14a 加 async.

## 跟 14b 的边界

| 边界 | 14a (this) | 14b |
|------|------------|-----|
| Process exit | wiped | saved to ~/.openchat/*.json |
| Cross-process | no | yes (single shared file) |
| META.persistent | false (REQUIRED) | true (REQUIRED) |
| import persistent-store.js | **禁止** | **强制** |
| 设计目标 | 抛物线正例, 80% 用例 | 边界用例, 显式声明 |
