# MEMORY.md — 项目记忆

## 经验教训

- [2026-04-29] 跨平台部署网站：build-deploy.js + 9平台 + Bridge自带/deploy路由
- [2026-04-29] LLM代理：子桥零配置用母桥key，llmProxyEnabled开关
- [2026-04-29] House实体化：.openchat/houses/{houseId}/ 数据目录
- [2026-04-29] 术语统一：hostId/bridgeId/houseId 三层，safeHouse跨机验证
- [2026-04-29] PM2启动策略 + launch-strategies.js
- [2026-04-29] P2R-S: 居民安全自治 (多方验证+热回滚)
- [2026-04-29] P2R: 居民治家 (3窟+维护+迁移)
- [2026-04-25] 安全增强：实现限流（分路由）+ 黑名单评分系统 + 蜜罐路由 + 封禁到期自动释放
- [2026-04-25] 认证改为 Bearer Token，移除 optionalAuth
- [2026-04-25] 代码重构：agent-session.js 从 8862 行拆分为 10 个独立模块，减少 81.5% 代码量
- [2026-04-25] 配置统一：所有配置集中在用户主目录 `~/.openchat/config.json`
- [2026-04-24] 安全改进：添加 .gitignore、API 认证中间件、安全命令执行模块

## 最近会话摘要

- [2026-04-29] 完善跨平台部署：build-deploy.js 9平台打包 + install脚本 + 自动IP检测
- [2026-04-29] Bridge自带部署站点：/deploy路由 + 启动自动构建
- [2026-04-29] LLM代理系统：llm-proxy-agent.js + 自动发现邻居 + llmProxyEnabled开关
- [2026-04-29] House实体化：house.js + .openchat/houses/ + cleanHouse/backupHouse
- [2026-04-29] 术语统一：hostId/bridgeId/houseId + safeHouse跨机验证 (≥2不同hostId)
- [2026-04-29] 完成 P2R-S: 居民安全自治系统 (safe-evolution.js + bridge-spawn.js 等)
- [2026-04-29] 完成 P2R: 居民治家系统 (3 safe houses + migration)
- [2026-04-29] 35+文档更新，版本号/日期统一

## 主题文件路由表

> 涉及以下领域时读取对应文件

| 触发词 | 文件 | 说明 |
|--------|------|------|
| 核心逻辑 | memory/core-logic.md | 核心业务逻辑 |
| 调试经验 | memory/debugging.md | 调试经验、常见 bug |
| 重构 | memory/refactoring.md | 重构经验总结 |
| 安全 | memory/security.md | 安全策略和防护机制 |

## 开放线程

- [2026-04-29] 跨机P2P+居民迁移测试（需第二台设备）
- [2026-04-29] LLM真实对话测试
- [2026-04-29] SafeEvolution端到端验证（提案→验证→回滚）
- [2026-04-29] PM2 + Docker启动策略端到端测试
- [2026-04-29] deploy/分发到目标机器实测
- [2026-04-29] resiov64 + FreeBSD Node.js无官方二进制，需fallback方案