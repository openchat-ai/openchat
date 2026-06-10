# spec: mqtt-push lib (42 子模块)
> 42.mjs 的 EventEmitter 包装实现。进程内单例 bus, 无外部 broker。

## 数据流
```
publish(channel, payload) → setImmediate(emit) → 订阅者 handler
                              ↓
                          写 history 队列 (上限 100)
```

## 接口签名
```ts
createBus(): {
  publish(channel, payload): { deliveryId, ts, subscribers }
  subscribe(channel, handler): { unsub, channel }
  history(channel, limit?): Array<{ deliveryId, ts, payload }>
  stats(): { channels, totalDelivered, publishCount, subscribers }
}
```

## 边界条件
- channel 空 → RangeError
- payload 非对象 → RangeError
- 队列上限 100, FIFO
- handler 异常被吞
- channel 大小写敏感

## 文件清单
| 文件 | 职责 | 行数 |
|---|---|---|
| `bridge/src/experiments/lingbao/lib/mqtt-push.mjs` | 本模块 | 95 |

## 调试检查点
| C | 关键词 | 预期 |
|---|---|---|
| C1 | `publish` 入口 | 校验 channel/payload |
| C2 | `setImmediate emit` | 异步分发 |
| C3 | `history` 倒序 | 最新在前 |

## 不变量
```js
// === invariants ===
// - deliveryId 8 字符 hex, 单进程内唯一
// - 队列每 channel 上限 100, FIFO
// - publish 同步返回, handler 异步执行
// - handler 异常被吞, 不影响其他订阅者
// - channel 大小写敏感
```
