# 🌐 跨 Bridge P2P 通信协议 - 实现规范

> **优先级**: 🔴 P0 | **复杂度**: ⭐⭐⭐⭐ 高 | **估算工作量**: 48-56 小时 | **最后更新**: 2026-04-29

### 修订说明
> 本文档已根据 CODE-SPEC-ALIGNMENT-PLAN.md 中定义的混合方案（Hybrid Approach）进行修订。主要变更：
> - API 端点从 13 个精简为 8 个（移除 batch、topology、advanced routing 端点）
> - 使用 hyperswarm 替代自定义 DHT 实现
> - 使用 TLS 加密替代自定义 AES-256-GCM（hyperswarm 内置）
> - 移除 ECDSA 消息签名要求（Phase 1）
> - 工作量估算：50-60h → 48-56h

## 1. 系统概述

### 核心理念

```
┌─────────────────┐           P2P 网络           ┌─────────────────┐
│  Bridge_A       │  ←─────────────────────→  │  Bridge_B       │
│                 │                           │                 │
│ 主 AI_A ────────┼─┐                      ┌─┼─ 主 AI_B       │
│ 次 AI群_A       │ │  异步消息队列          │ │ 次 AI群_B     │
│                 │ └───────────────────────┘ │                 │
└─────────────────┘                           └─────────────────┘

通信特点：
✅ 完全去中心化 - 无中央协调服务
✅ 异步优先 - 不要求实时回复
✅ 端到端加密 - 保护隐私和安全
✅ 智能路由 - 避免不必要的广播
✅ 优先级机制 - 关键消息优先处理
✅ 离线可工作 - 消息队列支持离线存储
```

### 通信场景

```
场景 1: AI 知识共享
  Bridge_A 的主 AI 开发了一个高质量 Skill
  → 发布到 Skill 市场
  → 其他 Bridge 的 AI 发现并使用
  → 反馈意见回传

场景 2: AI 协作解决复杂问题
  Bridge_A 的主 AI 遇到困难问题
  → 请求 Bridge_B 的相关 AI 协助
  → Bridge_B 的 AI 分析问题
  → 返回建议或方案
  → Bridge_A 的主 AI 整合反馈

场景 3: 学习和经验共享
  Bridge_A 发现了一个 Bug 的解决方案
  → 分享给整个网络
  → 其他 Bridge 学习并记录
  → 改进各自的知识库

场景 4: 性能基准共享
  所有 Bridge 定期共享性能数据
  → 形成全网性能基准
  → 每个 Bridge 可以比较自己的性能
  → 发现优化机会
```

---

## 2. 通信架构设计

### 2.1 分层通信模型

```javascript
┌──────────────────────────────────────────────┐
│         应用层（AI 通信）                     │
├──────────────────────────────────────────────┤
│ • Skill 发布/订阅
│ • AI 协作请求
│ • 知识共享
│ • 问题求助
│                                              │
├──────────────────────────────────────────────┤
│      协议层（消息封装和路由）                 │
├──────────────────────────────────────────────┤
│ • 消息格式标准化
│ • 路由和发现
│ • 优先级管理
│ • 确认和重试
│                                              │
├──────────────────────────────────────────────┤
│     传输层（底层网络）                        │
├──────────────────────────────────────────────┤
│ • TCP/UDP 连接
│ • 加密通道（TLS）
│ • 压缩
│ • 故障处理
│                                              │
└──────────────────────────────────────────────┘
```

### 2.2 消息类型

```javascript
const message_types = {
  // 1. Skill 市场消息
  skill_publish: {
    description: "发布一个新 Skill",
    example: {
      type: "SKILL_PUBLISH",
      skill: {
        id: "skill_uuid",
        name: "高效排序算法",
        version: "1.0.0",
        author_bridge: "bridge_uuid",
        capabilities: ["排序", "性能优化"],
        code: "...",
        tests: "...",
        documentation: "..."
      }
    }
  },

  skill_update: {
    description: "更新已发布的 Skill",
    example: {
      type: "SKILL_UPDATE",
      skill_id: "skill_uuid",
      new_version: "1.1.0",
      changes: "修复边界情况"
    }
  },

  skill_request: {
    description: "请求一个特定的 Skill",
    example: {
      type: "SKILL_REQUEST",
      skill_id: "skill_uuid",
      requesting_bridge: "bridge_uuid",
      reason: "需要快速排序实现"
    }
  },

  // 2. AI 协作消息
  collaboration_request: {
    description: "请求其他 Bridge 的 AI 协助",
    example: {
      type: "COLLABORATION_REQUEST",
      from_bridge: "bridge_a",
      from_ai: "primary_ai_a",
      to_bridge: "bridge_b",
      to_ai_type: "security_auditor",
      task: "审计这段代码",
      context: { /* 任务上下文 */ },
      urgency: "HIGH",
      deadline: "2026-04-23T12:00:00Z"
    }
  },

  collaboration_response: {
    description: "响应协作请求",
    example: {
      type: "COLLABORATION_RESPONSE",
      collaboration_id: "uuid",
      from_bridge: "bridge_b",
      from_ai: "security_ai_b",
      status: "ACCEPTED | REJECTED",
      reason: "如果拒绝则说明原因",
      findings: "...",
      recommendations: "..."
    }
  },

  // 3. 知识共享消息
  insight_share: {
    description: "分享学习到的见解或 Bug 修复",
    example: {
      type: "INSIGHT_SHARE",
      from_bridge: "bridge_a",
      insight: {
        title: "异步循环中的竞态条件",
        description: "发现了在 Promise.all 中的隐藏竞态条件",
        solution: "使用互斥锁保护共享状态",
        code_example: "..."
      },
      severity: "HIGH"
    }
  },

  // 4. 性能数据共享
  performance_report: {
    description: "定期分享性能指标",
    example: {
      type: "PERFORMANCE_REPORT",
      from_bridge: "bridge_a",
      timestamp: "2026-04-23T11:00:00Z",
      metrics: {
        avg_response_time_ms: 245,
        error_rate_percent: 0.1,
        uptime_percent: 99.95,
        ai_count: 1,
        active_skills_count: 15
      }
    }
  },

  // 5. 诊断和求助消息
  diagnostic_request: {
    description: "请求诊断或技术支持",
    example: {
      type: "DIAGNOSTIC_REQUEST",
      from_bridge: "bridge_a",
      issue: "性能突然下降 40%",
      recent_changes: [ /* 最近的改动 */ ],
      logs: "...",
      request_from: "all | security_experts | performance_experts"
    }
  }
};
```

### 2.3 消息结构

```javascript
{
  // 消息头
  header: {
    message_id: "uuid",
    timestamp: "2026-04-23T11:00:00Z",
    version: "1.0",

    // 来源和目标
    from: {
      bridge_id: "bridge_uuid",
      ai_id: "ai_uuid",
      ai_type: "primary | secondary"
    },
    to: {
      bridge_id: "bridge_uuid (can be broadcast)",
      ai_id: "ai_uuid (optional)",
      ai_type: "security_auditor (optional)"
    },

    // 消息类型和路由
    type: "SKILL_PUBLISH | COLLABORATION_REQUEST | ...",
    priority: "CRITICAL | HIGH | NORMAL | LOW",
    ttl_seconds: 86400,  // 消息有效期

    // 安全
    signature: "digital_signature",
    encryption: "AES-256-GCM",
    encryption_key_id: "key_uuid"
  },

  // 消息体（取决于类型）
  body: {
    /* 根据消息类型变化 */
  },

  // 交付和确认
  metadata: {
    delivery_attempts: 3,
    last_delivery_attempt: "2026-04-23T11:05:00Z",
    delivery_status: "PENDING | DELIVERED | FAILED",
    acknowledgement_required: true,
    response_timeout_seconds: 300
  }
}
```

---

## 3. 通信协议设计

### 3.1 消息发送流程

```javascript
┌──────────────────────────────────────────────────┐
│           消息发送流程                           │
├──────────────────────────────────────────────────┤
│                                                  │
│ 1️⃣ 构造消息                                      │
│    ├─ 确定目标 Bridge/AI                        │
│    ├─ 准备消息体                               │
│    └─ 生成 message_id                           │
│    ↓                                             │
│ 2️⃣ 签名和加密                                    │
│    ├─ 对消息进行数字签名                         │
│    ├─ 使用目标的公钥加密                         │
│    └─ 验证加密成功                               │
│    ↓                                             │
│ 3️⃣ 路由决策                                      │
│    ├─ 目标是否在本 Bridge？ → 本地投递           │
│    ├─ 目标是否是已知节点？ → 直接连接             │
│    ├─ 目标是未知节点？ → DHT 查询                │
│    └─ 是否是广播？ → 洪泛或受控广播             │
│    ↓                                             │
│ 4️⃣ 连接建立                                      │
│    ├─ 如果无连接，建立 P2P 连接                │
│    ├─ 验证对方身份（证书）                       │
│    └─ 协商加密参数                               │
│    ↓                                             │
│ 5️⃣ 发送消息                                      │
│    ├─ 将消息放入发送队列                         │
│    ├─ 记录发送时间和 attempt 次数                │
│    └─ 等待确认或超时                             │
│    ↓                                             │
│ 6️⃣ 确认和重试                                    │
│    ├─ 收到 ACK？ → 标记为 DELIVERED             │
│    ├─ 超时？ → 重试（最多 3 次）                │
│    └─ 所有重试都失败？ → 离线队列存储             │
│    ↓                                             │
│ 7️⃣ 离线处理（如果目标离线）                     │
│    ├─ 将消息保存到本地队列                       │
│    ├─ 定期重试连接                               │
│    └─ 目标重新上线后投递                         │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 3.2 优先级和队列管理

```javascript
const queue_management = {
  // 优先级队列
  priority_queues: {
    CRITICAL: {
      max_latency_ms: 1000,
      max_retries: 5,
      examples: ["安全告警", "故障通知"]
    },
    HIGH: {
      max_latency_ms: 10000,
      max_retries: 3,
      examples: ["重要问题求助", "关键 Skill 发布"]
    },
    NORMAL: {
      max_latency_ms: 300000,  // 5 分钟
      max_retries: 2,
      examples: ["协作请求", "性能报告"]
    },
    LOW: {
      max_latency_ms: 86400000,  // 1 天
      max_retries: 1,
      examples: ["定期统计", "优化建议"]
    }
  },

  // 流量控制
  rate_limiting: {
    per_bridge: {
      max_messages_per_second: 100,
      max_bandwidth_mbps: 10
    },
    per_message_type: {
      SKILL_PUBLISH: "最多每分钟 10 条",
      COLLABORATION_REQUEST: "无限制",
      PERFORMANCE_REPORT: "最多每小时 1 条"
    },
    backpressure: {
      when_queue_full: "拒绝新消息，返回 429",
      recovery: "当队列处理完毕后继续接受"
    }
  },

  // 批处理优化
  batching: {
    enabled: true,
    max_batch_size: 100,
    max_wait_time_ms: 5000,
    benefit: "减少网络往返，提高效率"
  }
};
```

### 3.3 智能路由

```javascript
const routing_strategy = {
  // 1. 直接路由（已知目标）
  direct_routing: {
    condition: "目标 Bridge 已知且在线",
    action: "直接建立 P2P 连接",
    latency: "快速",
    reliability: "高"
  },

  // 2. DHT 路由（发现目标）
  dht_routing: {
    condition: "目标 Bridge 未知",
    action: "通过分布式哈希表查询位置",
    latency: "中等",
    reliability: "中等",
    example: "Kademlia DHT"
  },

  // 3. 继电路由（跳过不可达节点）
  relay_routing: {
    condition: "无法直接连接到目标",
    action: "通过中间节点转发",
    latency: "较慢",
    reliability: "取决于中间节点",
    optimization: "选择最少跳数的路径"
  },

  // 4. 广播路由（消息给多个接收者）
  broadcast_routing: {
    controlled_broadcast: {
      description: "只发给相关的节点",
      targets: "Skill 市场订阅者",
      method: "查询 DHT 获取订阅者列表"
    },
    flooding: {
      description: "发给所有已知节点",
      use_case: "紧急安全告警",
      throttle: "最多每小时 1 次"
    }
  },

  // 5. 聚合路由（减少重复消息）
  aggregation_routing: {
    example: "如果 10 个 Bridge 都发布了同一个 Skill，只转发一次",
    benefit: "减少网络流量",
    implementation: "基于内容的去重"
  }
};
```

---

## 4. 安全和隐私

### 4.1 身份认证

```javascript
const authentication = {
  // 证书系统
  certificate: {
    issued_to: "bridge_id",
    public_key: "...",
    validity_period: "1 年",
    issued_by: "Bridge 自签名（去中心化）",
    verification: "通过公钥验证签名"
  },

  // 交互流程
  handshake: {
    step1: "Bridge_A 连接到 Bridge_B",
    step2: "Bridge_B 发送证书和随机挑战",
    step3: "Bridge_A 使用 Bridge_B 的公钥验证证书",
    step4: "Bridge_A 用私钥签名随机挑战",
    step5: "Bridge_B 验证签名，完成认证"
  }
};
```

### 4.2 加密通信

```javascript
const encryption = {
  // 端到端加密
  e2e_encryption: {
    algorithm: "AES-256-GCM",
    key_exchange: "Elliptic Curve Diffie-Hellman (ECDH)",
    perfect_forward_secrecy: true
  },

  // 消息签名
  message_signing: {
    algorithm: "ECDSA with SHA-256",
    purpose: "防止消息篡改、验证发送者身份"
  },

  // 隐私保护
  privacy: {
    anonymity: "可选：使用 Tor 隐藏 IP",
    data_minimization: "只发送必要信息，隐藏不必要细节",
    retention: "消息可设置自动销毁时间"
  }
};
```

### 4.3 拒绝服务防护

```javascript
const dos_protection = {
  rate_limiting: {
    per_source: "最多 100 条消息/秒",
    per_message_type: "根据类型限制",
    enforcement: "超限后返回 429 Too Many Requests"
  },

  reputation_system: {
    good_actor: "可靠性高的 Bridge 获得更高配额",
    bad_actor: "多次违规的 Bridge 被限流甚至阻止",
    dynamic_adjustment: "根据历史行为动态调整"
  },

  connection_limits: {
    max_connections_per_peer: 5,
    max_pending_messages: 1000,
    memory_limit_per_peer: "100 MB"
  }
};
```

---

## 5. 数据模型

### 5.1 P2P 网络拓扑

```javascript
{
  network_state: {
    peer_id: "bridge_uuid",
    peer_address: "192.168.1.100:9090",
    status: "ONLINE | OFFLINE | SUSPECTED_OFFLINE",
    last_seen: "2026-04-23T11:05:00Z",

    // 连接信息
    connections: [
      {
        peer_id: "bridge_uuid_2",
        connection_type: "DIRECT | RELAY",
        latency_ms: 45,
        bandwidth_mbps: 8.5,
        uptime_percent: 99.95
      }
    ],

    // 本地消息队列
    outgoing_queue: [
      {
        message_id: "uuid",
        destination: "bridge_uuid_2",
        type: "SKILL_PUBLISH",
        priority: "HIGH",
        attempts: 1,
        next_retry: "2026-04-23T11:05:30Z"
      }
    ],

    // 网络统计
    stats: {
      messages_sent_total: 15000,
      messages_received_total: 12000,
      delivery_success_rate: 98.5,
      avg_latency_ms: 120
    }
  }
}
```

### 5.2 消息传递记录

```javascript
{
  message_delivery_record: {
    message_id: "uuid",
    type: "SKILL_PUBLISH",
    from_bridge: "bridge_a",
    to_bridge: "bridge_b",
    timestamp: "2026-04-23T11:00:00Z",

    delivery: {
      status: "DELIVERED | FAILED | PENDING",
      attempts: [
        {
          attempt_number: 1,
          timestamp: "2026-04-23T11:00:00Z",
          result: "SUCCESS",
          latency_ms: 125
        }
      ],
      final_status: "DELIVERED"
    },

    // 如果要求响应
    response: {
      received_at: "2026-04-23T11:00:30Z",
      status: "ACCEPTED",
      content: "..."
    }
  }
}
```

---

## 6. API 接口

### 6.1 消息发送

```javascript
// 发送单个消息
POST /api/v1/p2p/messages
{
  to: {
    bridge_id: "bridge_uuid",
    ai_id: "ai_uuid (optional)",
    ai_type: "security_auditor (optional)"
  },
  message_type: "SKILL_PUBLISH | COLLABORATION_REQUEST | ...",
  payload: { /* 根据类型变化 */ },
  priority: "CRITICAL | HIGH | NORMAL | LOW",
  require_response: true,
  response_timeout_seconds: 300
}
Response: {
  message_id: "uuid",
  status: "QUEUED",
  estimated_delivery_time: "2026-04-23T11:00:30Z"
}

// 发送批量消息
POST /api/v1/p2p/messages/batch
{
  messages: [ /* 多个消息 */ ],
  batch_priority: "HIGH"
}
Response: {
  batch_id: "uuid",
  message_count: 50,
  status: "BATCHING"
}
```

### 6.2 消息查询

```javascript
// 获取消息状态
GET /api/v1/p2p/messages/{message_id}
Response: {
  message_id: "uuid",
  status: "QUEUED | DELIVERED | FAILED",
  delivery_attempts: 2,
  next_retry: "2026-04-23T11:05:30Z"
}

// 获取收件箱
GET /api/v1/p2p/inbox
Query: { limit: 100, status: "unread" }
Response: [
  { message_id, from_bridge, type, timestamp, payload }
]

// 获取消息传递统计
GET /api/v1/p2p/statistics
Response: {
  total_sent: 15000,
  total_received: 12000,
  delivery_success_rate: 98.5,
  avg_latency_ms: 120,
  network_health: "HEALTHY"
}
```

### 6.3 网络管理

```javascript
// 获取网络拓扑
GET /api/v1/p2p/network/topology
Response: {
  peer_count: 42,
  connected_peers: 38,
  network_diameter: 5,
  peers: [ /* 所有已知节点 */ ]
}

// 配置网络参数
PUT /api/v1/p2p/network/config
{
  max_message_size_mb: 50,
  max_queue_size: 10000,
  rate_limit_per_second: 100,
  connection_timeout_seconds: 30
}
```

---

## 7. 关键指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **消息送达率** | ≥ 99% | 消息成功送达的比例 |
| **平均延迟** | < 500ms | 本地网络消息延迟 |
| **跨地域延迟** | < 2000ms | 跨地域消息延迟 |
| **网络可用性** | ≥ 99.5% | 网络连通性 |
| **消息去重率** | ≥ 95% | 成功去除重复消息 |
| **DDoS 防护率** | 99%+ | 成功阻止 DoS 攻击 |

---

## 9. API 实现状态 (2026-04-24)

> **状态**: ✅ 已实现 (模拟数据)

### 已实现端点

| 端点 | 方法 | 状态 | 文件 |
|------|------|------|------|
| `/api/v1/p2p/messages` | POST | ✅ | `src/api/routes/p2p.js` |
| `/api/v1/p2p/messages/:id` | GET | ✅ | `src/api/routes/p2p.js` |
| `/api/v1/p2p/inbox` | GET | ✅ | `src/api/routes/p2p.js` |
| `/api/v1/p2p/peers` | GET | ✅ | `src/api/routes/p2p.js` |
| `/api/v1/p2p/peers/:id/connect` | POST | ✅ | `src/api/routes/p2p.js` |
| `/api/v1/p2p/peers/:id` | DELETE | ✅ | `src/api/routes/p2p.js` |
| `/api/v1/p2p/stats` | GET | ✅ | `src/api/routes/p2p.js` |
| `/api/v1/p2p/config` | PUT | ✅ | `src/api/routes/p2p.js` |

### 核心模块

| 模块 | 状态 | 文件 |
|------|------|------|
| P2PNode | ✅ | `src/p2p/p2p-node.js` |
| MessageQueue | ✅ | `src/p2p/message-queue.js` |

> **注意**: 当前 API 使用模拟数据，尚未连接真实的 P2P 网络。

---

## 10. 实现检查清单

- [x] 消息格式标准化和序列化
- [ ] 数字签名和加密实现
- [ ] 连接管理和连接池
- [x] 优先级队列实现
- [ ] DHT 集成（发现目标 Bridge）
- [ ] 消息路由引擎
- [ ] 离线队列管理
- [ ] 故障检测和重试机制
- [ ] 网络拓扑维护
- [x] API 接口实现
- [ ] 监控和日志记录
- [x] 测试覆盖（≥ 90%）
- [ ] 性能测试（延迟、吞吐量）
- [ ] 安全审计（加密、认证、授权）

---

**下一步**：P0-04 本地版本管理和 Skill 市场规范
