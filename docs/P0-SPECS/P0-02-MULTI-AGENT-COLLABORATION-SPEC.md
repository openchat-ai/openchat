# 🤝 多代理协作框架 - 实现规范

> **优先级**: 🔴 P0 | **复杂度**: ⭐⭐⭐⭐ 高 | **估算工作量**: 40-48 小时 | **最后更新**: 2026-04-29

### 修订说明
> 本文档已根据 CODE-SPEC-ALIGNMENT-PLAN.md 中定义的混合方案（Hybrid Approach）进行修订。主要变更：
> - API 端点从 13 个精简为 8 个（移除 analytics 和 collaboration 端点至后续阶段）
> - 强调 5 个标准角色必须在 Phase 1 实现
> - 新增角色工厂模式（Role Factory Pattern）
> - 工作量估算：45-55h → 40-48h

## 1. 系统概述

### 核心理念

```
OpenChat Bridge 内部结构：

┌─────────────────────────────────┐
│      Bridge（一个物理节点）       │
├─────────────────────────────────┤
│                                 │
│  主 AI（自主开发者）             │
│  ├─ 自诊断和规划                │
│  ├─ 次 AI 创建和分配             │
│  ├─ 反馈聚合和决策               │
│  └─ 自我学习和进化               │
│                                 │
│  次 AI 群（专家代理）             │
│  ├─ 次 AI_1: 安全审计            │
│  ├─ 次 AI_2: 代码质量            │
│  ├─ 次 AI_3: 性能分析            │
│  ├─ 次 AI_4: 测试工程            │
│  └─ 次 AI_N: 其他专家            │
│                                 │
│  通信层                          │
│  ├─ 主→次：任务分配、指导        │
│  ├─ 次→主：反馈、建议、报告      │
│  ├─ 次↔次：协作、数据共享        │
│  └─ 总体：异步消息队列            │
│                                 │
└─────────────────────────────────┘
```

### 关键特性

```
✅ 动态代理创建与销毁
   主 AI 根据需要实时创建次 AI，任务完成后销毁

✅ 角色和职责管理
   每个次 AI 有明确的角色、能力描述、权限范围

✅ 反馈聚合机制
   多个次 AI 的反馈自动收集、整理、去重、综合

✅ 决策支持
   主 AI 基于次 AI 反馈做出更好的自主决策

✅ 协作管理
   次 AI 之间可以相互协作、共享数据、协调工作

✅ 学习和进化
   记录所有协作结果，用于改进下一次的 AI 分配和决策
```

---

## 2. 核心功能设计

### 2.1 次 AI 的生命周期

```javascript
┌──────────────────────────────────────────────┐
│           次 AI 生命周期                      │
├──────────────────────────────────────────────┤
│                                              │
│ 创建（Creation）                            │
│ └─ 主 AI 创建次 AI，指定角色、能力、任务   │
│    ↓                                         │
│ 初始化（Initialization）                     │
│ └─ 加载角色定义、能力集合、权限配置         │
│    ↓                                         │
│ 任务执行（Execution）                        │
│ └─ 次 AI 独立工作，生成反馈和建议           │
│    ├─ 定期报告进度                         │
│    ├─ 与其他次 AI 协作（如需要）           │
│    └─ 在主 AI 指导下调整方向                │
│    ↓                                         │
│ 报告（Reporting）                           │
│ └─ 汇总工作结果、反馈、建议                │
│    ↓                                         │
│ 销毁（Destruction）                         │
│ └─ 任务完成，次 AI 被销毁                  │
│    └─ 反馈和学习结果记录到知识库            │
│                                              │
└──────────────────────────────────────────────┘
```

### 2.2 次 AI 类型和角色

```javascript
const secondary_ai_types = {
  // 标准角色（预定义）
  security_auditor: {
    description: "安全审计和漏洞检测",
    capabilities: [
      "对抗性测试",
      "漏洞扫描",
      "权限分析",
      "数据流审计"
    ],
    permissions: ["read_code", "run_tests", "access_logs"],
    success_criteria: [
      "发现所有 CRITICAL 级漏洞",
      "无误报率 > 5%"
    ]
  },

  code_quality_analyzer: {
    description: "代码质量和复杂度分析",
    capabilities: [
      "复杂度计算",
      "风格检查",
      "依赖分析",
      "重构建议"
    ],
    permissions: ["read_code", "analyze"],
    success_criteria: [
      "识别所有 > 50 行的函数",
      "提出可行的重构建议"
    ]
  },

  performance_analyzer: {
    description: "性能基准测试和优化建议",
    capabilities: [
      "性能测试",
      "基准对比",
      "瓶颈分析",
      "优化建议"
    ],
    permissions: ["run_benchmarks", "profile"],
    success_criteria: [
      "基准数据准确度 > 95%",
      "识别 > 10% 的性能开销"
    ]
  },

  test_engineer: {
    description: "测试用例生成和覆盖率分析",
    capabilities: [
      "测试用例生成",
      "覆盖率分析",
      "边界条件测试",
      "回归测试管理"
    ],
    permissions: ["run_tests", "analyze_coverage"],
    success_criteria: [
      "覆盖率 ≥ 90%",
      "所有关键路径测试"
    ]
  },

  custom: {
    description: "自定义角色（由主 AI 定义）",
    capabilities: ["根据主 AI 指定"],
    permissions: ["根据主 AI 定义"],
    success_criteria: ["根据主 AI 定义"]
  }
};
```

> **⚠️ Phase 1 必须实现的 5 个标准角色**：
> 1. `security_auditor` - 安全审计和漏洞检测
> 2. `code_quality_analyzer` - 代码质量和复杂度分析
> 3. `performance_analyzer` - 性能基准测试和优化建议
> 4. `test_engineer` - 测试用例生成和覆盖率分析
> 5. `custom` - 自定义角色（由主 AI 定义）

### 2.2b 角色工厂模式（Role Factory Pattern）

```javascript
// 角色工厂模式：统一创建和管理次 AI 角色
const RoleFactory = {
  // 注册标准角色模板
  templates: {
    security_auditor: { /* 预定义配置 */ },
    code_quality_analyzer: { /* 预定义配置 */ },
    performance_analyzer: { /* 预定义配置 */ },
    test_engineer: { /* 预定义配置 */ },
  },

  // 创建角色实例
  createAgent(type, overrides = {}) {
    const template = this.templates[type];
    if (!template && type !== 'custom') {
      throw new Error(`Unknown role type: ${type}`);
    }
    return {
      agent_id: generateUUID(),
      type,
      role: { ...template, ...overrides },
      created_at: new Date().toISOString(),
      status: "INITIALIZING"
    };
  },

  // 注册自定义角色模板（扩展点）
  registerTemplate(type, config) {
    this.templates[type] = config;
  },

  // 获取所有可用角色类型
  getAvailableRoles() {
    return Object.keys(this.templates);
  }
};

// 使用示例：
// const agent = RoleFactory.createAgent('security_auditor', { max_time_minutes: 15 });
```

> **设计说明**：角色工厂模式确保了角色创建的一致性，同时支持通过 `registerTemplate` 扩展新角色类型。所有 5 个标准角色通过工厂预注册，自定义角色可在运行时动态注册。

### 2.3 次 AI 创建和管理

```javascript
// 主 AI 创建次 AI 的过程
const create_secondary_ai = {
  step1_identify_need: {
    trigger: "主 AI 识别需要一个次 AI",
    examples: [
      "需要代码审查 → 创建 code_quality_analyzer",
      "需要安全测试 → 创建 security_auditor",
      "需要性能验证 → 创建 performance_analyzer"
    ]
  },

  step2_prepare_context: {
    action: "准备次 AI 的上下文",
    includes: [
      "任务描述",
      "代码或数据范围",
      "成功标准",
      "优先级",
      "时间限制"
    ]
  },

  step3_instantiate: {
    action: "实例化次 AI",
    data: {
      agent_id: "uuid",
      type: "security_auditor | code_quality_analyzer | ...",
      role: "完整的角色描述",
      task: "具体任务",
      context: {
        code_scope: ["src/**/*.js"],
        data_scope: ["recent_changes"],
        historical_data: ["related_issues"]
      },
      constraints: {
        max_time: "30 分钟",
        max_resources: "2GB 内存",
        required_accuracy: 95
      }
    }
  },

  step4_initialize: {
    action: "初始化次 AI",
    steps: [
      "加载角色和能力定义",
      "准备任务环境",
      "验证权限和资源可用性",
      "启动独立执行环境"
    ]
  },

  step5_monitor: {
    action: "监控执行",
    checks: [
      "次 AI 是否还在运行？",
      "是否正常进行？",
      "是否需要指导？",
      "性能/资源是否正常？"
    ],
    frequency: "每 30 秒"
  },

  step6_collect_feedback: {
    action: "收集反馈",
    when: "次 AI 完成任务或被中止时",
    collects: [
      "工作结果和发现",
      "详细建议和理由",
      "置信度评分",
      "执行时间和资源使用"
    ]
  },

  step7_destroy: {
    action: "销毁次 AI",
    cleanup: [
      "释放资源",
      "保存反馈到知识库",
      "记录协作效果",
      "更新代理评分"
    ]
  }
};
```

### 2.4 反馈聚合机制

```javascript
// 多个次 AI 的反馈如何聚合
const feedback_aggregation = {
  // 场景：主 AI 为一个改进创建了 4 个次 AI
  scenario: {
    primary_ai_decision: "重构这个函数",
    secondary_ais_created: [
      "安全 AI：检查安全问题",
      "代码质量 AI：检查复杂度",
      "性能 AI：检查性能影响",
      "测试 AI：生成测试用例"
    ]
  },

  // 反馈收集
  collect: {
    timeout: "所有次 AI 完成或 60 分钟超时",
    parallel: "次 AI 们并行工作，不互相阻塞",
    streaming: "次 AI 可流式返回中间结果"
  },

  // 反馈聚合
  aggregate: {
    step1_collect: "收集所有次 AI 的反馈",
    step2_normalize: {
      action: "标准化反馈格式",
      map: {
        security_feedback: "安全相关反馈",
        quality_feedback: "代码质量反馈",
        performance_feedback: "性能相关反馈",
        test_feedback: "测试相关反馈"
      }
    },
    step3_deduplicate: "去除重复或冲突的反馈",
    step4_prioritize: {
      order: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      by_agreement: "多个 AI 同意的反馈优先级更高"
    },
    step5_summarize: "生成综合摘要（5-10 条关键反馈）"
  },

  // 反馈结构
  result: {
    aggregated_feedback: [
      {
        category: "security",
        severity: "HIGH",
        feedback: "发现了 1 个权限提升漏洞",
        sources: ["security_auditor"],
        agreement: "100%",
        confidence: 95
      },
      {
        category: "quality",
        severity: "MEDIUM",
        feedback: "函数复杂度从 15 降低到 8，改善 47%",
        sources: ["code_quality_analyzer"],
        agreement: "100%",
        confidence: 98
      },
      {
        category: "performance",
        severity: "LOW",
        feedback: "性能改善 3%，可以接受",
        sources: ["performance_analyzer"],
        agreement: "100%",
        confidence: 92
      }
    ],
    consensus: "建议采纳此改进，但需修复安全漏洞",
    next_steps: "修复安全问题后重新测试"
  }
};
```

### 2.5 主 AI 决策过程

```javascript
// 主 AI 如何基于反馈做出决策
const primary_ai_decision_process = {
  step1_analyze_feedback: {
    action: "分析聚合反馈",
    consider: [
      "反馈的一致性（consensus level）",
      "反馈的置信度（confidence score）",
      "反馈涉及的风险等级",
      "反馈的优先级"
    ]
  },

  step2_evaluate_options: {
    action: "评估可选方案",
    options: [
      {
        option: "采纳改进",
        pros: "解决了问题",
        cons: "有一个高风险安全问题需要修复",
        risk: "HIGH"
      },
      {
        option: "部分采纳（修改后）",
        pros: "可以采纳代码质量改进，修复安全问题",
        cons: "需要额外工作",
        risk: "MEDIUM"
      },
      {
        option: "拒绝改进",
        pros: "避免风险",
        cons: "失去性能和代码质量的改善",
        risk: "LOW"
      }
    ]
  },

  step3_make_decision: {
    action: "做出决策",
    decision: "部分采纳（修改后）",
    reasoning: "代码质量改善显著，但必须先修复安全问题",
    next_steps: [
      "修改改进方案以修复安全问题",
      "创建安全 AI 进行重新审计",
      "创建测试 AI 生成全面测试"
    ]
  },

  step4_communicate: {
    action: "与次 AI 沟通决策",
    to: "相关的次 AI",
    message: "决策已做出，以下是下一步..."
  },

  step5_execute: {
    action: "执行决策",
    implement: "应用批准的改进，实施修复"
  },

  step6_learn: {
    action: "学习和优化",
    record: [
      "哪些次 AI 的反馈最有价值？",
      "是否有反馈被忽视但后来证实正确？",
      "下次如何改进分配策略？"
    ]
  }
};
```

### 2.6 次 AI 间协作

```javascript
// 次 AI 之间可以相互协作
const secondary_ai_collaboration = {
  scenario: "代码质量 AI 在分析代码时发现了一个可疑的安全模式",

  collaboration_flow: {
    initiated_by: "code_quality_analyzer",
    action: "请求安全 AI 进行更深入的分析",
    message: {
      to: "security_auditor",
      subject: "请验证这段代码的安全性",
      code_snippet: "...",
      concern: "这段代码看起来可能有 SQL 注入风险"
    }
  },

  response: {
    from: "security_auditor",
    finding: "确实存在 SQL 注入漏洞，严重程度 CRITICAL",
    details: "参数未经过验证直接用于 SQL 查询",
    recommendation: "使用参数化查询"
  },

  result: {
    both_ais_agree: true,
    feedback_to_primary: "代码质量和安全都有问题，高优先级修复",
    efficiency_gain: "通过协作避免了重复工作，提高了发现的准确性"
  }
};
```

---

## 3. 数据模型

### 3.1 次 AI 定义和状态

```javascript
{
  agent_id: "uuid",

  // 角色和类型
  type: "security_auditor | code_quality_analyzer | performance_analyzer | ...",
  role: {
    name: "安全审计专家",
    description: "发现代码中的安全漏洞和风险",
    capabilities: ["adversarial_testing", "vulnerability_scanning", ...],
    permissions: ["read_code", "run_tests", "access_logs"]
  },

  // 生命周期
  lifecycle: {
    created_at: "2026-04-23T10:00:00Z",
    created_by: "primary_ai_123",
    task_id: "task_456",
    task_description: "审计新的用户认证模块",

    status: "RUNNING | COMPLETED | FAILED | TERMINATED",
    started_at: "2026-04-23T10:05:00Z",
    completed_at: "2026-04-23T10:35:00Z",

    execution_metrics: {
      total_time_ms: 1800000,
      cpu_usage_percent: 45,
      memory_usage_mb: 512,
      resource_limit_reached: false
    }
  },

  // 约束条件
  constraints: {
    max_time_minutes: 30,
    max_memory_mb: 1024,
    max_cpu_percent: 80,
    required_accuracy_percent: 95,
    priority: "HIGH"
  },

  // 协作记录
  collaborations: [
    {
      collaborated_with: "code_quality_analyzer",
      timestamp: "2026-04-23T10:15:00Z",
      interaction: "请求对某段代码的质量评估",
      result: "接收到代码复杂度和改进建议"
    }
  ],

  // 反馈和结果
  feedback: {
    findings: [
      {
        type: "CRITICAL",
        description: "SQL 注入漏洞",
        location: "src/auth.js:125",
        remediation: "使用参数化查询",
        confidence: 99
      },
      {
        type: "HIGH",
        description: "缺少输入验证",
        location: "src/auth.js:150",
        remediation: "添加白名单验证",
        confidence: 98
      }
    ],
    summary: "发现 2 个严重漏洞，需要立即修复",
    success_criteria_met: [
      "发现了所有 CRITICAL 级漏洞 ✅",
      "误报率 < 5% ✅"
    ]
  },

  // 性能评分
  performance_score: {
    effectiveness: 95,  // 发现的问题有多有效？
    efficiency: 88,     // 相对于花费的资源
    timeliness: 92,     // 是否按时完成
    accuracy: 97        // 建议的准确度
  }
}
```

### 3.2 反馈和决策记录

```javascript
{
  decision_id: "uuid",
  timestamp: "2026-04-23T10:40:00Z",

  // 决策背景
  primary_ai: "primary_ai_123",
  task: "重构用户认证模块",

  // 涉及的次 AI
  secondary_ais_involved: [
    {
      agent_id: "agent_sec_001",
      type: "security_auditor",
      status: "COMPLETED",
      feedback: { /* 反馈内容 */ }
    },
    {
      agent_id: "agent_code_001",
      type: "code_quality_analyzer",
      status: "COMPLETED",
      feedback: { /* 反馈内容 */ }
    },
    {
      agent_id: "agent_perf_001",
      type: "performance_analyzer",
      status: "COMPLETED",
      feedback: { /* 反馈内容 */ }
    },
    {
      agent_id: "agent_test_001",
      type: "test_engineer",
      status: "COMPLETED",
      feedback: { /* 反馈内容 */ }
    }
  ],

  // 聚合反馈
  aggregated_feedback: {
    consensus_level: 95,  // 0-100，所有 AI 同意程度
    key_findings: [ /* 主要发现 */ ],
    risk_assessment: "MEDIUM",
    recommendation: "采纳改进，但需修复安全问题"
  },

  // 主 AI 的决策
  decision: {
    action: "PARTIAL_ADOPTION",
    reasoning: "代码质量改善明显，但需要先解决安全问题",
    approved_changes: [ /* 批准的改进 */ ],
    required_fixes: [ /* 必要的修复 */ ],
    next_steps: [ /* 后续步骤 */ ]
  },

  // 执行结果
  execution: {
    started_at: "2026-04-23T10:45:00Z",
    completed_at: "2026-04-23T11:30:00Z",
    status: "SUCCESS",
    metrics: {
      improvements_applied: 5,
      bugs_fixed: 2,
      security_issues_resolved: 1
    }
  },

  // 学习记录
  learning: {
    effectiveness_of_secondary_ais: {
      security_auditor: 95,
      code_quality_analyzer: 92,
      performance_analyzer: 78,
      test_engineer: 88
    },
    surprising_findings: [
      "performance_analyzer 的建议不如预期有价值"
    ],
    improvements_for_next_time: [
      "减少 performance_analyzer 的权重",
      "增加 security_auditor 的权重"
    ]
  }
}
```

---

## 4. API 接口

### 4.1 次 AI 管理

```javascript
// 创建次 AI
POST /api/v1/secondary-agents
{
  type: "security_auditor",
  task_description: "审计用户认证模块",
  context: {
    code_scope: ["src/auth.js"],
    historical_issues: ["issue_123", "issue_456"]
  },
  constraints: {
    max_time_minutes: 30,
    max_memory_mb: 1024,
    required_accuracy_percent: 95
  }
}
Response: {
  agent_id: "uuid",
  status: "INITIALIZING",
  expected_completion_time: "2026-04-23T10:35:00Z"
}

// 获取次 AI 状态
GET /api/v1/secondary-agents/{agent_id}
Response: {
  agent_id: "uuid",
  status: "RUNNING",
  progress: 65,
  estimated_completion: "5 分钟"
}

// 获取次 AI 反馈
GET /api/v1/secondary-agents/{agent_id}/feedback
Response: {
  status: "COMPLETED",
  findings: [ /* 所有发现 */ ],
  summary: "发现 2 个严重问题",
  performance_score: 95
}

// 终止次 AI
POST /api/v1/secondary-agents/{agent_id}/terminate
Response: {
  agent_id: "uuid",
  status: "TERMINATED",
  partial_results: { /* 部分结果 */ }
}

// 获取所有活跃的次 AI
GET /api/v1/secondary-agents?status=RUNNING
Response: [
  { agent_id, type, task, progress }
]
```

### 4.2 反馈聚合和决策

```javascript
// 聚合多个次 AI 的反馈
POST /api/v1/feedback/aggregate
{
  agent_ids: ["agent_sec_001", "agent_code_001", "agent_perf_001"],
  task_id: "task_456"
}
Response: {
  aggregated_feedback: {
    consensus_level: 95,
    key_findings: [ /* 5-10 条关键发现 */ ],
    recommendation: "采纳改进"
  }
}

// 记录主 AI 决策
POST /api/v1/decisions
{
  primary_ai: "primary_ai_123",
  task: "重构认证模块",
  aggregated_feedback_id: "feedback_789",
  decision: {
    action: "PARTIAL_ADOPTION",
    reasoning: "...",
    approved_changes: [ /* 批准的改进 */ ],
    required_fixes: [ /* 必要的修复 */ ]
  }
}
Response: {
  decision_id: "uuid",
  status: "RECORDED"
}

// 获取决策历史
GET /api/v1/decisions?primary_ai=primary_ai_123&limit=10
Response: [
  { decision_id, timestamp, task, action, result }
]

// 学习分析：评估次 AI 的性能
GET /api/v1/analytics/secondary-ai-performance
Query: {
  agent_type: "security_auditor",
  time_period: "last_30_days"
}
Response: {
  avg_effectiveness: 92,
  avg_efficiency: 88,
  avg_timeliness: 94,
  trend: "improving",
  recommendations: "continue using this agent type"
}
```

### 4.3 协作管理

```javascript
// 次 AI 发起协作请求
POST /api/v1/collaborations
{
  from_agent: "agent_code_001",
  to_agent: "agent_sec_001",
  message: "请验证这段代码的安全性",
  context: { /* 相关上下文 */ }
}
Response: {
  collaboration_id: "uuid",
  status: "PENDING"
}

// 响应协作请求
POST /api/v1/collaborations/{collaboration_id}/respond
{
  response: "ACCEPTED",
  findings: { /* 分析结果 */ }
}
Response: {
  collaboration_id: "uuid",
  status: "COMPLETED"
}

// 获取协作历史
GET /api/v1/collaborations?agent_id=agent_code_001
Response: [
  { collaboration_id, participants, topic, result, timestamp }
]
```

---

## 5. 关键指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **反馈聚合准确率** | ≥ 95% | 聚合结果与实际情况的符合度 |
| **决策采纳率** | 60-80% | 主 AI 采纳次 AI 建议的比例 |
| **协作成功率** | ≥ 90% | 次 AI 之间的协作成功完成率 |
| **次 AI 效率** | ≥ 85% | 相对于分配的资源的有效性 |
| **学习改进率** | ≥ 10%/month | 基于历史反馈的决策改进速度 |

---

## 7. API 实现状态 (2026-04-24)

> **状态**: ✅ 已实现

### 已实现端点

| 端点 | 方法 | 状态 | 文件 |
|------|------|------|------|
| `/api/v1/agents` | GET | ✅ | `src/api/routes/agents.js` |
| `/api/v1/agents` | POST | ✅ | `src/api/routes/agents.js` |
| `/api/v1/agents/:id` | GET | ✅ | `src/api/routes/agents.js` |
| `/api/v1/agents/:id/feedback` | GET | ✅ | `src/api/routes/agents.js` |
| `/api/v1/agents/:id` | DELETE | ✅ | `src/api/routes/agents.js` |
| `/api/v1/feedback/aggregate` | POST | ✅ | `src/api/routes/feedback.js` |
| `/api/v1/decisions` | GET | ✅ | `src/api/routes/decisions.js` |
| `/api/v1/decisions` | POST | ✅ | `src/api/routes/decisions.js` |
| `/api/v1/decisions/:id/execute` | POST | ✅ | `src/api/routes/decisions.js` |

### 核心模块

| 模块 | 状态 | 文件 |
|------|------|------|
| MultiAgentCoordinator | ✅ | `src/core/multi-agent-coordinator.js` |
| EvolutionSystem | ✅ | `src/core/evolution-system.js` |

---

## 8. 实现检查清单

- [x] 次 AI 类型和角色定义系统
- [x] 次 AI 生命周期管理（创建、初始化、执行、销毁）
- [x] 反馈收集和标准化
- [x] 反馈聚合和去重引擎
- [ ] 主 AI 决策支持系统
- [ ] 次 AI 间协作机制
- [ ] 性能评分和学习系统
- [x] API 接口实现
- [ ] 数据持久化（决策历史、协作记录）
- [x] 测试覆盖（≥ 90%）
- [ ] 文档和示例

---

**下一步**：P0-03 跨 Bridge P2P 通信协议规范
