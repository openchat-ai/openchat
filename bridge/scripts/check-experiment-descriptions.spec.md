# spec: check-experiment-descriptions

> Mirror spec for `scripts/check-experiment-descriptions.mjs`. Required by `verify-commit` quality gate.

## 数据流
1. dev-repl / pre-commit hook 调 `node scripts/check-experiment-descriptions.mjs`
2. 脚本读 `src/experiments/manifest.json` (相对于 repo root)
3. JSON.parse → 失败 → stderr 报错 + exit 1
4. 遍历 `experiments[]`, 每个 entry 跑 `checkEntry()`
5. 累计 results (issues / warnings)
6. stdout 打印汇总 + 详细 FAIL/WARN/TODO 列表
7. 至少一个 FAIL → exit 1, 否则 exit 0

## 接口签名
```js
// CLI entry
node scripts/check-experiment-descriptions.mjs
  → stdout: report
  → stderr: JSON parse error (if any)
  → exit: 0 (all PASS) | 1 (any FAIL)

// Internal (exported via checkEntry logic, not exported as a module)
// checkEntry(entry) → { id, name, issues: string[], warnings: string[] }

// Hard rules:
//   R1: description.length <= 1024
//   R2: third person — no first-person pronouns (I, my, me, 我, 我们, 帮你, 我能)
//   R3: first sentence (split on .!?。！？) <= 80 chars
//   R4: contains "Use when" (case-insensitive)
//   R5: no emoji (U+1F300-1FAFF, U+2600-27BF)

// Soft warnings:
//   W1: trigger list < 3 keywords
//   W2: description contains "ID=<number>" internal field
```

## 边界条件
- manifest.json 不存在 → stderr "cannot read/parse ..." + exit 1
- manifest.experiments 为空数组 → stderr "no experiments" + exit 1
- entry 缺 `description` 字段 → R-missing 计入 issues
- entry `description` 不是 string → R-missing 计入 issues
- emoji 在描述里 → R5 计入 issues, 不阻断运行
- 同时有 FAIL 和 WARN → FAIL 决定 exit code, WARN 仍打印

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| `scripts/check-experiment-descriptions.mjs` | 校验脚本本体 | 200 |
| `scripts/check-experiment-descriptions.spec.md` | 本 spec | - |
| `docs/experiment-description-spec.md` | 规则定义 (source of truth) | 150 |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|--------------|------|
| 1 | `PASS: <N>` | 全 PASS 时 N == experiments.length |
| 2 | `FAIL: <N>` | 有 entry 不合规 |
| 3 | `TODO (description-spec): <N>` | 有 entry 标 `_todo: "description-spec"` |
| 4 | `R4: missing "Use when"` | 大多数 entry 的初次失败原因 |
| 5 | `W2: internal "ID=<number>"` | TODO entry 还有 ID= 尾巴 |

## 已知局限
- 第一句检测用 `.!?。！？` 切分, 不识别复杂缩写 (e.g. "e.g." 会被误切)
- emoji 检测只覆盖两个 Unicode 段, 漏 ASCII art (``:smile:``)
- 不递归校验 `experiments[].tags[]` 等其他字段
- 不校验跨 entry 重复 description