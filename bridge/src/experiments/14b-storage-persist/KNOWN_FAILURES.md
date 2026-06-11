# 14b-storage-persist — 已知失败模式 / 边界

> **This is the persistence boundary.** R3 deliberately violated. R6 enforced.
> 写这文件的目的是: 让任何"想用持久化的实验"先看完这文件, 再决定是不是真的需要.

## 1. test() 崩溃导致 ~/.openchat/sessions.json 残留 __14b_test_* 键

- **症状**: 跑 `node test.mjs` 看到 FAILED, 之后再 listSessions 发现一堆 `__14b_test_*` 键.
- **根因**: test() 在 clear() 之前抛了 (assert 失败 / import 失败), 前缀隔离机制没机会跑.
- **检测**: `grep '__14b_test_' ~/.openchat/sessions.json`
- **修复**:
  ```bash
  node -e "import('./src/experiments/14b-storage-persist/index.mjs').then(m => m.run({inputs:{op:'clear'}}))"
  ```
  或手动 jq 删. 永远不要 `rm ~/.openchat/sessions.json` — 那是 user data.

## 2. 误把 14b 当 production session manager

- **症状**: dev-repl 的 session 状态不稳定, 怀疑是 14b 把它改坏了.
- **根因**: dev-repl 不用 14b. 14b 是实验, 不在生产路径. 持久化是 src/core/session-manager.js + persistent-config.js.
- **检测**: 看 dev-repl.mjs 的 import, 有 `storage-persist` → 误用.
- **修复**: dev-repl 应该 import `src/core/persistent-config.js` (production), 不是 14b. 14b 只在实验里跑, 不上 production.

## 3. 误在 run-all.mjs 里跑 14b test()

- **症状**: `node src/experiments/run-all.mjs` 跑 5 分钟, 因为 14b 真实写盘 + 真实 roundtrip.
- **根因**: 14b 是 boundary test, 不是 dry-run unit test. 它的 test() 副作用真实.
- **检测**: run-all.mjs 包含 `import { test } from './14b-storage-persist/index.mjs'` → 误用.
- **修复**: run-all.mjs 跳过 14b (e.g. 加白名单 `if (id === 'storage-persist') continue;`). 14b 的 test.mjs 单独跑, 不在 batch 里.

## 4. 14b 的 save() 静默吞错

- **症状**: 写满磁盘 / 权限拒绝, 但 14b 返回 `{ok: true}`, 没报警.
- **根因**: persistent-store.js 内部 `try { writeFileSync } catch { logger.info }`, 错误被吞. 这是库的设计, 不是 14b 的 bug.
- **检测**: 写完后 `ls -la ~/.openchat/sessions.json` 看 mtime 没变 → 写失败.
- **修复**: 不要给 14b 加 throw-on-fail 的 wrapper — 那是 14a 的领域. 14b 是 boundary test, 验证库的行为, 库吞错就让它吞.

## 5. ~/.openchat/sessions.json 被 user 手动编辑了, 14b load() 崩

- **症状**: user 手改 sessions.json 写错 JSON, 14b load() 抛 SyntaxError.
- **根因**: PersistentSessionStore.load() 内部 `try { JSON.parse } catch { logger.info }`, 吞错, sessions Map 留空. 不抛.
- **检测**: 跑 14b test, Case 1 listSessions 数 = 0, 但 grep 文件有数据 → load 吞错了.
- **修复**: 14b 不动库行为. 这是库的 known feature, 不算 14b 的 failure. 真要 strict, 改 src/core/persistent-store.js 抛错 (那是 P1 改库任务, 不在 14b 范围).

## 6. 14b 跟 14a 在同一进程 import 时, 状态互不可见

- **症状**: 14a 写 cache, 14b 读 sessions.json, 互不干扰. 但用户期望"它们共享".
- **根因**: **设计如此**. 14a 是 in-memory Map (模块级), 14b 是 fs-backed (进程级). 不共享.
- **检测**: 看到 "我先 14a set, 再 14b get" 这种预期 → 错.
- **修复**: 二选一. 14a 给你 ephemeral, 14b 给你 persistent. 不要试图 sync 它们, 那是 anti-pattern.

## 7. (隐性) 14b 的 test() 在 CI 跑, ~/.openchat/ 写到 CI runner

- **症状**: CI runner 上有 `~/.openchat/sessions.json`, 第二次 build 看到残留.
- **根因**: test() 副作用真实, 没 sandbox.
- **检测**: 看 CI artifact 列表有 `sessions.json` → 误用.
- **修复**: CI 加 `before_script: rm -f ~/.openchat/sessions.json` 或在 test.mjs 开头 clear 一次. 见 src/experiments/51-diagnose 那种 test.mjs 怎么写的.

## 8. (隐性) 14b 的 R3 exception 蔓延到 14a

- **症状**: 复制 14b 到新实验 30b-storage-thing, 删了 META.persistent=true, 写成 false, 但 import 没删, 还是持久化.
- **根因**: 复制粘贴的时候 META 改了, import 没改. 半 R3 半 R1.
- **检测**: 任何 `import ... from '../lib/persistent-store.js'` 出现, META.persistent 必为 true. 反之亦然: META.persistent=false 必**不**import persistent-store.
- **修复**: 写 new experiment, 决策流程:
  1. 真要持久化? → 14b 这套, META.persistent=true
  2. 不用? → 14a 这套, META.persistent=false
  3. 不确定? → 14a (R3 default), 跑完再问

## 9. (隐性) dev-repl 自动调 14b 当 storage 后端

- **症状**: dev-repl 的 `session.get()` 实际调的是 14b.run, 不是 src/core/persistent-session-manager.js.
- **根因**: manifest 加载顺序 / default storage backend 配错.
- **检测**: dev-repl 的 session.get 慢 / 行为跟 14b test() 一致 → 误用.
- **修复**: dev-repl 用 `src/core/persistent-config.js` (单例), 不调 experiments/. Experiments 是 dev-repl 的 capability, 不是 backend.
