# spec: lab-health
> lab 基础设施自修改引擎，第 6 步元能力

## 数据流
scanner 产 `[lab-health]` goal → runner dispatch → `processLabHealth()` → 读文件 → 分析代码 → `safeAtomicWrite()` → dedup 记录

## 接口签名
- `processLabHealth(detail: string, goalId: string): Promise<{ok:boolean, info:string}>`
- `ping(): {ok:boolean, module:string, funcs?:string[], issues?:string[]}`

## 边界条件
- 只 additive（加 invariants 块），不 destructive
- `_extractPaths` 已禁用（语义不安全）
- dedup 防循环：同一 `(file, operation)` 只修一次
- `safeAtomicWrite` 失败时保留原文件 + 删除 tmp

## 文件清单
| 文件 | 职责 |
|------|------|
| lab-health.mjs | 自修改执行 + ping 心跳 |
