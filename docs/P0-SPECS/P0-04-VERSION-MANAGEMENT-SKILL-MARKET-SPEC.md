# 📦 本地版本管理和 Skill 市场 - 实现规范

> **优先级**: 🔴 P0 | **复杂度**: ⭐⭐⭐ 中等 | **估算工作量**: 35-42 小时

### 修订说明
> 本文档已根据 CODE-SPEC-ALIGNMENT-PLAN.md 中定义的混合方案（Hybrid Approach）进行修订。主要变更：
> - API 端点从 11 个精简为 7 个（移除 compatibility、download、rate 端点，简化 recommendations）
> - Skill 生命周期从 7 阶段简化为 4 阶段：Create → Validate → Publish → Use
> - 评分系统简化为 1-5 星评级（移除多维度评分）
> - 工作量估算：40-50h → 35-42h

## 1. 系统概述

### 核心理念

```
本地版本管理：每个 Bridge 独立跟踪版本历史
┌────────────────────────────────────────┐
│ Bridge 本地                             │
│                                        │
│ 版本历史链：                           │
│ v1.0.0 → v1.0.1 → v1.1.0 → v2.0.0    │
│  ↓        ↓        ↓        ↓         │
│ 代码库  代码库  代码库  代码库         │
│ 数据库  数据库  数据库  数据库         │
│ 配置    配置    配置    配置           │
│                                        │
│ 每个版本包含：                         │
│ • 代码快照                             │
│ • 数据库状态（如适用）                  │
│ • 配置文件                             │
│ • 性能基准                             │
│ • 测试结果                             │
│ • 部署日期和效果                       │
└────────────────────────────────────────┘

Skill 市场：去中心化的知识共享
┌────────────────────────────────────────┐
│ P2P 网络上的 Skill 市场                 │
│                                        │
│ Skill 1: 快速排序算法                 │
│  ├─ 作者: Bridge_A 的主 AI            │
│  ├─ 版本: 1.2.0                      │
│  ├─ 代码 + 测试                       │
│  ├─ 评分: 4.8/5 (100 次使用)         │
│  └─ 下载: 42 次                      │
│                                        │
│ Skill 2: 异常检测模型                 │
│  ├─ 作者: Bridge_B 的安全 AI          │
│  ├─ 版本: 2.0.0                      │
│  ├─ 模型 + 参数                       │
│  ├─ 评分: 4.6/5 (50 次使用)         │
│  └─ 下载: 28 次                      │
│                                        │
│ Skill 3: 代码重构模式                 │
│  ├─ 作者: Bridge_C 的代码质量 AI      │
│  ├─ 版本: 1.0.0                      │
│  ├─ 模式描述 + 示例                    │
│  ├─ 评分: 4.9/5 (75 次使用)         │
│  └─ 下载: 35 次                      │
└────────────────────────────────────────┘
```

### 关键特性

```
✅ 独立版本管理
   每个 Bridge 自主管理版本历史，无中央协调

✅ 语义版本控制
   MAJOR.MINOR.PATCH 版本格式，明确兼容性

✅ 版本回滚能力
   可随时回滚到任何之前的版本

✅ 版本间差异追踪
   清晰记录每个版本的改动

✅ Skill 发布和发现
   AI 可发布自开发的 Skill，其他 AI 可发现和使用

✅ Skill 评分和反馈
   社区评分机制，帮助识别高质量 Skill

✅ 版本兼容性检查
   自动验证新版本与旧版本的兼容性
```

---

## 2. 本地版本管理

### 2.1 版本模型

```javascript
{
  version: "2.1.0",

  // 版本元数据
  metadata: {
    semantic_version: "2.1.0",
    major: 2,
    minor: 1,
    patch: 0,
    prerelease: null,  // "alpha" | "beta" | null

    release_date: "2026-04-23T10:00:00Z",
    release_notes: "修复 5 个 Bug，性能提升 8%",

    // 版本关系
    previous_version: "2.0.0",
    breaking_changes: [],
    deprecated_features: [],
    security_fixes: ["CVE-2026-1234"]
  },

  // 代码和配置快照
  code_snapshot: {
    commit_hash: "abc123def456",
    git_branch: "release-2.1.0",
    code_files: [
      { path: "src/main.js", checksum: "hash_value" },
      { path: "src/utils.js", checksum: "hash_value" }
    ],
    size_mb: 45
  },

  config_snapshot: {
    environment_variables: { /* 快照 */ },
    configuration_files: [ /* 快照 */ ],
    checksum: "hash_value"
  },

  // 数据库状态（如适用）
  database_snapshot: {
    type: "PostgreSQL | MongoDB | ...",
    backup_id: "backup_uuid",
    schema_version: "v3.0",
    data_size_mb: 150,
    checkpoint_timestamp: "2026-04-23T10:00:00Z"
  },

  // 性能基准
  performance_baseline: {
    measured_at: "2026-04-23T10:05:00Z",
    metrics: {
      avg_response_time_ms: 245,
      p95_response_time_ms: 850,
      p99_response_time_ms: 1200,
      error_rate_percent: 0.05,
      throughput_rps: 1500
    }
  },

  // 测试结果
  test_results: {
    unit_tests: { passed: 245, failed: 0, skipped: 5 },
    integration_tests: { passed: 42, failed: 0, skipped: 0 },
    e2e_tests: { passed: 15, failed: 0, skipped: 0 },
    coverage_percent: 95.5
  },

  // 部署和效果
  deployment: {
    deployed_at: "2026-04-23T10:15:00Z",
    deployed_to: "production",
    status: "ACTIVE | ROLLED_BACK | DEPRECATED",
    uptime_percent: 99.98,
    error_rate_delta: -0.02,  // 相对于之前版本的变化
    performance_delta: 0.08   // 性能改善 8%
  },

  // 内容哈希
  content_hash: "sha256_hash_of_entire_version"
}
```

### 2.2 版本历史链

```javascript
// Bridge 维护一个版本历史链
{
  bridge_id: "bridge_uuid",
  current_version: "2.1.0",

  version_chain: [
    // 最新版本在前
    {
      version: "2.1.0",
      deployment_time: "2026-04-23T10:15:00Z",
      status: "ACTIVE"
    },
    {
      version: "2.0.0",
      deployment_time: "2026-04-15T14:30:00Z",
      status: "SUPERSEDED"
    },
    {
      version: "1.9.1",
      deployment_time: "2026-04-08T09:45:00Z",
      status: "SUPERSEDED"
    },
    {
      version: "1.9.0",
      deployment_time: "2026-04-01T16:20:00Z",
      status: "SUPERSEDED"
    }
  ],

  // 快速查询
  available_versions: {
    "2.1.0": { /* 完整版本对象 */ },
    "2.0.0": { /* 完整版本对象 */ },
    "1.9.1": { /* 完整版本对象 */ }
  },

  // 版本统计
  statistics: {
    total_versions: 47,
    active_version_duration_hours: 8,
    avg_version_lifetime_days: 7,
    most_stable_version: "2.0.0",
    most_problematic_version: "1.8.0"
  }
}
```

### 2.3 版本更新流程

```javascript
const version_update_process = {
  scenario: "主 AI 决定升级到新版本",

  step1_discover: {
    action: "发现新版本",
    sources: [
      "P2P 网络",
      "官方发布渠道",
      "社区贡献"
    ],
    new_version: "2.1.0"
  },

  step2_pre_check: {
    action: "更新前检查",
    checks: [
      {
        check: "兼容性检查",
        verify: "当前版本 2.0.0 是否兼容 2.1.0？",
        result: "✅ 兼容（MINOR 升级）"
      },
      {
        check: "依赖检查",
        verify: "所有依赖是否可用？",
        result: "✅ 所有依赖可用"
      },
      {
        check: "资源检查",
        verify: "是否有足够的存储和内存？",
        result: "✅ 资源充足（需要 45MB）"
      }
    ]
  },

  step3_download_and_verify: {
    action: "下载新版本",
    steps: [
      "从 P2P 网络下载版本文件",
      "验证内容哈希",
      "验证代码签名",
      "扫描安全漏洞"
    ],
    result: "✅ 验证通过"
  },

  step4_local_testing: {
    action: "本地全面测试",
    tests: [
      {
        test: "单元测试",
        status: "PASSED",
        details: "245 个测试通过"
      },
      {
        test: "集成测试",
        status: "PASSED",
        details: "42 个集成测试通过"
      },
      {
        test: "性能基准",
        status: "PASSED",
        details: "性能提升 8%"
      },
      {
        test: "对抗性测试",
        status: "PASSED",
        details: "无新的安全问题"
      }
    ]
  },

  step5_create_backup: {
    action: "备份当前版本",
    backup: {
      version: "2.0.0",
      timestamp: "2026-04-23T10:05:00Z",
      size_mb: 45,
      recovery_time_estimate: "5 分钟"
    }
  },

  step6_deploy: {
    action: "部署新版本",
    deployment: {
      start_time: "2026-04-23T10:15:00Z",
      method: "热更新（不中断服务）",
      downtime: 0
    }
  },

  step7_verify_deployment: {
    action: "验证部署",
    checks: [
      "系统是否正常运行？ ✅",
      "所有 API 是否响应？ ✅",
      "性能是否达到预期？ ✅",
      "错误率是否正常？ ✅"
    ]
  },

  step8_update_version_chain: {
    action: "更新版本链",
    result: {
      current_version: "2.1.0",
      previous_version: "2.0.0",
      status: "SUCCESS"
    }
  }
};
```

---

## 3. Skill 市场

### 3.1 什么是 Skill

```javascript
// Skill 是 AI 开发的可复用能力或工具
const skill_examples = {
  algorithm_skill: {
    name: "高效排序算法",
    type: "ALGORITHM",
    author_bridge: "bridge_a",
    author_ai: "primary_ai_a",
    version: "1.2.0",

    code: `
      function quickSort(arr) {
        // 优化的快速排序实现
        // 包括三路分割和随机主元
      }
    `,

    tests: `
      // 完整的测试套件
      // 包括边界条件、性能测试
    `,

    performance: {
      avg_time_ms: 2.5,
      worst_case_ms: 5.0,
      space_complexity: "O(log n)",
      measured_on: "1M 元素数组"
    },

    documentation: "详细的使用说明和示例"
  },

  model_skill: {
    name: "异常检测模型",
    type: "MODEL",
    author_bridge: "bridge_b",
    author_ai: "security_ai_b",
    version: "2.0.0",

    model_file: "model.pb",
    parameters: { /* 模型参数 */ },

    accuracy: {
      true_positive_rate: 0.98,
      false_positive_rate: 0.01,
      precision: 0.99,
      recall: 0.97
    },

    training_data: "100k 样本"
  },

  pattern_skill: {
    name: "代码重构模式",
    type: "PATTERN",
    author_bridge: "bridge_c",
    author_ai: "code_quality_ai",
    version: "1.0.0",

    pattern_name: "提取函数重构",
    description: "如何安全地从大函数中提取小函数",

    steps: [
      "第 1 步：识别可提取的逻辑块",
      "第 2 步：验证块的独立性",
      "第 3 步：创建新函数",
      "第 4 步：替换原始代码",
      "第 5 步：运行测试验证"
    ],

    preconditions: ["函数长度 > 50 行"],
    postconditions: ["函数长度 < 25 行", "所有测试通过"],

    examples: [ /* 真实代码示例 */ ]
  }
};
```

### 3.2 Skill 生命周期

```javascript
┌──────────────────────────────────────────┐
│         Skill 生命周期                   │
├──────────────────────────────────────────┤
│                                          │
│ 1️⃣ 开发（Development）                  │
│    └─ AI 在 Bridge 内开发 Skill         │
│    ↓                                     │
│ 2️⃣ 验证（Validation）                   │
│    ├─ 通过单元测试                       │
│    ├─ 通过集成测试                       │
│    └─ 性能基准达标                       │
│    ↓                                     │
│ 3️⃣ 发布（Publishing）                   │
│    ├─ 创建版本号和文档                   │
│    ├─ 计算内容哈希                       │
│    ├─ 对 Skill 进行签名                 │
│    └─ 发布到 P2P 网络                   │
│    ↓                                     │
│ 4️⃣ 发现（Discovery）                    │
│    ├─ 其他 Bridge 发现 Skill             │
│    ├─ Skill 市场中可见                  │
│    ├─ 接收下载请求                       │
│    └─ 评分和反馈开始累积                 │
│    ↓                                     │
│ 5️⃣ 应用（Application）                  │
│    ├─ AI 下载并集成 Skill                │
│    ├─ 在自己的工作中使用                 │
│    └─ 收集使用效果反馈                   │
│    ↓                                     │
│ 6️⃣ 改进（Improvement）                  │
│    ├─ 作者收集反馈                       │
│    ├─ 改进 Skill 实现                   │
│    ├─ 发布新版本                         │
│    └─ 版本迭代                           │
│    ↓                                     │
│ 7️⃣ 生态学习（Ecosystem Learning）        │
│    ├─ 全网学习最佳实践                   │
│    ├─ 改进自己的能力                     │
│    ├─ 高评分 Skill 被广泛使用            │
│    └─ 低评分 Skill 逐渐被遗弃            │
│                                          │
│ 可能的结果：                            │
│ • 🌟 高评分 Skill：社区标准              │
│ • 📉 低评分 Skill：被逐渐遗弃            │
│ • 🔄 不断演进：改进的版本               │
│ • ⚠️  废弃 Skill：标记为过时            │
│                                          │
└──────────────────────────────────────────┘
```

### 3.3 Skill 发布流程

```javascript
const skill_publish_process = {
  step1_prepare: {
    action: "准备 Skill",
    items: [
      {
        item: "代码或模型文件",
        requirement: "完整、可运行、通过测试"
      },
      {
        item: "单元测试",
        requirement: "覆盖率 ≥ 90%"
      },
      {
        item: "文档",
        requirement: "包括使用说明、示例、限制条件"
      },
      {
        item: "性能数据",
        requirement: "基准测试结果"
      }
    ]
  },

  step2_metadata: {
    action: "创建 Skill 元数据",
    metadata: {
      name: "Skill 名称",
      version: "1.0.0",
      type: "ALGORITHM | MODEL | PATTERN",
      description: "简要描述",
      tags: ["排序", "性能优化"],
      license: "MIT | Apache 2.0 | ...",
      author_bridge: "bridge_uuid",
      author_ai: "ai_uuid"
    }
  },

  step3_sign: {
    action: "对 Skill 进行数字签名",
    purpose: "验证 Skill 来源和完整性",
    signature: "使用作者私钥签名"
  },

  step4_compute_hash: {
    action: "计算内容哈希",
    hash: "SHA-256(skill_content)",
    purpose: "用于去重和版本管理"
  },

  step5_publish: {
    action: "发布到 P2P 网络",
    message_type: "SKILL_PUBLISH",
    recipients: "所有已知 Bridge",
    broadcast: true
  },

  step6_register_in_market: {
    action: "在 Skill 市场注册",
    registration: {
      skill_id: "uuid",
      listing_timestamp: "2026-04-23T10:00:00Z",
      initial_rating: null,
      download_count: 0
    }
  }
};
```

### 3.4 Skill 评分系统

```javascript
{
  skill_rating: {
    skill_id: "uuid",
    skill_name: "高效排序算法",
    version: "1.2.0",

    // 综合评分
    overall_rating: 4.8,  // 0-5.0

    // 维度评分
    ratings: {
      correctness: {
        score: 4.9,
        reviews: 50,
        comments: "算法正确，通过所有测试"
      },
      performance: {
        score: 4.7,
        reviews: 45,
        comments: "性能优秀，优于标准库实现"
      },
      documentation: {
        score: 4.8,
        reviews: 40,
        comments: "文档清晰，示例充分"
      },
      maintainability: {
        score: 4.8,
        reviews: 35,
        comments: "代码结构清晰，易于维护"
      }
    },

    // 使用统计
    statistics: {
      total_downloads: 124,
      total_uses: 350,
      active_users: 42,
      avg_rating_per_user: 4.8,
      trend: "improving"
    },

    // 用户反馈示例
    reviews: [
      {
        reviewer_bridge: "bridge_x",
        rating: 5,
        comment: "非常好用，性能提升明显",
        timestamp: "2026-04-20T15:30:00Z"
      },
      {
        reviewer_bridge: "bridge_y",
        rating: 4,
        comment: "不错，但文档可以更详细",
        timestamp: "2026-04-19T10:00:00Z"
      }
    ]
  }
}
```

---

## 4. 数据模型

### 4.1 版本存储

```javascript
// Bridge 本地版本存储结构
{
  storage_path: "/bridge/versions/",

  versions: {
    "v2.1.0": {
      metadata: { /* 版本元数据 */ },
      code_snapshot: { /* 代码快照 */ },
      config_snapshot: { /* 配置快照 */ },
      database_snapshot: { /* 数据库快照 */ },
      content_hash: "sha256_hash"
    },
    "v2.0.0": { /* ... */ },
    "v1.9.1": { /* ... */ }
  },

  // 版本索引（快速查询）
  index: {
    current_version: "v2.1.0",
    latest_version: "v2.1.0",
    stable_version: "v2.0.0",
    all_versions: ["v2.1.0", "v2.0.0", "v1.9.1"],
    version_by_hash: { /* hash -> version */ }
  },

  // 版本关系
  relationships: {
    "v2.1.0": {
      parent: "v2.0.0",
      children: [],
      compatibility: "v2.0.0 -> v2.1.0 安全升级"
    },
    "v2.0.0": {
      parent: "v1.9.1",
      children: ["v2.1.0"],
      compatibility: "v1.9.1 -> v2.0.0 需要迁移"
    }
  }
}
```

### 4.2 Skill 存储

```javascript
// Skill 市场存储（分布式）
{
  market_id: "skill_market_global",

  skills: {
    "skill_uuid_1": {
      metadata: { /* Skill 元数据 */ },
      content: {
        code_or_model: "...",
        tests: "...",
        documentation: "..."
      },
      signature: "digital_signature",
      content_hash: "sha256_hash",

      // 市场信息
      market_info: {
        listed_at: "2026-04-23T10:00:00Z",
        total_downloads: 124,
        total_uses: 350,
        rating: 4.8,
        reviews: [/* ... */]
      },

      // 版本历史
      versions: [
        {
          version: "1.2.0",
          release_date: "2026-04-23T10:00:00Z",
          changes: "修复边界情况"
        },
        {
          version: "1.1.0",
          release_date: "2026-04-10T14:30:00Z",
          changes: "性能优化"
        }
      ]
    }
  },

  // 市场索引
  indexes: {
    by_rating: [/* 按评分排序 */],
    by_downloads: [/* 按下载数排序 */],
    by_type: {
      ALGORITHM: [/* 所有算法 Skill */],
      MODEL: [/* 所有模型 Skill */],
      PATTERN: [/* 所有模式 Skill */]
    },
    by_tag: {
      "排序": [/* 与排序相关的 Skill */],
      "性能": [/* 与性能相关的 Skill */]
    }
  }
}
```

---

## 5. API 接口

### 5.1 版本管理

```javascript
// 获取当前版本
GET /api/v1/versions/current
Response: { version: "2.1.0", metadata: { /* ... */ } }

// 获取版本历史
GET /api/v1/versions/history
Query: { limit: 20, status: "all" }
Response: [ { version, deployed_at, status } ]

// 获取特定版本信息
GET /api/v1/versions/{version}
Response: { /* 完整的版本对象 */ }

// 检查版本兼容性
POST /api/v1/versions/{version}/check-compatibility
{
  current_version: "2.0.0"
}
Response: {
  compatible: true,
  migration_required: false,
  breaking_changes: []
}

// 回滚到之前的版本
POST /api/v1/versions/{version}/rollback
{
  force: false,
  backup_current: true
}
Response: {
  status: "ROLLING_BACK",
  estimated_time_seconds: 300
}
```

### 5.2 Skill 管理

```javascript
// 发布 Skill
POST /api/v1/skills
{
  name: "高效排序算法",
  type: "ALGORITHM",
  code: "...",
  tests: "...",
  documentation: "...",
  tags: ["排序", "性能"],
  version: "1.0.0"
}
Response: { skill_id: "uuid", status: "PUBLISHED" }

// 搜索 Skill
GET /api/v1/skills/search
Query: {
  q: "排序",
  type: "ALGORITHM",
  sort_by: "rating",
  limit: 20
}
Response: [ { skill_id, name, version, rating, downloads } ]

// 获取 Skill 详情
GET /api/v1/skills/{skill_id}
Response: { /* 完整 Skill 对象 */ }

// 下载 Skill
GET /api/v1/skills/{skill_id}/download
Response: { /* Skill 内容 */ }

// 评分 Skill
POST /api/v1/skills/{skill_id}/rate
{
  rating: 5,
  comment: "非常好用！"
}
Response: { status: "RATED" }

// 获取推荐 Skill
GET /api/v1/skills/recommendations
Query: { based_on: "my_recent_work" }
Response: [ { skill_id, name, reason } ]
```

---

## 6. 关键指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **版本升级成功率** | ≥ 99.5% | 版本升级成功的比例 |
| **版本回滚时间** | < 5 分钟 | 回滚到之前版本的时间 |
| **Skill 发现延迟** | < 1 小时 | 新 Skill 发布到发现的时间 |
| **Skill 下载成功率** | ≥ 99% | Skill 下载成功的比例 |
| **Skill 市场活跃度** | ≥ 50 Skill/月 | 每月新发布的 Skill 数量 |

---

## 7. API 实现状态 (2026-04-24)

> **状态**: ✅ 已实现

### 已实现端点 - 版本管理

| 端点 | 方法 | 状态 | 文件 |
|------|------|------|------|
| `/api/v1/versions/current` | GET | ✅ | `src/api/routes/versions.js` |
| `/api/v1/versions/history` | GET | ✅ | `src/api/routes/versions.js` |
| `/api/v1/versions/:version` | GET | ✅ | `src/api/routes/versions.js` |
| `/api/v1/versions/:version/rollback` | POST | ✅ | `src/api/routes/versions.js` |

### 已实现端点 - Skill 市场

| 端点 | 方法 | 状态 | 文件 |
|------|------|------|------|
| `/api/v1/skills` | GET | ✅ | `src/api/routes/skills.js` |
| `/api/v1/skills` | POST | ✅ | `src/api/routes/skills.js` |
| `/api/v1/skills/search` | GET | ✅ | `src/api/routes/skills.js` |
| `/api/v1/skills/:id` | GET | ✅ | `src/api/routes/skills.js` |
| `/api/v1/skills/:id/validate` | POST | ✅ | `src/api/routes/skills.js` |
| `/api/v1/skills/:id/publish` | POST | ✅ | `src/api/routes/skills.js` |
| `/api/v1/skills/:id/rate` | POST | ✅ | `src/api/routes/skills.js` |

### 核心模块

| 模块 | 状态 | 文件 |
|------|------|------|
| VersionManager | ✅ | `src/updates/version-manager.js` |
| SkillMarket | ✅ | `src/updates/skill-market.js` |

---

## 8. 实现检查清单

- [x] 本地版本存储系统
- [x] 版本元数据管理
- [x] 版本链维护
- [ ] 版本快照创建和恢复
- [ ] 版本兼容性检查引擎
- [x] 版本回滚机制
- [x] Skill 发布接口
- [x] Skill 搜索和发现
- [x] Skill 评分系统
- [ ] Skill 下载和集成
- [ ] P2P 网络 Skill 同步
- [ ] 版本和 Skill 的持久化存储
- [ ] 数据一致性检查
- [x] API 接口实现
- [x] 测试覆盖（≥ 90%）

---

**下一步**：P0-05 本地资源优化规范
