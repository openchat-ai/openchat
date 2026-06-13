# spec: goal-queue

> lab P0 — 持久化 goal 队列 (单文件 JSONL)

## 数据流
1. `addGoal(desc, opts)` → 写 1 行到 `~/.openchat/lab/queue.jsonl`
2. `listGoals(filter)` → 读所有行, 按 filter 过滤
3. `getNextPending()` → 读所有行, 取 priority 最高 + addedAt 最早的 pending
4. `updateGoal(id, patch)` → 读所有行, 找到 ID merge 改, 全量重写
5. `getStatus()` → 读所有行, 数 {pending, running, done, failed}

## 接口签名
```js
addGoal(description: string, opts?: { priority?: number }): Goal
listGoals(filter?: { status?: string, pending?: boolean }): Goal[]
getNextPending(): Goal | null
updateGoal(id: string, patch: Partial<Goal>): Goal | null
getStatus(): { total, pending, running, done, failed }
```

`Goal` 形状:
```js
{
  id: `goal-${Date.now()}-${rand4}`,
  description: string,
  addedAt: number,       // Date.now()
  status: 'pending' | 'running' | 'done' | 'failed',
  priority: number,      // 越大越先跑, 默认 0
  startedAt: number | null,
  finishedAt: number | null,
  result: { ok, exitCode, signal, durationMs } | null,
}
```

## 边界条件
- 文件不存在 = 空队列 (readAllLines 返 [])
- addGoal 不验证 description (任意字符串)
- updateGoal 找不到 id → 返 null, 不报错
- getNextPending 排序: priority 降序, 然后 addedAt 升序 (FIFO 内部)
- 并发写不保护 — 假设单用户串行

## 决策记录
- **单文件 JSONL** — append-friendly + 全量重写, lab 假设单用户
- **不用 SQLite** — 38 个 goal 量级, 性能不必要, 部署门槛也低
- **priority + FIFO** — 大部分 goal 同 priority, 加 priority 字段为后续 P1 (重要 goal 插队) 留接口

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/goal-queue.mjs` | queue CRUD | 80 |
| `bin/lab.mjs` | CLI 包装 | 80 |

## 不做
- 锁 / 并发保护 (留 P2 跟 L2 phone 编排一起做)
- 自动 GC done 1000+ 行 (留 P3 dashboard 一起做)
- goal 之间的依赖 (goal B 等 goal A done) — 留 P1 run-all
