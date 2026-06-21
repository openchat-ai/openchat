# spec: scouts/network
> 网络相关的 scanner（包版本、替代品、基准测试）

## 数据流
scout.mjs 编排 → 各 scanner 独立运行 → 调用 addGoal/addFinding 产出

## 接口签名
- `scanAltExists(project): Promise<number>`
- `scanNewVersion(project): Promise<number>`
- `scanPatch(project): Promise<number>`
- `scanBench(): Promise<number>`
- `scanNewModule(): number`
- `scanRerun(): Promise<number>`

## 边界条件
- 全部空安全（safe() 包装）
- HTTP 调用使用 AbortSignal.timeout(FETCH_TIMEOUT)
- Rerun 跳过 retryCount ≥ 3 的 goal

## 文件清单
| 文件 | 职责 |
|------|------|
| network.mjs | 6 个网络 scanner |
