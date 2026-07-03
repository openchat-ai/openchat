# spec: tui/actions.mjs — 实验运行动作
> 跑单实验 test / 跑 run-all，带超时保护

## 数据流
Exp → runOne(): findTestFn(experiments-all) 或动态 import 独立文件 → withTimeout(test()) → 格式化结果字符串
Exp[] → runAllSummary(): 遍历 closed-loop 实验逐个跑 → 汇总 pass/total

## 接口签名
- `runOne(exp): Promise<string>` — 单实验 test，返回 "✓/✗ id (ms)\n\ninfo"
- `runAllSummary(exps): Promise<string>` — 批量结果汇总

## 边界条件
- 每个 test 限 TIMEOUT_MS=15000，超时不卡死 TUI
- experiments-all.mjs 懒加载（有初始化副作用），首调才 import
- 独立文件（含 '/' 或非 experiments-all 前缀）走 mod.test
- 无 test 函数 → 返回失败字符串，不抛

## 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| tui/actions.mjs | 实验运行 + 超时保护 | 200 |
