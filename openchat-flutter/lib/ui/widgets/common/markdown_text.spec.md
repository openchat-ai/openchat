# spec: markdown_text.dart
> Minimal inline markdown renderer, zero deps, ~150 lines.

## 数据流
input:  String source + TextStyle base
output: Widget (Column of Text/RichText/Container rows)

## 接口签名
- MarkdownText({source, base}) → StatelessWidget

## 边界条件
- 空 source: 返回空 Column (不崩)
- 未闭合 code fence (```): 当成普通行处理
- 嵌套 `***bold-italic***`: 内层 `*i*` 优先匹配, 残留 `**` 当字面量
- 单行超长: RichText 自动 wrap

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| lib/ui/widgets/common/markdown_text.dart | 行内 + 块级 markdown 渲染 | 200 |

## 调试检查点
| C | 触发 | 预期 |
|---|------|------|
| 1 | text 含 `**bold**` | RichText 渲染粗体 |
| 2 | text 含 ``` ```code``` ``` | 黑底等宽块 |
| 3 | text 含 `# ` / `## ` / `### ` | 加大字号 |
| 4 | text 含 `- item` | 项目符号 + 缩进 |

## 不变量
- _parseInline 不返回 null, 至少 1 span
- 行内正则顺序: code > bold > italic, 按 match 起点最早优先
- flushPara 在新行 / 块级 / 列表时调用
