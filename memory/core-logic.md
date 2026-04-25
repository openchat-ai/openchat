# 核心逻辑记忆

> 触发词：核心、core、业务逻辑

## 模块架构

### Bridge P2R-S 系统
```
SafeEvolution (safe-evolution.js)
├── 提案→2+邻居验证→共识→备份→5s/30s看门狗→热回滚
├── riskScore 评分系统
└── .bak 备份 + .openchat/backups/

HouseOrchestrator (house-orchestrator.js)
├── 3 safe houses (狡兔三窟)
├── 维护监控、迁移
└── 接入 SafeEvolution

BridgeSpawn (bridge-spawn.js)
├── 同机子进程
└── 跨机部署脚本
```

### P2P 通信
- 4字节长度头 (TCP 粘包)
- WebSocket 信令 (/signaling)
- Qiniu 作为国内 rendezvous

## 经验教训

- [2026-04-29] 居民修改代码必须多方验证，保护主机
- [2026-04-29] 5s + 30s 看门狗双重保护
- [2026-04-29] .bak 备份比 git 回滚更快
- [2026-04-25] 安全: 限流分路由 + 黑名单评分 + 蜜罐路由
- [2026-04-25] Bearer Token 认证
- [2026-04-25] 配置统一在 ~/.openchat/config.json