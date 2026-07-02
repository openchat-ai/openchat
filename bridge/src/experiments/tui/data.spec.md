# spec: tui/data.mjs — TUI 数据源
> 只读加载 manifest 实验清单 + 桥接 DNA 查询

## 数据流
`manifest.json` → loadExperiments() 归一 → groupByLevel() 按智能分级分组 → TUI 渲染
DNA: `42.mjs` getDNAContext/answerFromDNA → dnaContext()/dnaQuery() → TUI 面板

## 接口签名
- `loadExperiments(): Promise<Exp[]>` — Exp={id,name,file,level,status,deps,category,pure,desc}
- `groupByLevel(exps): {level, items}[]` — 按 LEVEL_ORDER
- `findDependents(exps, id): string[]`
- `dnaContext(): Promise<string>`
- `dnaQuery(query): Promise<string>`

## 边界条件
- id 可能是 number/string → 一律 String()
- 未知 intelligenceLevel → 归 '—'
- DNA import 失败 → 返回错误字符串，不抛（TUI 不崩）

## 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| tui/data.mjs | 数据加载 + DNA 桥接 | 200 |
