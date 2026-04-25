# 核心逻辑记忆

> 触发词：核心、core、业务逻辑

## 模块架构

### P2R-S 居民自治系统 (2026-04-29)
```
SafeEvolution (safe-evolution.js)
├── 提案系统: resident → 提出代码变更
├── 验证系统: ≥2 邻居验证 + riskScore 评分
├── 共识系统: 多数同意 → 执行
├── 备份系统: .bak 文件 → .openchat/backups/
├── 看门狗: 5s 快速 + 30s 深度
└── 热回滚: 异常 → 自动恢复 .bak

HouseOrchestrator (house-orchestrator.js)
├── 3 safe houses (狡兔三窟)
├── 维护监控: CPU/内存/磁盘
├── 迁移系统: house 间迁移
└── 接入 SafeEvolution

BridgeSpawn (bridge-spawn.js)
├── 同机子进程: child_process.spawn
└── 跨机脚本: 部署脚本生成
```

### P2P 通信
```
4字节长度头: 解决 TCP 粘包
WebSocket 信令: /signaling
PeerRegistry: Qiniu + HTTP 后端
```

## 经验教训

- [2026-04-29] 居民修改代码必须经过多方验证，保护主机不受损
- [2026-04-29] 5s + 30s 看门狗双重保护，快速响应 + 深度检测
- [2026-04-29] .bak 备份简单有效，比 git 回滚更快
- [2026-04-29] 3窟保证迁移有退路