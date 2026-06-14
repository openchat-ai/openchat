# spec: digest
> 分析最近 N 次运行，输出退化/趋势/建议。支持 LLM 增强报告。

## 数据流
listHistory() → computeDigest(N) → formatDigestText() → stdout

## 接口签名
- `computeDigest(N)` → `{ ok, experiments[], summary }`
- `formatDigestText(digest)` → string
- `llmDigest(N)` → `{ ok, text }`

## 边界条件
- 无历史 → `{ ok:false, reason:'no history data' }`
- N > 总记录数 → 用全部
- trend 需要对比周期有数据，否则 null

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lab/digest.mjs` | 分析引擎 | 100 |
| `lab/digest.spec.md` | 本文件 | - |
