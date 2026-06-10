# spec: lib/evaluate + lib/mock-backends
> 60.mjs 拆分后的辅助模块

## 数据流
mock-backends.mjs: 返回确定行为的 async call() 函数
evaluate.mjs: 输入 task + simResult, 输出 { passed, issues, finalState, attempts, trace, log }

## 接口签名
```
mockFlaky({ failTimes }) → call() → { ok, error?, kind? } | { ok, data }
mockFailOnce({ kind }) → call() → 同上
mockAlwaysFail() → call() → { ok: false, error, kind: TRANSIENT }
evaluate(task, simResult) → { taskId, desc, passed, issues, finalState, attempts, trace, log }
```

## 边界条件
- mock 内部 count 自增, 跨调用保持
- evaluate 期望 simResult.log 含 attempt + retry_scheduled 事件, 只看 event='attempt'
- issues 数组, passed = issues.length === 0

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| lib/mock-backends.mjs | 3 个 mock backend | 60 |
| lib/evaluate.mjs | 评估器 | 50 |
| lib/mock-backends.spec.md | 本文件 | 50 |
