# spec: isolation scanner
> 调用 answerFromDNA('isolate') 检测模块边界违规并产出 [boundary] goal

## 数据流
answerFromDNA('isolate') → 解析违规分组 → 每组产出 addFinding + addGoal → 返回违规数

## 接口签名
- `scanIsolation(): Promise<number>` — 返回边界违规总数，0 表示无违规

## 边界条件
- DNA 不存在或不可用 → 0，静默
- 无违规 → 0，无 goal

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `scouts/isolation.mjs` | scanner 实现 | 80 |
| `scout.mjs` | 注册调用 | 2 行 |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|------------|------|
| C1 | `ansFromDNA` | 调用成功 |
| C2 | `boundary violations` | 正则匹配到数字 |
| C3 | `addGoal.*boundary` | 每条违规分组发 goal |
