# spec: knowledge-extract
> 从实验运行结果中萃取关键发现，追加到 ~/.openchat/MEMORY.md。

## 数据流
runs[] → extract() → 解析实验名/结果 → 追加到 MEMORY.md

## 接口签名
- `extract(runs)`: → { ok, wrote, path?, linesAdded? }

## 边界条件
- runs 为空 → { ok, wrote: false }
- MEMORY_DIR 不存在 → 自动创建
- MEMORY.md 不存在 → 新建
- 实验描述不匹配格式 → name='?'
- 文件写入失败 → 抛异常（不吞）

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/knowledge-extract.mjs` | 萃取引擎 | 70 |
| `src/lab/knowledge-extract.spec.md` | 本文件 | - |
