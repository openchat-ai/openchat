# spec: calendar-parse lib (45 子模块)
> 45.mjs 的解析+建议算法后端。纯函数, 无外部依赖。

## 数据流
```
parse(calendar) → 统计 phase 分布 + dateRange
suggest(calendar, thresholds, currentDate) → 当前 phase 查 PHASE_RULES → 输出调整值 + 7 天预告
```

## 接口签名
```ts
parse(calendar: Array<{date, phase, equipmentLoadKw?}>): { days, phases: Record<string,number>, dateRange: [string,string]|null }
suggest(calendar, thresholds?, currentDate?): { currentPhase, currentDate, suggestions: Array<{date, phase, phaseName, action, reason, adjusted}> }
normalizePhase(s: string): 'concrete'|'lifting'|'finishing'|'rest'|'unknown'
```

## 边界条件
- calendar 非数组 → RangeError
- 空 calendar → parse 返回 days=0/dateRange=null, suggest 返回空 suggestions
- phase 归一化失败 → 'unknown' (保守默认)
- currentDate 不传 = calendar 最后一天
- thresholds 缺字段补默认

## 文件清单
| 文件 | 职责 | 行数 |
|---|---|---|
| `bridge/src/experiments/lingbao/lib/calendar-parse.mjs` | 本模块 | 110 |

## 调试检查点
| C | 关键词 | 预期 |
|---|---|---|
| C1 | `parse` 入口 | 校验数组 |
| C2 | `suggest` 查 PHASE_RULES | 返回调整值 |
| C3 | 7 天预告 | 同 phase 跳过 |

## 不变量
```js
// === invariants ===
// - PHASE_RULES 硬编码, 不可外部配置
// - 同一日期同 phase 只 1 条 (合并)
// - 预告窗口 = 未来 7 天
// - phase 字符串大小写不敏感
// - 中文/英文/拼音都识别
```
