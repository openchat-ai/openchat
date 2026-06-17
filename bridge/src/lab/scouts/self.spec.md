# spec: scouts/self
> lab 自身健康扫描器，第 6 步元能力

## 数据流
scout.mjs 编排 → scanSelf 扫描 lab 代码 → 检测缺 invariants/硬编码路径 → 产 [lab-health] goal

## 接口签名
- `scanSelf(): number`

## 边界条件
- 扫描 lab/ + lab/scouts/ 两个目录
- >100 行无 invariants 块 → goal
- 硬编码路径（drive letter 模式）→ goal
- 已去重的 issue 跳过（`isProcessed` 检查）

## 文件清单
| 文件 | 职责 |
|------|------|
| self.mjs | lab 自省 scanner |
