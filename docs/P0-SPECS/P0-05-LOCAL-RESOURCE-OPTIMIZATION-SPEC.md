# 💾 本地资源优化 - 实现规范

> **优先级**: 🔴 P0 | **复杂度**: ⭐⭐⭐⭐ 高 | **估算工作量**: 35-42 小时 | **最后更新**: 2026-04-29

### 修订说明
> 本文档已根据 CODE-SPEC-ALIGNMENT-PLAN.md 中定义的混合方案（Hybrid Approach）进行修订。主要变更：
> - API 端点从 5 个精简为 3 个（移除 history、recommendations 端点）
> - 移除语义压缩（AI 成本高）- 仅保留传输层压缩（gzip/brotli）
> - 移除分层缓存（过于复杂）- 改为单层缓存
> - 简化网络感知策略：仅区分 WiFi vs Mobile
> - 工作量估算：45-55h → 35-42h

## 1. 系统概述

### 核心理念

```
OpenChat Bridge 可能运行在：
├─ 桌面/笔记本（资源充足）
└─ 移动设备（资源受限）
    ├─ 网络受限（流量贵或不稳定）
    ├─ 存储受限（设备可能只有几 GB）
    └─ 计算受限（电池有限）

资源优化优先级：
🔴 第一优先：网络流量（最昂贵和受限）
🟠 第二优先：存储空间（可能紧张）
🟡 第三优先：计算资源（通常可以接受）

核心原则：
✅ 任何跨网络的数据都是宝贵的
✅ 压缩优于重传
✅ 缓存优于重新获取
✅ 离线优于实时
✅ 批量优于零散
```

### 典型场景

```
场景 1: 移动 Bridge 在移动网络上运行
├─ 带宽：2-5 Mbps（不稳定）
├─ 延迟：100-500ms
├─ 流量限制：每月 10GB
└─ 目标：最小化网络使用，在离线时也能工作

场景 2: 家庭 WiFi 上的 Bridge
├─ 带宽：50-100 Mbps（稳定）
├─ 延迟：< 50ms
├─ 流量：基本无限制
└─ 目标：平衡流量和存储，优先性能

场景 3: 数据中心 Bridge
├─ 带宽：1+ Gbps（充足）
├─ 延迟：< 10ms
├─ 流量：无限制
├─ 存储：可能很大
└─ 目标：优先性能，流量和存储不是瓶颈
```

---

## 2. 网络流量优化

### 2.1 流量分类和优先级

```javascript
const traffic_classification = {
  // CRITICAL：必须发送，无法延迟
  critical: {
    priority: 1,
    max_delay_ms: 1000,
    examples: [
      "安全告警",
      "故障通知",
      "立即修复的漏洞"
    ],
    compression: "必须使用",
    batching: "不允许（需要立即发送）"
  },

  // HIGH：重要但可以稍作延迟
  high: {
    priority: 2,
    max_delay_ms: 60000,  // 1 分钟
    examples: [
      "紧急协作请求",
      "关键 Skill 发布"
    ],
    compression: "必须使用",
    batching: "允许，但要小心"
  },

  // NORMAL：常规通信
  normal: {
    priority: 3,
    max_delay_ms: 300000,  // 5 分钟
    examples: [
      "协作请求",
      "性能报告",
      "Skill 评分"
    ],
    compression: "建议使用",
    batching: "允许"
  },

  // LOW：可以大幅延迟或在流量充足时发送
  low: {
    priority: 4,
    max_delay_ms: 86400000,  // 1 天
    examples: [
      "定期统计",
      "优化建议",
      "非关键日志"
    ],
    compression: "可选",
    batching: "鼓励"
  }
};
```

### 2.2 压缩策略

```javascript
const compression_strategy = {
  // 1. 应用层压缩（最有效）
  application_layer: {
    description: "在发送前压缩应用数据",

    techniques: {
      semantic_compression: {
        example: "发送代码差异而不是整个文件",
        savings: "70-90%",
        overhead: "低"
      },

      json_optimization: {
        example: "移除空格、缩短键名",
        savings: "10-20%",
        overhead: "极低"
      },

      delta_encoding: {
        example: "只发送自上次以来的变化",
        savings: "80-95%（对重复数据）",
        overhead: "中等"
      },

      lossy_compression: {
        example: "性能数据聚合而不是逐个发送",
        savings: "50-80%",
        overhead: "低（需要定义损失策略）"
      }
    },

    recommendation: "优先使用语义压缩和 Delta 编码"
  },

  // 2. 传输层压缩
  transport_layer: {
    algorithms: {
      gzip: {
        ratio: "70-90%",
        cpu_overhead: "低",
        recommend_for: "通用数据"
      },
      brotli: {
        ratio: "75-95%",
        cpu_overhead: "中等",
        recommend_for: "静态内容、Skill"
      },
      zstd: {
        ratio: "70-85%",
        cpu_overhead: "极低",
        recommend_for: "实时通信（速度优先）"
      }
    },

    decision_tree: {
      if_cpu_abundant: "使用 brotli 获得最佳比例",
      if_cpu_limited: "使用 gzip 或 zstd",
      if_bandwidth_critical: "组合使用应用层 + 传输层"
    }
  },

  // 3. 自适应压缩
  adaptive_compression: {
    monitor: [
      "设备 CPU 使用率",
      "网络延迟",
      "网络带宽"
    ],

    algorithm_selection: {
      if_cpu_high_and_bandwidth_low: "使用更激进的压缩",
      if_cpu_low_and_bandwidth_high: "使用快速压缩",
      if_network_unstable: "优先于延迟的压缩"
    }
  }
};
```

### 2.3 批处理和合并

```javascript
const batching_strategy = {
  // 1. 时间批处理
  time_based_batching: {
    description: "等待一段时间，收集多个消息后一起发送",

    example: {
      scenario: "性能报告，通常每分钟生成一个",
      policy: "等待 5 分钟，将 5 个报告合并为 1 条消息",
      savings: "减少 80% 的消息数量和协议开销",
      delay: "5 分钟"
    },

    parameters: {
      CRITICAL: { batch_wait_ms: 0, disabled: true },
      HIGH: { batch_wait_ms: 5000 },
      NORMAL: { batch_wait_ms: 60000 },
      LOW: { batch_wait_ms: 300000 }
    }
  },

  // 2. 大小批处理
  size_based_batching: {
    description: "达到一定大小后立即发送",

    example: {
      scenario: "发送日志",
      policy: "累积 1MB 或 5 分钟后发送",
      benefit: "防止单个消息过大"
    }
  },

  // 3. 内容合并
  content_merging: {
    example1: {
      input: [
        { metric: "cpu", value: 45 },
        { metric: "memory", value: 512 },
        { metric: "network", value: 2.5 }
      ],
      output: {
        metrics: { cpu: 45, memory: 512, network: 2.5 },
        timestamp: "2026-04-23T11:00:00Z"
      },
      savings: "减少 50% 的数据量"
    },

    example2: {
      input: [
        "用户发现问题 A",
        "用户发现问题 B",
        "用户发现问题 C"
      ],
      output: "发送一条汇总报告，列出 3 个问题",
      savings: "减少 66% 的消息数量"
    }
  }
};
```

### 2.4 缓存和重用

```javascript
const caching_strategy = {
  // 1. 内容寻址缓存（Content Addressed）
  content_addressed_cache: {
    principle: "基于内容哈希缓存，相同内容只传输一次",

    example: {
      scenario: "Skill 市场中两个不同的 Bridge 都发布了相同的算法",
      solution: "只存储一份，两个发布者都指向同一个内容哈希",
      savings: "防止内容重复"
    },

    implementation: {
      hash: "SHA-256(content)",
      first_request: "发送完整内容",
      subsequent_requests: "只发送哈希，如果本地已有则使用缓存"
    }
  },

  // 2. 分层缓存
  hierarchical_cache: {
    level1_local: {
      location: "本地 Bridge",
      lifetime: "永久",
      size: "受可用存储限制",
      examples: ["本地开发的 Skill", "自己发布的版本"]
    },

    level2_peer_cache: {
      location: "最近通信的 5-10 个 Peer",
      lifetime: "24 小时",
      size: "每个 Peer 最多 100MB",
      examples: ["最近下载的 Skill", "最近查询的数据"]
    },

    level3_network_cache: {
      location: "可信的高性能节点",
      lifetime: "取决于节点策略（可能 7 天）",
      size: "取决于节点（可能 1-10 GB）",
      examples: ["热门 Skill", "常用数据"]
    }
  },

  // 3. 缓存管理
  cache_management: {
    eviction_policy: "LRU（最近最少使用）",
    validation: "内容哈希验证，确保完整性",
    refresh: {
      description: "当发现新版本或更新时",
      action: "标记旧版本为过期，下载新版本"
    }
  }
};
```

---

## 3. 存储空间优化

### 3.1 存储分类

```javascript
const storage_classification = {
  // 必需：系统运行必须保留
  required: {
    examples: [
      "当前运行的代码和配置",
      "数据库和关键数据",
      "私钥和证书"
    ],
    size_estimate: "100-500 MB",
    management: "永不删除"
  },

  // 重要：丢失会产生后果但可以恢复
  important: {
    examples: [
      "最近 3 个版本的备份",
      "性能基准数据",
      "决策历史和日志"
    ],
    size_estimate: "500 MB - 2 GB",
    management: "保留最近 30 天"
  },

  // 可选：提升性能但不是必需
  optional: {
    examples: [
      "下载的 Skill 缓存",
      "网络缓存的消息",
      "临时工作文件"
    ],
    size_estimate: "500 MB - 5 GB",
    management: "存储充足则保留，否则 LRU 删除"
  },

  // 临时：工作中产生的临时数据
  temporary: {
    examples: [
      "构建中间文件",
      "测试临时数据",
      "会话状态"
    ],
    size_estimate: "< 100 MB",
    management: "工作完成后删除"
  }
};
```

### 3.2 存储优化技术

```javascript
const storage_optimization = {
  // 1. 去重
  deduplication: {
    method: "基于内容哈希识别相同文件",

    example: {
      scenario: "多个版本共享相同的依赖库",
      optimization: "只存储一份，通过硬链接或符号链接引用",
      savings: "60-80%（对于依赖库）"
    },

    implementation: {
      store_index: { /* content_hash -> file_path */ },
      gc_orphaned: "定期清理无引用的文件"
    }
  },

  // 2. 压缩存储
  compressed_storage: {
    technique: "使用 ZFS 或 Btrfs 等支持压缩的文件系统",

    compression_ratios: {
      code: "40-60%（代码压缩比高）",
      logs: "90-95%（重复内容多）",
      database: "30-50%（取决于数据类型）"
    },

    trade_offs: {
      pros: "显著减少存储占用",
      cons: "读写时需要 CPU 进行压缩/解压"
    }
  },

  // 3. 分层存储
  tiered_storage: {
    hot_tier: {
      storage: "SSD 或内存",
      contents: "当前版本、频繁访问的数据",
      size: "< 1 GB"
    },
    cold_tier: {
      storage: "HDD 或闪存",
      contents: "备份版本、历史日志",
      size: "< 10 GB"
    },
    archive_tier: {
      storage: "外部存储或 P2P 备份",
      contents: "很少访问的数据、长期备份",
      size: "可能很大"
    }
  },

  // 4. 智能清理
  smart_cleanup: {
    policies: {
      unused_skills: "3 个月未使用的 Skill 删除",
      old_versions: "保留最近 3 个版本和最稳定的版本",
      logs: "保留最近 30 天或 1 GB，先到为准",
      cache: "当存储 < 20% 时清理"
    },

    before_cleanup: [
      "创建备份",
      "验证引用完整性",
      "记录被删除的内容"
    ]
  }
};
```

---

## 4. 数据同步优化

### 4.1 同步策略

```javascript
const sync_strategy = {
  // 1. 选择性同步
  selective_sync: {
    description: "只同步必要的数据",

    example: {
      scenario: "Bridge 有有限的存储",
      options: [
        "只同步 Skill 市场的元数据（列表和评分）",
        "只下载 5 星评分的 Skill",
        "只同步与当前工作相关的数据"
      ]
    }
  },

  // 2. 增量同步
  incremental_sync: {
    description: "只同步上次以来的变化",

    example: {
      before: "每天下载 100 MB 的完整 Skill 市场",
      after: "每天下载 10 MB 的更新增量",
      savings: "减少 90% 的流量"
    },

    implementation: {
      track_changes: "每个数据对象都有版本号或时间戳",
      delta_delivery: "只发送自上次同步以来的变化"
    }
  },

  // 3. 计划同步
  scheduled_sync: {
    description: "在网络和电力充足时进行大规模同步",

    example: {
      scenario: "移动设备在移动网络上",
      policy: "只在连接到 WiFi 且设备充电时进行大型下载",
      benefit: "避免在移动网络上浪费流量"
    }
  },

  // 4. 按需同步
  on_demand_sync: {
    description: "用户明确请求时同步",

    example: {
      manual: "用户可以手动触发某个 Skill 的完整同步",
      automatic_trigger: "当需要使用某个 Skill 但本地没有时"
    }
  }
};
```

### 4.2 网络状态感知

```javascript
const network_awareness = {
  // 1. 监控网络状态
  monitoring: {
    metrics: [
      "网络类型（WiFi、4G、5G、有线）",
      "信号强度",
      "带宽评估",
      "延迟",
      "丢包率",
      "是否按流量计费"
    ]
  },

  // 2. 根据网络状态调整策略
  adaptive_policy: {
    on_wifi_unlimited: {
      compression: "宽松（优先速度）",
      batching: "无（立即发送）",
      cache_policy: "激进（缓存更多数据）"
    },

    on_mobile_metered: {
      compression: "激进（最大化压缩）",
      batching: "激进（尽可能合并）",
      cache_policy: "保守（最小化数据）",
      large_downloads: "禁用"
    },

    on_mobile_unmetered: {
      compression: "中等",
      batching: "中等",
      cache_policy: "中等"
    },

    on_weak_signal: {
      retry_strategy: "指数退避，最多 5 次",
      chunk_size: "减小，更容易恢复",
      timeout: "增加"
    }
  }
};
```

---

## 5. 资源监控和告警

### 5.1 监控指标

```javascript
const monitoring_metrics = {
  network: {
    bandwidth_used_mbps: { threshold: "自动适应" },
    bandwidth_available_mbps: { threshold: "自动检测" },
    latency_ms: { threshold_warning: 1000, threshold_critical: 5000 },
    loss_rate_percent: { threshold_warning: 1, threshold_critical: 5 }
  },

  storage: {
    used_percent: { threshold_warning: 80, threshold_critical: 95 },
    available_mb: { threshold_critical: 100 },
    growth_rate_mb_per_day: { threshold_warning: 100 }
  },

  data_transfer: {
    monthly_used_gb: { threshold: "根据计划设置" },
    daily_used_gb: { threshold: "根据计划设置" },
    compression_ratio: { target: "70-90%" }
  }
};
```

### 5.2 自动调整

```javascript
const auto_adjustment = {
  when_storage_low: {
    triggers: [
      "可用存储 < 500 MB",
      "存储使用率 > 90%"
    ],
    actions: [
      "停止下载可选数据",
      "触发智能清理",
      "删除最旧的缓存",
      "提示用户"
    ]
  },

  when_bandwidth_low: {
    triggers: [
      "带宽 < 500 Kbps",
      "延迟 > 2000ms",
      "丢包率 > 5%"
    ],
    actions: [
      "增加压缩",
      "启用激进批处理",
      "延迟非关键同步",
      "减小下载块大小"
    ]
  },

  when_on_metered_connection: {
    triggers: ["检测到按流量计费的网络"],
    actions: [
      "禁用大型下载",
      "启用最高压缩",
      "提示用户流量使用"
    ]
  }
};
```

---

## 6. API 接口

### 6.1 资源管理

```javascript
// 获取资源状态
GET /api/v1/resources/status
Response: {
  storage: {
    total_mb: 5000,
    used_mb: 3500,
    available_mb: 1500,
    by_category: {
      required_mb: 500,
      important_mb: 1200,
      optional_mb: 1500,
      temporary_mb: 300
    }
  },
  network: {
    bandwidth_available_mbps: 5.2,
    latency_ms: 45,
    loss_rate_percent: 0.1,
    network_type: "WiFi",
    metered: false
  }
}

// 获取资源使用历史
GET /api/v1/resources/history
Query: { period: "7days", metrics: ["storage", "bandwidth"] }
Response: [ { timestamp, storage_used_mb, bandwidth_used_kbps } ]

// 配置资源优化策略
PUT /api/v1/resources/policy
{
  storage_target_percent: 70,
  compression_level: "aggressive",
  batch_wait_seconds: 60,
  sync_schedule: "on_wifi_only"
}
Response: { status: "CONFIGURED" }

// 手动触发清理
POST /api/v1/resources/cleanup
{
  dry_run: false,
  target_freed_mb: 1000
}
Response: {
  freed_mb: 1050,
  deleted_items: 15,
  details: [ /* 删除详情 */ ]
}

// 获取资源优化建议
GET /api/v1/resources/recommendations
Response: [
  { recommendation: "启用激进压缩", priority: "HIGH", potential_savings: "500 MB" },
  { recommendation: "删除 3 个月未使用的 Skill", priority: "MEDIUM", potential_savings: "200 MB" }
]
```

---

## 7. 关键指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **平均网络压缩率** | 70-90% | 数据压缩后占原始大小的比例 |
| **本地存储效率** | 80-90% | 实际使用空间占总分配空间的比例 |
| **缓存命中率** | 60-80% | 缓存命中的请求比例 |
| **去重率** | 40-60% | 消除重复内容后节省的存储 |
| **月流量节省** | 50-70% | 通过优化节省的流量 |

---

## 9. API 实现状态 (2026-04-24)

> **状态**: ✅ 已实现

### 已实现端点

| 端点 | 方法 | 状态 | 文件 |
|------|------|------|------|
| `/api/v1/resources/status` | GET | ✅ | `src/api/routes/resources.js` |
| `/api/v1/resources/policy` | PUT | ✅ | `src/api/routes/resources.js` |
| `/api/v1/resources/cleanup` | POST | ✅ | `src/api/routes/resources.js` |

### 核心模块

| 模块 | 状态 | 文件 |
|------|------|------|
| ResourceOptimizer | ✅ | `src/optimization/resource-optimizer.js` |
| CompressionEngine | ✅ | `src/optimization/compression-engine.js` |
| CacheManager | ✅ | `src/optimization/cache-manager.js` |

---

## 10. 实现检查清单

- [x] 流量分类和优先级系统
- [x] 压缩引擎（多种算法支持）
- [ ] 自适应压缩选择
- [x] 批处理引擎
- [x] 内容寻址缓存
- [ ] 分层缓存系统
- [x] 存储分层和管理
- [x] 智能清理和 GC
- [x] 网络状态监控
- [ ] 自适应策略调整
- [x] 资源监控和告警
- [x] API 接口实现
- [ ] 配置管理
- [ ] 监控和日志
- [x] 测试覆盖（≥ 90%）

---

**关键改变**：
✅ 从"成本管理"（API 调用成本）→ "资源优化"（网络流量 + 存储）
✅ 流量和存储优化作为 PRIMARY 优先级（特别是移动设备）
✅ 自适应策略根据网络状况动态调整
✅ 面向移动设备优化

**下一步**：更新 IMPLEMENTATION-ROADMAP.md 以反映新的 5 个 P0 规范
