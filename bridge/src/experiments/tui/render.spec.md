# spec: tui/render.mjs — 纯渲染
> 入参 → 彩色字符串，无副作用

## 数据流
数据对象 (groups / exp / text) → render 函数 → 字符串 → tui.mjs 写终端

## 接口签名
- `header(): string`
- `renderList(groups, flatSelected): string`
- `renderDetail(exp, dependents): string`
- `renderPanel(title, text): string`
- `box(title, lines): string`

## 边界条件
- 宽度按 process.stdout.columns，兜底 80，上限 100
- clip 用 ANSI_RE 剥色再计长度，避免转义序列撑爆宽度
- selectedIdx 越界由调用方保证

## 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| tui/render.mjs | 纯渲染函数 | 200 |
