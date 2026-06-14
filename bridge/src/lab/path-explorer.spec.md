# spec: path-explorer
> 遍历 manifest.json，找出未测试的依赖组合路径。

## 数据流
read manifest → buildReverseDeps() → transitiveDeps() → explore() → recommendations[]

## 接口签名
- `explore()` → `{ ok, totalExperiments, isolated[], recommendations[], stats }`
- `formatExplorerText(result)` → string

## 边界条件
- manifest.json 不存在 → `{ ok:false }`
- 无 closed-loop 实验 → 空结果
- 推荐最多 20 条

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lab/path-explorer.mjs` | 探索引擎 | 130 |
| `lab/path-explorer.spec.md` | 本文件 | - |
