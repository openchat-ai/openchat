# spec: fixers/empty-catch.mjs
> 空 catch 自动修复：上下文感知替换为 console.debug

## 数据流
applyFixer(goalText) → match() 解析文件:行号 → readFile → 提取调用名 → safeAtomicWrite 替换

## 接口签名
- `match(goalText): boolean` — 匹配 `[fix] empty catch: path:line`
- `apply(goalText): { ok, info }` — 执行修复

## 边界条件
- 目标文件不存在 → { ok: false }
- 替换后语法检查失败 → safeAtomicWrite rollback
- 无上下文可提取 → 用默认描述 "operation"

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| empty-catch.mjs | 空 catch 修复器 | 100 |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|------------|------|
| C1 | match → true | 匹配 `[fix] empty catch:` |
| C2 | safeAtomicWrite | 原子写入 |
| C3 | fork --check | 语法验证 |
