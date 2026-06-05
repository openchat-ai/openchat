# spec: session-namer
> 会话自动命名 + 用户自定义名称。触发器按消息计数指数退避 {3, 8, 16, 32, 64}。

## 数据流

```
chat-poller 处理后消息
  → autoNameIfNeeded(chatId, msgCount, generatorFn)
  → readMeta(chatId) 读取 _meta.json (或初始化)
  → _shouldTrigger(): userSet=false + msgCount ∈ {3,8,16,32,64}
  → generatorFn() 调用 LLM 生成名称
  → writeMeta(chatId, {name, autoNamed, updatedAt})
  → _meta.json 写入 Qiniu: oc/chat/{chatId}/_meta.json
```

## 接口签名

```js
readMeta(chatId: string): Promise<object|null>
writeMeta(chatId: string, meta: object): Promise<void>
getOrInitMeta(chatId: string): Promise<object>
autoNameIfNeeded(chatId: string, messageCount: number, generatorFn: Function): Promise<object>
invalidateCache(chatId: string): void
```

Meta 格式: `{ name: string|null, userSet: boolean, autoNamed: boolean, createdAt: number, updatedAt: number }`

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| userSet=true | 永不自动命名 |
| msgCount 不在触发点 | 不触发 |
| generatorFn 返回空 | 不更新 name |
| Qiniu _meta.json 不存在 | 初始化为 {name:null, userSet:false, ...} |
| Qiniu GET 失败 | 返回 null，下次重试 |
| 名称超长 | 截断至 20 字符 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/core/session-namer.mjs` | 命名逻辑 + Qiniu 持久化 | 110 |

## 不变量

```
// === invariants ===
// - _metaCache[chatId] = { name, userSet, autoNamed, createdAt, updatedAt } | null
// - Never auto-name if userSet === true
// - Auto-name triggers: messageCount ∈ [3, 8, 16, 32, 64] (exponential backoff)
// - Name generation uses the same provider as chat (processText via external callback)
// - _meta.json written to Qiniu only when name actually changes
// - Cache miss → read from Qiniu; negative cache (null) avoids repeated misses
```
