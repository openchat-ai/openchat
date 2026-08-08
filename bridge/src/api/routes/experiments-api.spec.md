# spec: experiments-api

> 4 endpoints that expose the experiments compose layer to clients (Flutter app, MCP, scripts).

## 数据流

1. `GET /api/v1/experiments` → `experiment_compose_list()` returns MANIFEST entries (id/name/category/status/intelligenceLevel/deps/description). 静态元数据,无 LLM 调用。
2. `POST /api/v1/experiments/:id/run` body=`{inputs, deps}` → `experiment_compose_run(id, {inputs, deps})` returns `{outputs, durationMs}`. 走 provider-kit.getActiveProvider() 内部。
3. `POST /api/v1/agent/chat` body=`{text, chatId, role?, tools?, guardian?}` → `experiment_22_initProvider()` + `experiment_22_processText(text, chatId, opts)` returns `{chatId, response}`. 是 tool-loop 路径(替代 /api/chat/stream)。
4. `GET /api/v1/projects` → `experiment_42_answerFromDNA('ls projects')` returns `{answer}`. Plan 页面用。

## 接口签名

```
GET  /api/v1/experiments              → { total, experiments: [{id, name, category, status, intelligenceLevel, deps, description}] }
POST /api/v1/experiments/:id/run      body: {inputs?, deps?} → { id, durationMs, outputs }
POST /api/v1/agent/chat               body: {text, chatId?, role?, tools?, guardian?} → { chatId, response }
GET  /api/v1/projects                 → { answer }
```

## 边界条件

- `experiments/:id/run` 找不到 id → compose_run 返 `{ok:false, info:"..."}` 不 throw (200 with info field)
- `agent/chat` 缺 text → 400 `{error:'TEXT_REQUIRED'}`
- `agent/chat` role 非法 → tool-loop 内部抛错 (500 with message)
- `projects` DNA 未生成 → experiment_42 内部 catch 返 fallback 字符串
- 所有端点 next(e) 走全局 errorHandler (统一 500)

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/api/routes/experiments-api.mjs` | 4 端点 router 工厂 | 80 |

## 调试检查点

| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `GET /api/v1/experiments` | 200,total ≥ 30 (38+5 lingbao - 合并后) |
| C2 | `POST /api/v1/experiments/22/run` body=`{inputs:{text:"hi",chatId:"t1"}}` | 200,durationMs < 30s (LLM 调用) |
| C3 | `POST /api/v1/agent/chat` body=`{text:"hi"}` | 200,response 包含 LLM 输出 |
| C4 | `GET /api/v1/projects` | 200,answer 含 6 个 project (bridge-core/experiments/lab/openchat-flutter/provider-kit/fairy-guardian) |
| C5 | `POST /api/v1/agent/chat` body=`{}` | 400,{error:'TEXT_REQUIRED'} |

## 不变量

```js
// === invariants ===
//   - 所有 LLM 调用走 provider-kit.getActiveProvider() (经 experiment_22_initProvider 委托)
//   - 4 端点都是无状态,不在 router 内保存 session/history
//   - 不写盘,不修改 MANIFEST,不修改 config.json
//   - 错误一律 next(e),由全局 errorHandler 渲染 JSON
//   - agent/chat 复用 _sessions Map (in-memory,跨请求同 chatId 共享)
// === end invariants ===
```
