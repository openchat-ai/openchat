# spec: tui/tui.mjs — Lab TUI 入口
> 键盘导航 + 视图状态机（list / detail / panel）

## 数据流
main() → loadExperiments → rebuild(groups/flat) → draw()
keypress → onKey() 按 view 路由 → 改 state / 触发 panelRun/freeQuery → draw()
非 TTY → staticDump() 静态打印后退出

## 接口签名
- 无导出（可执行入口）
- 内部：draw() / onKey(str,key) / panelRun(fn,title) / freeQuery() / quit() / staticDump()
- 键位：↑↓ 移动，⏎ 详情，d DNA 摘要，r run-all，/ 自由查询，t 跑 test，Esc 返回，q 退出

## 边界条件
- 退出必须 setRawMode(false) + 恢复光标 `\x1b[?25h`
- busy 标志防止异步动作期间按键重入
- flat[] 与 groups 展开顺序一致，selected 环形索引
- keypress handler 内 async 错误被 catch，清 busy 并重绘

## 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| tui/tui.mjs | 入口 + 主循环 + 键盘路由 | 200 |
