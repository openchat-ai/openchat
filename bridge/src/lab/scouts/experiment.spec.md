# spec: scouts/experiment
> 实验相关的 scanner（探索、退化、自省）

## 数据流
scout.mjs 编排 → 各 scanner 独立运行 → 调用 addGoal/addFinding 产出

## 接口签名
- `scanExplore(): Promise<number>`
- `scanDegradation(): Promise<number>`
- `scanExpIntrospect(): number`

## 边界条件
- 全部空安全（safe() 包装）
- 退化检测：最近 5 次中失败 ≥3 次为异常

## 文件清单
| 文件 | 职责 |
|------|------|
| experiment.mjs | 3 个实验 scanner |
