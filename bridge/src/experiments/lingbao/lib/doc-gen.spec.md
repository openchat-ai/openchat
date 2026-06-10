# spec: doc-gen lib (44 子模块)
> 44.mjs 的 4 种 renderer 实现。纯字符串拼接，无外部依赖。

## 数据流
```
render(kind, data, meta) → switch 4 路 → 字符串拼接 → { content, ext, bytes }
```

## 接口签名
```ts
function render(kind: 'report'|'questionnaire'|'roi'|'proposal', data: object, meta?: object): { content: string, ext: string, bytes: number }
function renderWithBytes(kind, data, meta): { content, ext, bytes }  // bytes 补全
```

## 边界条件
- kind 必须是 4 种之一, 否则 RangeError
- data 为对象, 空对象也合法
- 4 kind 各自 ext: report/proposal→md, questionnaire/roi→csv
- CSV 转义规则: 含 , " 换行 的字段加双引号包裹, 内部 " 转 ""

## 文件清单
| 文件 | 职责 | 行数 |
|---|---|---|
| `bridge/src/experiments/lingbao/lib/doc-gen.mjs` | 本模块 | 195 |

## 调试检查点
| C | 关键词 | 预期 |
|---|---|---|
| C1 | `render` 入口 | 校验 kind |
| C2 | switch 分支 | 4 路之一 |
| C3 | bytes 补全 | 与实际一致 |

## 不变量
```js
// === invariants ===
// - 4 kind 各自固定 ext
// - 输出 UTF-8 字符串
// - 空 data 输出有效模板 (含占位符)
// - CSV 转义: 内部 " 转 ""
// - Markdown 不做 HTML 转义 (信任 data)
```
