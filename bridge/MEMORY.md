# MEMORY.md — 项目记忆

## 经验教训

- [2026-04-29] 部署网站与Bridge合并：/deploy路由 + 启动自动build，不需要独立服务器
- [2026-04-29] build-deploy.js: 自动检测本机IP，不再硬编码；install脚本自动检测ARCH下载node
- [2026-04-29] LLM代理：子桥搭母桥key，llmProxyEnabled可关闭，邻居自动发现
- [2026-04-29] House实体化：bridge管理多个house，每个有独立数据目录
- [2026-04-29] 术语统一：hostId(Bridge物理标识)/bridgeId(P2P标识)/houseId(居民感官层)
- [2026-04-29] 跨机验证：safeHouse需≥2不同hostId才安全
- [2026-04-29] P2R-S: 多方验证+5s/30s看门狗+.bak热回滚
- [2026-04-29] TCP 粘包修复，4字节长度头

## 最近会话摘要

- [2026-04-29] build-deploy.js: 9平台一键打包 + install脚本 + index.html + deploy.ps1/sh
- [2026-04-29] Bridge启动自动构建deploy/，/deploy路由挂在API 3001端口
- [2026-04-29] LLM代理: llm-proxy-agent.js + auto-discovery + llmProxyEnabled开关
- [2026-04-29] House实体化: house.js + .openchat/houses/ + cleanHouse/backupHouse
- [2026-04-29] 术语统一: hostId/bridgeId/houseId + safeHouse跨机验证
- [2026-04-29] PM2策略: launch-strategies.js + package.json pm2脚本
- [2026-04-29] 完成 P2R-S: safe-evolution, bridge-spawn, house-orchestrator, llm-proxy-agent 等

## 主题文件路由表

> 涉及以下领域时读取对应文件

| 触发词 | 文件 | 说明 |
|--------|------|------|
| 核心逻辑 | memory/core-logic.md | 核心业务逻辑 |
| 调试经验 | memory/debugging.md | 调试经验、常见 bug |

## 开放线程

- [2026-04-29] 跨机P2P测试 — 需要第二台设备
- [2026-04-29] LLM真实对话测试 — provider已配未测
- [2026-04-29] SafeEvolution端到端验证 — 代码就绪未跑过
- [2026-04-29] PM2端到端测试 — 代码就绪未跑过
- [2026-04-29] Nesting扩窟测试 — child spawn逻辑未实测
- [2026-04-29] macOS/Linux平台实测 — node_modules需目标环境preinstall