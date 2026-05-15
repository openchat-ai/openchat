# bridge/src/main.js 拆分方案

> 当前: 2340 行单一文件 | 目标: 7-8 个模块，主文件 <200 行

## 当前结构分析

```
main.js (2340行)
├── [1-41]      Imports (41 个 import)
├── [44-57]     Helper: fetchLocalModelsFromBridge()
├── [62-188]    CLI 参数解析 (120 行)
├── [189-2340]  class Bridge
│   ├── [190-215]   constructor — 初始化所有子系统
│   ├── [236-687]   start() — 核心启动流程 (451 行!)
│   ├── [688-711]   setupHeadlessSignalHandlers()
│   ├── [713-1420]  startServer() — HTTP 路由注册 (707 行!)
│   │   ├── REST API v1 (agents, p2p, updates, skills, versions, resources)
│   │   ├── Dashboard HTML 生成 (~200行内联HTML)
│   │   └── Provider/Config/Memory/Chat 路由
│   ├── [1443-1856] 各 HTTP handler 方法 (handleStatus, handleChat, etc.)
│   ├── [1858-1873] autoConfigProviders()
│   ├── [1875-1962] handleWSMessage() — WebSocket 消息处理
│   ├── [1964-2006] getCompletions() — CLI Tab 补全
│   ├── [2008-2061] startCLI() — CLI 交互界面
│   ├── [2063-2083] loadHistory/saveHistory()
│   ├── [2085-2153] _startLearningCore/_startFairyMonitor/_reviveMain
│   ├── [2155-2249] _startHeartbeat/_buildKnowledge/_buildNeural
│   └── [2251-2330] shutdown() — 关停流程
└── [2336-2340] 启动入口 startBridge()
```

## 拆分目标

```
bridge/src/
├── main.js                      (~80行) 入口 + 导入 + 启动
├── config/
│   └── cli-args.js              (~120行) CLI 参数解析 [62-188]
├── core/
│   └── bridge-orchestrator.js   (~300行) Bridge 生命周期 [189-215, 236-687, 2251-2330]
├── infra/
│   ├── http-server.js           (~500行) HTTP 服务器 [713-1420]
│   ├── route-handlers.js        (~300行) HTTP handler 方法 [1443-1856]
│   └── ws-gateway.js            (~100行) WebSocket 消息处理 [1875-1962]
├── cli/
│   └── bridge-cli.js            (~150行) CLI 界面/补全/历史 [1964-2083]
└── core/
    ├── learning-loop.js         (~80行) 学习循环 [2085-2153]
    └── fairy-monitor.js         (~100行) 仙女监控/复活 [2155-2249]
```

## 实施步骤 (分 3 个阶段)

### 阶段 1: 抽离最简单、最独立 (1h)
1. **`cli-args.js`** — 纯函数，无副作用
2. **`bridge-cli.js`** — CLI 交互，依赖少

### 阶段 2: 抽离 HTTP 层 (2h)
3. **`http-server.js`** — 路由注册 + Dashboard HTML
4. **`route-handlers.js`** — Handler 方法
5. **`ws-gateway.js`** — WebSocket

### 阶段 3: 抽离核心逻辑 (1.5h)
6. **`bridge-orchestrator.js`** — 启动/关停
7. **`learning-loop.js`** — 学习周期
8. **`fairy-monitor.js`** — 监控/复活

## 风险控制

- 每步拆分后跑 `npm test` (core 26 tests)
- 拆分后跑 `npm start --headless` 验证服务器启动
- 保持所有 import/export 为 ESM 风格
- 不改变任何 public API 签名

## 预计工作量

- 总计: 4-5 小时
- 拆后 main.js: <80 行
- 拆后主文件增加 7 个，每个 <500 行
