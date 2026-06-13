# spec: notifier.mjs

> L3 phone push — lab escalate 时通知 user, 责任从"user 轮询"转给"lab 决定打扰"

## 数据流
1. escalate() 写完 log 后, 调 `notifyFireAndForget(record)` (非 await, 不阻塞)
2. notify 读 env: `OPENCHAT_LAB_NOTIFY` 决定模式 (server|webhook|off)
3. server 模式 → POST 到 sctapi.ftqq.com (Server酱)
4. webhook 模式 → POST 到 OPENCHAT_LAB_WEBHOOK (Discord/Slack/TG 自适配)
5. 失败 1 次重试 (5s 后), 再失败 warn + 放弃

## 接口签名
```js
notify(record): Promise<{sent: bool, mode?, reason?, response?, retried?}>
notifyFireAndForget(record): void  // 内部 catch 兜底, 不传播

record = {
  goalId, description,
  classification: {category, reason, retryable},
  attempts, escalatedAt,
}
```

## 触发
- `escalate(goal, classification, attempts)` 写完 jsonl 后, 调 `notifyFireAndForget(record)`
- `runner.mjs._finalize` 走 escalate 路径时会自动触发 (无需改 runner)

## 配置 (env, 全部 opt-in)
```
OPENCHAT_LAB_NOTIFY    = "server" | "webhook" | (其他 = off)
OPENCHAT_LAB_SENDKEY   = Server酱 SendKey          (server 模式必填)
OPENCHAT_LAB_WEBHOOK   = Discord/Slack/TG webhook  (webhook 模式必填)
```

## 边界条件
- `_enabled()` 返回 false → 返回 `{sent: false, reason: 'notify disabled'}`
- key/url 缺失 → 返回 `{sent: false, reason: '<env var> not set'}`
- curl exit 非 0 → 触发重试, 重试也失败 → warn + 返 `{sent: false, reason}`
- response 截前 200 字符, 避免日志被刷爆
- 网络用 curl 不用 fetch (跨平台一致, 走系统代理, 不用管 IPv4/IPv6)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/notifier.mjs` | notify + notifyFireAndForget (server|webhook) | 100 |

## 不做
- 邮件 (留 L4)
- 多通道聚合 / 模板渲染 (留 L4)
- rate limit (lab 量小, 一次 escalation 一通知, 不需要)
- 通知历史记录 (escalated.jsonl 已经是历史)
