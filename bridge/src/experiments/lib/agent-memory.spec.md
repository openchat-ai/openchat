# spec: agent-memory
> 跨 session agent 记忆持久化。存到 ~/.openchat/agent-memory.json。

## 数据流
addFact() → load() → modify cache → save() → disk

## 接口签名
- `load()`: → memory object
- `save()`: void
- `addFact(text)`: → fact count
- `addPreference(key, value)`: void
- `addPattern(pattern)`: void
- `summary()`: string

## 边界条件
- 文件不存在 → 返回默认空结构
- 文件损坏 → 返回默认空结构
- facts 上限 100 条，溢出裁头
- save 前自动创建目录
- 所有操作不抛（catch 吞异常）

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lib/agent-memory.mjs` | 记忆 | 70 |
| `lib/agent-memory.spec.md` | 本文件 | - |
