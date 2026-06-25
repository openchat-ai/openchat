# spec: provider-kit/bridge-init

> Single authority for reading bridge config and connecting the active LLM provider.

## 数据流

1. Caller invokes `getActiveProvider()` (or passes an explicit `configPath` via env `OPENCHAT_CONFIG`).
2. `loadBridgeConfig()` reads `~/.config/openchat/config.json` first; on ENOENT or parse error, falls back to `~/.openchat/config.json`. Returns parsed object or `null`.
3. `pickFallback(config)` returns ordered list `[{name, model}]` — `current.provider` first, then any other provider with an `apiKey` (in `Object.entries` order).
4. For each fallback: `createProvider(name, apiKey, {baseUrl})` → `provider.connect(apiKey)`. On success, return `{provider, model, fallbacks, config}`.
5. If all fallbacks fail, throw `bridge-init: all providers failed (last: <msg>)`.

## 接口签名

```js
loadBridgeConfig(): object | null
pickFallback(config: object): Array<{name: string, model: string}>
getActiveProvider(opts?: { silent?: boolean }): Promise<{provider, model, fallbacks, config}>
getConfigPaths(): {NEW_CONFIG: string, OLD_CONFIG: string}
```

## 边界条件

- 配置文件完全不存在 → `loadBridgeConfig()` 返回 `null`, `pickFallback` 抛 `no config`
- `current.provider` 存在但 `providers[current.provider].apiKey` 缺失 → 该项被跳过(不计入 fallbacks)
- 所有 provider 都失败 → throw,不返回 null
- 同一个 provider name 出现多次(理论不可能) → 第一次出现生效
- `OPENCHAT_CONFIG` 环境变量覆盖 NEW_CONFIG 路径(供测试用)
- 旧 `~/.openchat/config.json` 路径仅作只读 fallback(kit 不写)

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `modules/provider-kit/src/bridge-init.js` | config 读取 + fallback 链 + createProvider + connect | 80 |
| `modules/provider-kit/src/index.js` | re-export `loadBridgeConfig / pickFallback / getActiveProvider / getConfigPaths` | +5 |

## 调试检查点

| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `[bridge-init] xxx/yyy connected` | 第一个成功的 provider + model |
| C2 | `[bridge-init] xxx failed: <msg>` | fallback 链上某 provider 失败原因(截断 60 字符) |
| C3 | `bridge-init: all providers failed` | 全部 fallback 耗尽,last error 给出根因 |
| C4 | `bridge-init: no config` | 配置文件不存在且 OLD 也无 |
| C5 | `bridge-init: no provider with apiKey` | 配置文件存在但 `providers` 字典里全无 apiKey |

## 不变量

```js
// === invariants ===
//   - loadBridgeConfig 不写盘,纯读
//   - pickFallback 返回的顺序 = current provider 在前,其他按 providers 字典序
//   - getActiveProvider 失败时 throw,绝不返 null (caller 显式处理)
//   - fallbacks 至少 1 项 (抛错时已校验)
//   - bridge-init.js 仅依赖 node 内置 (fs/os/path) + kit 内部 createProvider
//   - 不修改 config.json 任何文件,持久化由 bridge core-config.mjs 负责
// === end invariants ===
```

## 迁移 / 替换

- `experiments-all.mjs:experiment_22_initProvider` → 1 行: `const { provider, model } = await getActiveProvider();`
- `experiments-all.mjs:experiment_38_run` `_getProvider()` (line 6464-6483) → `const { provider, model, fallbacks } = await getActiveProvider()`
- `experiments-all.mjs:experiment_34_run` 内联 fallback 链 (line 3149, 3163, 3212) → `const { provider, model, fallbacks } = await getActiveProvider()`
- `cap/60` baseline/pipeline (line 3036-3049) → 同上
- 旧函数 `_callLLMWithFallback` / `_buildFallbackChain` / `runBaselineLive` / `runPipelineLive` 内部如还有直接调 `createProvider` 的,改用 `getActiveProvider().fallbacks` 枚举
