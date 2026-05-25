# Bridge 部署计划

> **版本**: 2.0 | **更新**: 2026-04-29 | **状态**: 单机验证通过，跨机待测

---

## 一、当前状态（已验证）

| 项目 | 状态 | 备注 |
|------|------|------|
| `npm install` | ✅ 120 packages | 依赖完整，无缺失 |
| `node src/main.js` | ✅ 启动成功 | P2P + API + 调度器 + 居民 全链路 |
| HTTP API (3000) | ✅ `/api/status`, `/api/providers` | REST 服务器 (3001) 也正常 |
| P2P Hyperswarm | ✅ topic 加入 | DHT 无 bootstrap 时 5s 超时 |
| P2P 直连 TCP | ✅ 端口 3002 | 自动启用，--nesting 子进程自动连父 |
| 居民系统 | ✅ 管家 + 小帮手 | 创建/遗传/睡眠/协作全链路 |
| House 目录 | ✅ `~/.openchat/houses/{hostId}_default/` | house.json / memory / skills / workspace |
| hostId 持久化 | ✅ UUID v4 | 首次启动自动生成，config.json 存储 |
| PM2 策略 | ⬜ 代码就绪未实测 | `launch-strategies.js` 待端到端验证 |

---

## 二、单机部署

### 2.1 前置条件

- **Node.js 18+**（推荐 22.x）
- **npm**（随 Node.js 自带）
- 网络：首次 `npm install` 需外网

### 2.2 安装

```bash
cd bridge/
npm install
```

### 2.3 启动

```bash
# 前台运行（开发/调试）
node src/main.js

# CLI 交互模式
node src/main.js --cli

# 后台运行（需安装 PM2）
npm run pm2:start
```

启动后：

| 端口 | 用途 | 说明 |
|------|------|------|
| 3000 | HTTP + WebSocket | `/api/status`, `/ws` 聊天, `/signaling` 信令 |
| 3001 | REST API | `/api/v1/agents`, `/api/v1/p2p` 等 |
| 3002 | P2P 直连 TCP | 同机多 Bridge 互联（自动启用） |

### 2.4 验证

```bash
# 健康检查
curl http://localhost:3000/api/status

# 查看居民
curl http://localhost:3001/api/v1/agents
```

### 2.5 配置

配置文件：`~/.openchat/config.json`

```json
{
  "providers": {
    "openrouter": { "apiKey": "sk-...", "enabled": true, "baseURL": "https://openrouter.ai/api/v1" }
  },
  "current": { "provider": "openrouter", "model": "openrouter/free" },
  "bridge": {
    "hostId": "auto-uuid",
    "port": 3000,
    "name": "my-bridge",
    "region": "cn-east",
    "directListen": 3002,
    "directConnect": [{ "host": "192.168.1.100", "port": 3002 }]
  }
}
```

---

## 三、多机部署

### 3.1 网络拓扑

```
Bridge A (母机)          Bridge B (子机)          Bridge C (子机)
192.168.1.100            192.168.1.101            192.168.1.102
├── port 3000 HTTP        ├── port 3000 HTTP        ├── port 3000 HTTP
├── port 3001 REST        ├── port 3001 REST        ├── port 3001 REST
├── port 3002 P2P-TCP ────┤── port 3002 P2P-TCP ────┤── port 3002 P2P-TCP
└── hostId: aaaa          └── hostId: bbbb          └── hostId: cccc
```

### 3.2 子机配置

子机只需在 `config.json` 中配置母机的直连地址，无需 DHT：

```json
{
  "bridge": {
    "directConnect": [{ "host": "192.168.1.100", "port": 3002 }]
  }
}
```

### 3.3 跨机验证标准

安全屋（safeHouse）跨机最小保证：

- 至少 **3** 个有效安全屋
- 来自至少 **2** 台不同机器（不同 `hostId`）
- 每 **1 小时** 验证一次（过期自动重新找窟）

### 3.4 居民迁移

```
Bridge A 健康分过低
  → decideActions() 出 migrate 决策
  → switchHouse() 选目标 Bridge 的窟
  → createResidentTransferMessage() 发 P2P
  → Bridge B 收到 → create() 居民 + 创建 migrated House
  → 原 bridge 记为首个安全屋
```

---

## 四、同机扩窟（Nesting）

单机最多 3 个子 Bridge 实例，各占独立端口：

```
主 Bridge (3000) ──→ 子 Bridge 1 (3002, 3003)
                    └── 子 Bridge 2 (3002, 3004)
                    └── 子 Bridge 3 (3002, 3005)
```

每个子 Bridge 自动：
1. 继承父的 `hostId`
2. 创建独立 House：`~/.openchat/houses/{hostId}_{port}/`
3. 通过直连 TCP 与父通信

### 触发方式

居民通过 HouseOrchestrator 决策自动扩窟，或手动：

```bash
node src/main.js --nesting --port=3003 --name=nest-1 --parent=bridge-1
```

---

## 五、PM2 生产部署

### 5.1 安装

```bash
npm install -g pm2     # 全局安装
# 或
npm install pm2        # 项目 optionalDependencies
```

### 5.2 启动

```bash
npm run pm2:start
# 等价于：
pm2 start ecosystem.config.cjs
```

### 5.3 管理

```bash
npm run pm2:status     # pm2 status
npm run pm2:stop       # pm2 delete peertalk-bridge
```

### 5.4 自动重启策略

| 条件 | 行为 |
|------|------|
| 进程崩溃 | PM2 立即拉起 |
| 内存 > 500MB | PM2 自动重启 |
| 机器重启 | `pm2 startup` 注册系统服务 |

---

## 六、跨平台状态

| 平台 | 启动测试 | 备注 |
|------|----------|------|
| Windows x64 | ✅ 通过 | 本机验证，全链路正常 |
| macOS arm64 | ⬜ 未测 | node_modules 需重新 `npm install` |
| macOS x64 | ⬜ 未测 | 同上 |
| Linux x64 | ⬜ 未测 | 同上 |
| Linux arm64 | ⬜ 未测 | 树莓派，同上 |
| FreeBSD | ⬜ 未测 | node 有 port，依赖可能不兼容 |

---

## 七、待验证清单

| # | 项目 | 优先级 | 当前状态 |
|---|------|--------|----------|
| 1 | 多 Bridge P2P 互联 | P0 | ⬜ 未跨机测试 |
| 2 | safeHouse 跨机验证 | P0 | ⬜ 无第二台 Bridge 可验证 |
| 3 | 居民迁移完整流程 | P0 | ⬜ switchHouse → transfer → create 链路 |
| 4 | PM2 端到端测试 | P1 | ⬜ 代码就绪未跑过 |
| 5 | LLM 真实对话 | P1 | ⬜ provider 已配未测试 |
| 6 | SafeEvolution 提案-验证-回滚 | P1 | ⬜ 代码就绪未跑过 |
| 7 | macOS/Linux 启动 | P2 | ⬜ 未测试 |
| 8 | Nesting 扩窟 | P2 | ⬜ child spawn 逻辑未实测 |
| 9 | House backupHouse() | P3 | ⬜ 代码就绪未触发 |
| 10 | **LLM 代理** (llm-proxy-agent.js + P2P) | P0 | ⬜ 代码未写 |
| 11 | **deploy/ 打包** (node.exe + install脚本 + index.html) | P1 | ⬜ 目录未创建 |
| 12 | deploy/ 分发到目标机器（跨机安装） | P2 | ⬜ 待跨机网络就绪 |

---

## 八、快速启动（从零到跑）

```bash
# 1. 克隆
git clone <repo> && cd bridge

# 2. 装依赖
npm install

# 3. 配 LLM（可选，居民需要 LLM 才能对话）
# 编辑 ~/.openchat/config.json，添加 provider 配置

# 4. 启动
node src/main.js

# 5. 检查
curl http://localhost:3000/api/status
curl http://localhost:3001/api/v1/agents
```

无 LLM 时 Bridge 也能启动，居民调度器会运行但协作功能受限。

---

## 九、LLM 代理（子桥零配置）

### 9.1 核心理念

子桥不持有 API key，居民思考通过 P2P 发给母桥代理调用 LLM。

### 9.2 架构

```
子桥居民                                    母桥
  └─ think()                            ┌─ LLMProxyAgent
       └─ P2P: LLM_PROXY ───────────────→│
              { model, messages,         │  调用 provider
                residentId, tracing }    │  (母桥持有的 key)
              ←─────────────────────────│
                  LLM_RESPONSE           │
              { content, tokens, ok }    │
```

### 9.3 config.json 新增字段

母桥（提供服务方）：
```json
{
  "bridge": {
    "llmProxyEnabled": true
  }
}
```

子桥（零配置方）：
```json
{
  "bridge": {
    "llmMode": "proxy",
    "llmProxyBridgeId": "<母桥 swarmId>"
  }
}
```

### 9.4 所需代码变更

| # | 文件 | 内容 |
|---|------|------|
| 1 | `core/llm-proxy-agent.js` (新) | 母桥侧 — 监听 P2P，接收请求 → 调 provider → 返回结果 |
| 2 | `p2p/messages.js` | 新增 `createLLMProxyRequest()` / `createLLMResponse()` |
| 3 | `p2p/swarm.js` | 新增 `LLM_PROXY` / `LLM_RESPONSE` case 处理 |
| 4 | `main.js` | 母桥注册 LLMProxyAgent |
| 5 | `resident-manager.js` | 居民 `think()` 检测 llmMode → 走代理 P2P |

### 9.5 与多机部署的关系

部署包中 `config.json` 已预置：
```json
{
  "bridge": {
    "llmMode": "proxy",
    "llmProxyBridgeId": "<母桥 swarmId>",
    "directConnect": ["母桥IP:3002"]
  }
}
```

子桥启动后 P2P 直连母桥 → 居民自动通过代理获取 LLM → **零配即用**。

---

## 十、deploy/ 部署包

### 10.1 核心理念

目标机器**不安装任何东西** — 便携版 Node.js 自带，双击/一行命令即跑。

不依赖 git、curl、winget、npm。唯一前提：浏览器或 PowerShell/Terminal。

### 10.2 目录结构

```
deploy/
├── index.html                          # 自动识别 OS 的下载页面
├── deploy.ps1                          # Windows 一键远程安装
├── deploy.sh                           # macOS/Linux/Unix 一键远程安装
│
├── windows/
│   ├── node.exe                        # Node.js v22 便携版 (~50MB)
│   ├── bridge/
│   │   ├── src/
│   │   ├── node_modules/               # 母机预装（同平台）
│   │   ├── package.json
│   │   └── config.json                 # 预置 hostId + 母桥IP + llmMode
│   └── install.bat                     # 双击即跑
│
├── macos-arm64/
│   ├── node-v22-darwin-arm64/
│   ├── bridge/
│   └── install.command                 # Finder 双击自动开终端
│
├── linux-x64/
│   ├── node-v22-linux-x64/
│   ├── bridge/
│   └── install.sh
│
└── linux-arm64/                        # 树莓派
    └── (同上)
```

### 10.3 各平台启动脚本

**Windows `install.bat`** — 双击即用：
```bat
@echo off
title PeerTalk Bridge
cd /d "%~dp0"
set PATH=%~dp0;%PATH%
start /b node bridge\src\main.js --save-config > bridge.log 2>&1
echo Bridge 已启动 (PID 查看 bridge.log)
pause
```

**macOS `install.command`** — Finder 双击自动打开终端执行：
```bash
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$DIR:$PATH"
"$DIR/node" "$DIR/bridge/src/main.js" --save-config &
echo "Bridge 已启动，PID=$!"
```

**Linux/Unix `install.sh`**：
```bash
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$DIR:$PATH"
"$DIR/node" "$DIR/bridge/src/main.js" --save-config &
echo "Bridge 已启动，PID=$!"
```

### 10.4 远程一键安装

**Windows PowerShell**（目标机器 Win+R → `powershell`）：
```powershell
iex (iwr http://母机IP:8080/deploy.ps1).Content
```

**macOS/Linux/Unix 终端**：
```bash
curl -s http://母机IP:8080/deploy.sh | bash
```

### 10.5 浏览器安装页面

母机启动 HTTP 服务后：`http://母机IP:8080`

index.html 自动检测 OS，高亮对应安装方式，提供 ZIP 下载或一行命令。

### 10.6 node_modules 兜底

非 Windows 平台无预装 node_modules，install 脚本内置降级：
```bash
if [ ! -d "bridge/node_modules" ]; then
  echo "首次运行，安装依赖..."
  "$DIR/node" "$DIR/bridge/npm-cli.js" install --production
fi
```

### 10.7 生成清单

| # | 任务 | 文件 | 大小 |
|---|------|------|------|
| 1 | 下载 node.exe | `deploy/windows/node.exe` | ~50MB |
| 2 | 复制 bridge 源码 | `deploy/windows/bridge/src/` | ~200KB |
| 3 | 预装 node_modules | `deploy/windows/bridge/node_modules/` | ~150MB |
| 4 | 生成 config.json | `deploy/windows/bridge/config.json` | ~500B |
| 5 | 编写 install.bat | `deploy/windows/bridge/install.bat` | ~200B |
| 6 | 编写 deploy.ps1 | `deploy/deploy.ps1` | ~1KB |
| 7 | 编写 deploy.sh | `deploy/deploy.sh` | ~1KB |
| 8 | 编写 index.html | `deploy/index.html` | ~3KB |
| 9 | 启动 HTTP 服务 | `npx http-server deploy/ -p 8080` | - |

### 10.8 首次部署 + 后续升级

| 阶段 | 通道 | 内容 |
|------|------|------|
| 首次部署 | HTTP（母机开 8080） | 下载完整包 → 双击/命令启动 |
| 后续升级 | P2P | JS 增量 patch / 配置 merge / deps 更新 |
