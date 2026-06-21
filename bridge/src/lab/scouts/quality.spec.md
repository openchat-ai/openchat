# spec: scouts/quality
> 代码质量相关的 scanner（P1/P2、测试覆盖、依赖对齐、配置校验）

## 数据流
scout.mjs 编排 → 各 scanner 独立运行 → 调用 addGoal/addFinding 产出

## 接口签名
- `scanForLeftoverP2(): number`
- `scanForSyntaxErrors(): number`
- `scanTestCoverage(): number`
- `scanDepsParity(): number`
- `scanConfigSchema(): number`

## 边界条件
- 全部空安全（safe() 包装）
- 文件扫描深度 ≤ 10（DepsParity 限制为 3）
- parseJS 验证所有目标文件

## 文件清单
| 文件 | 职责 |
|------|------|
| quality.mjs | 5 个质量 scanner |
