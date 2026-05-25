# 🔄 PeerTalk 代码与规范对齐计划

> **目标**: 采用混合方案，保留代码优势，修正不合理规范，补完关键功能
> **策略**: C = 保留好的 + 修正规范 + 补完核心
> **时间**: 8-10 周（原计划 16 周的优化版）

---

## 📊 当前状态总结

| 规范 | 代码完成度 | API 完成度 | 关键问题 |
|------|-----------|-----------|---------|
| P0-02 多代理 | 20% | 0/13 | 无 REST API，无 5 角色类型 |
| P0-03 P2P | 0% | 0/13 | **完全缺失** |
| P0-01 热更新 | 10% | 0/9 | 重启非热更新，无 Watchdog |
| P0-04 版本市场 | 8% | 0/11 | 无版本链，无市场 |
| P0-05 资源优化 | 5% | 0/5 | **完全缺失** |

**总体**: 46,971 行代码，但与规范匹配度只有 ~9%

---

## 🎯 混合方案策略

### ✅ 保留代码中的优势

| 已有功能 | 状态 | 决策 |
|---------|------|------|
| **多代理协作基础** | ✅ 良好 | 保留，只需补完角色类型和 API |
| **LLM 提供者适配** | ✅ 完善 | 保留，6+ 提供者已够用 |
| **会话管理** | ✅ 良好 | 保留 |
| **插件系统** | ✅ 良好 | 保留 |
| **错误恢复** | ✅ 良好 | 保留 |
| **测试框架** | ✅ 基础完备 | 保留并扩展 |

### 📝 修正规范中的不合理要求

| 规范要求 | 问题 | 修正方案 |
|---------|------|---------|
| **51 个 API 端点** | 过多，维护成本高 | 精简到 **25-30 个核心端点** |
| **4 层 Watchdog (500ms/5s/30s/60s)** | 过于复杂 | 简化为 **2 层 (5s/30s)** |
| **完整 DHT 实现** | 工作量大，可用现成库 | 使用 **libp2p 或 hyperswarm** |
| **自定义加密协议** | 重复造轮子，安全风险 | 使用 **TLS + libp2p 加密** |
| **7 阶段 Skill 生命周期** | 过于复杂 | 简化为 **4 阶段** (create → validate → publish → use) |
| **完整语义压缩** | AI 成本高 | 改用 **传输层压缩** (gzip/brotli) |

### 🔴 补完关键缺失功能（优先级排序）

#### 阶段 1: 基础设施（2-3 周）✅ 最高优先级
1. **REST API 层** (所有规范的基础)
2. **基础 P2P 通信** (使用 libp2p)
3. **基础加密** (TLS)

#### 阶段 2: P0-02 补完（1-2 周）
4. **5 种代理角色类型**
5. **反馈聚合改进**
6. **决策记录系统**

#### 阶段 3: P0-03 核心（2-3 周）
7. **P2P 消息类型**
8. **优先级队列**
9. **离线队列**

#### 阶段 4: P0-01/04/05（2-3 周）
10. **真正的热更新**
11. **版本快照管理**
12. **基础资源优化**

---

## 📋 详细实施计划

### 🔹 阶段 1: 基础设施（Week 1-3）

#### Task 1.1: REST API 框架（3 天）
**目标**: 为所有 P0 模块提供统一的 REST API 层

```javascript
// 技术选型
- Express.js (已有依赖)
- 路由分组: /api/v1/agents, /api/v1/p2p, /api/v1/updates, /api/v1/skills, /api/v1/resources
- 统一响应格式
- 错误处理中间件
- 请求验证（Joi）
```

**交付物**:
- `bridge/src/api/server.js` - API 服务器
- `bridge/src/api/routes/*.js` - 路由模块
- `bridge/src/api/middleware/*.js` - 中间件
- 10-15 个核心端点框架

**修改的规范**: 精简 API 端点数量
- P0-02: 13 → 8 个端点
- P0-03: 13 → 8 个端点
- P0-01: 9 → 5 个端点
- P0-04: 11 → 7 个端点
- P0-05: 5 → 3 个端点
- **总计**: 51 → **31 个端点**

---

#### Task 1.2: P2P 通信基础（5 天）
**目标**: 使用成熟库实现基础 P2P 能力

```javascript
// 技术选型
选项 A: libp2p (IPFS 使用的，成熟稳定)
选项 B: hyperswarm (更轻量，DHT 内置)

推荐: hyperswarm（理由：更简单，内置 DHT，适合小规模网络）
```

**交付物**:
- `bridge/src/p2p/swarm.js` - P2P 网络管理
- `bridge/src/p2p/discovery.js` - 节点发现
- `bridge/src/p2p/message-handler.js` - 消息处理
- 基础连接、发现、消息传递能力

**修改的规范**:
- ❌ 删除自定义 DHT 实现要求
- ❌ 删除自定义加密协议要求
- ✅ 改为：使用 hyperswarm + TLS

---

#### Task 1.3: 基础加密和认证（2 天）
**目标**: 安全的节点间通信

```javascript
// 使用现成的加密
- TLS 1.3 (hyperswarm 内置)
- 节点证书管理
- 消息签名（可选，先不做）
```

**交付物**:
- `bridge/src/security/certificate-manager.js` - 证书管理
- 节点身份验证

**修改的规范**:
- ❌ 删除 ECDSA 签名要求（阶段 1）
- ✅ 改为：TLS 证书认证

---

### 🔹 阶段 2: P0-02 多代理协作补完（Week 4-5）

#### Task 2.1: 5 种代理角色类型（3 天）
**目标**: 实现规范要求的 5 种标准角色

**当前代码**:
```javascript
// bridge/src/agents/ 中有基础代理
// 但是通用的，没有类型区分
```

**修改方案**:
```javascript
// 新增角色枚举
const AgentRole = {
  SECURITY_AUDITOR: 'security_auditor',
  CODE_QUALITY_ANALYZER: 'code_quality_analyzer',
  PERFORMANCE_ANALYZER: 'performance_analyzer',
  TEST_ENGINEER: 'test_engineer',
  CUSTOM: 'custom'
};

// 每种角色有专属的 system prompt 和能力
class SecurityAuditorAgent extends BaseAgent { ... }
class CodeQualityAgent extends BaseAgent { ... }
// ...
```

**交付物**:
- `bridge/src/agents/roles/` 目录
- 5 个角色类实现
- 角色工厂（根据类型创建）

---

#### Task 2.2: 反馈聚合改进（2 天）
**目标**: 实现规范要求的 4 步聚合流程

**当前代码**:
```javascript
// result-aggregator.js 有基础聚合
// 但缺少：规范化、去重、优先级
```

**修改方案**:
```javascript
class FeedbackAggregator {
  // 1. 规范化（按角色类型）
  normalize(feedback, agentRole) { ... }

  // 2. 去重（相似度检测）
  deduplicate(feedbackList) { ... }

  // 3. 优先级排序（CRITICAL/HIGH/MEDIUM/LOW）
  prioritize(feedbackList) { ... }

  // 4. 冲突解决
  resolveConflicts(feedbackList) { ... }
}
```

**交付物**:
- 改进的 `bridge/src/agents/feedback-aggregator.js`
- 分类规范化逻辑
- 去重算法（文本相似度）

---

#### Task 2.3: REST API 实现（2 天）
**目标**: 8 个核心 API 端点

**精简后的端点**（从 13 → 8）:
```
POST   /api/v1/agents                    创建代理
GET    /api/v1/agents/:id                获取代理
GET    /api/v1/agents/:id/feedback       获取反馈
DELETE /api/v1/agents/:id                终止代理
GET    /api/v1/agents                    列出代理
POST   /api/v1/feedback/aggregate        聚合反馈
POST   /api/v1/decisions                 创建决策
GET    /api/v1/decisions/:id             获取决策
```

**交付物**:
- `bridge/src/api/routes/agents.js`
- `bridge/src/api/routes/feedback.js`
- `bridge/src/api/routes/decisions.js`

---

### 🔹 阶段 3: P2P 通信核心（Week 6-8）

#### Task 3.1: 6 种 P2P 消息类型（3 天）
**目标**: 实现跨 Bridge 通信的消息协议

```javascript
const MessageType = {
  SKILL_PUBLISH: 'skill_publish',      // 发布技能
  SKILL_REQUEST: 'skill_request',      // 请求技能
  COLLABORATION_REQUEST: 'collaboration_request',  // 协作请求
  COLLABORATION_RESPONSE: 'collaboration_response', // 协作响应
  INSIGHT_SHARE: 'insight_share',      // 洞察共享
  PERFORMANCE_REPORT: 'performance_report' // 性能报告
};
```

**交付物**:
- `bridge/src/p2p/messages/` 目录
- 6 种消息类型的序列化/反序列化
- 消息验证

---

#### Task 3.2: 优先级队列（2 天）
**目标**: 按优先级处理消息

```javascript
// 4 个优先级（规范简化版）
const Priority = {
  CRITICAL: { level: 0, maxDelay: 1000 },    // 1s
  HIGH: { level: 1, maxDelay: 10000 },       // 10s
  NORMAL: { level: 2, maxDelay: 300000 },    // 5min
  LOW: { level: 3, maxDelay: 86400000 }      // 1day
};
```

**交付物**:
- `bridge/src/p2p/priority-queue.js`
- 优先级处理逻辑

---

#### Task 3.3: 离线队列（2 天）
**目标**: 节点离线时缓存消息

**交付物**:
- `bridge/src/p2p/offline-queue.js`
- 消息持久化
- 重连后自动发送

---

#### Task 3.4: P2P REST API（2 天）
**目标**: 8 个核心端点（从 13 → 8）

```
POST   /api/v1/p2p/messages              发送消息
GET    /api/v1/p2p/messages/:id          查询消息
GET    /api/v1/p2p/inbox                 收件箱
GET    /api/v1/p2p/peers                 节点列表
POST   /api/v1/p2p/peers/:id/connect     连接节点
DELETE /api/v1/p2p/peers/:id             断开节点
GET    /api/v1/p2p/stats                 统计信息
PUT    /api/v1/p2p/config                配置
```

**交付物**:
- `bridge/src/api/routes/p2p.js`

---

### 🔹 阶段 4: 热更新、版本、优化（Week 9-10）

#### Task 4.1: 真正的热更新（3 天）
**目标**: 动态加载代码，不重启服务

**当前问题**:
- 现在是文件改变 → kill 进程 → 重启
- 需要改为：动态 require 新代码

**修改方案**:
```javascript
// 热更新管理器
class HotUpdateManager {
  async applyUpdate(version) {
    // 1. 下载新版本
    // 2. 本地测试
    // 3. 动态加载（不重启）
    // 4. 监控（2 层 Watchdog）
    // 5. 失败则回滚
  }
}
```

**修改的规范**:
- 4 层 Watchdog → **2 层** (5s + 30s)
- 删除 P2P 版本发现要求（阶段 4，先用手动）

**交付物**:
- 改进的 `bridge/src/updates/hot-update-manager.js`
- 2 层 Watchdog
- 动态代码加载

---

#### Task 4.2: 版本快照管理（2 天）
**目标**: 保存版本历史，支持回滚

**交付物**:
- `bridge/src/updates/version-manager.js`
- 版本快照存储
- 快速回滚

---

#### Task 4.3: 基础资源优化（2 天）
**目标**: 传输层压缩和基础缓存

**简化方案**:
```javascript
// 只做传输层压缩（不做语义压缩）
- gzip 或 brotli
- 简单的内存缓存
- 日志清理
```

**修改的规范**:
- ❌ 删除语义压缩（AI 成本高）
- ❌ 删除分层缓存（过于复杂）
- ✅ 保留：传输压缩 + 基础缓存 + 清理

**交付物**:
- `bridge/src/optimization/compression.js`
- `bridge/src/optimization/cache.js`
- `bridge/src/optimization/cleanup.js`

---

#### Task 4.4: Skill 市场简化版（3 天）
**目标**: 基础的技能共享

**简化的生命周期**（7 → 4 阶段）:
1. **Create** - 创建技能
2. **Validate** - 本地验证
3. **Publish** - 发布到网络
4. **Use** - 其他节点使用

**交付物**:
- 改进的 `bridge/src/skills/skill-manager.js`
- P2P 技能分享（基于 Task 3.1）
- 简单评分系统

---

## 📊 修订后的规范变化

### API 端点精简（51 → 31）

| 规范 | 原计划 | 精简后 | 减少 |
|------|--------|--------|------|
| P0-02 多代理 | 13 | 8 | -5 |
| P0-03 P2P | 13 | 8 | -5 |
| P0-01 热更新 | 9 | 5 | -4 |
| P0-04 版本市场 | 11 | 7 | -4 |
| P0-05 资源优化 | 5 | 3 | -2 |
| **总计** | **51** | **31** | **-20** |

### 功能简化

| 原规范 | 修改为 | 理由 |
|--------|--------|------|
| 自定义 DHT | hyperswarm | 成熟稳定，减少工作量 |
| 自定义加密 | TLS | 安全可靠，标准协议 |
| 4 层 Watchdog | 2 层 | 足够检测故障 |
| 7 阶段生命周期 | 4 阶段 | 更实用 |
| 语义压缩 | 传输压缩 | 性价比高 |
| 分层缓存 | 单层缓存 | 简单有效 |

---

## ⏱️ 时间估计

| 阶段 | 任务 | 工作量 | 周数 |
|------|------|--------|------|
| **阶段 1** | 基础设施 | 80h | 2-3 周 |
| **阶段 2** | P0-02 补完 | 56h | 1-2 周 |
| **阶段 3** | P2P 核心 | 72h | 2-3 周 |
| **阶段 4** | 热更新/版本/优化 | 80h | 2-3 周 |
| **总计** | | **288h** | **8-10 周** |

**对比原计划**:
- 原计划：345-425 小时，16 周
- 混合方案：**288 小时，8-10 周**
- **节省**：~35% 工作量，40% 时间

---

## ✅ 成功标准

### 阶段 1 完成标准
- [ ] REST API 框架运行（Express 服务器）
- [ ] 31 个端点有响应（可以是 mock）
- [ ] hyperswarm P2P 网络能连接 2+ 节点
- [ ] 节点间能发送/接收简单消息

### 阶段 2 完成标准
- [ ] 5 种代理角色能创建
- [ ] 反馈聚合包含 4 步流程
- [ ] 8 个代理 API 端点完全可用
- [ ] 集成测试通过

### 阶段 3 完成标准
- [ ] 6 种 P2P 消息类型能发送/接收
- [ ] 优先级队列正确排序
- [ ] 离线消息能缓存和重发
- [ ] 8 个 P2P API 端点完全可用

### 阶段 4 完成标准
- [ ] 热更新不重启服务
- [ ] 2 层 Watchdog 能检测故障并回滚
- [ ] 版本快照能保存和恢复
- [ ] 技能能在节点间共享
- [ ] 基础压缩和缓存工作

---

## 📝 需要更新的文档

完成实施后，需要更新以下规范文档：

1. **P0-01-HOT-UPDATE-SYSTEM-SPEC.md**
   - 4 层 → 2 层 Watchdog
   - 删除 P2P 发现（改为手动）
   - 更新 API 端点（9 → 5）

2. **P0-02-MULTI-AGENT-COLLABORATION-SPEC.md**
   - 更新 API 端点（13 → 8）
   - 添加角色实现细节

3. **P0-03-P2P-COMMUNICATION-PROTOCOL-SPEC.md**
   - 使用 hyperswarm 替代自定义 DHT
   - 使用 TLS 替代自定义加密
   - 更新 API 端点（13 → 8）
   - 删除消息签名要求（阶段 1）

4. **P0-04-VERSION-MANAGEMENT-SKILL-MARKET-SPEC.md**
   - 7 阶段 → 4 阶段生命周期
   - 更新 API 端点（11 → 7）
   - 简化评分系统

5. **P0-05-LOCAL-RESOURCE-OPTIMIZATION-SPEC.md**
   - 删除语义压缩
   - 删除分层缓存
   - 更新 API 端点（5 → 3）

6. **IMPLEMENTATION-ROADMAP.md**
   - 更新时间表（16 周 → 8-10 周）
   - 更新工作量（345-425h → 288h）

---

## 🎯 下一步行动

1. **审核这个计划** - 确认方案合理性
2. **更新 P0 规范** - 按照修改方案调整文档
3. **开始阶段 1** - 搭建 REST API 和 P2P 基础
4. **增量交付** - 每个阶段独立可测试

---

**这个计划平衡了理想和现实，既保留了代码优势，又补完了关键功能，还大幅降低了工作量。** 🚀