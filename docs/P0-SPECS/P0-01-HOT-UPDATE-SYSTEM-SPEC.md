# 🔄 去中心化热更新策略 - 实现规范（已修订）

> **优先级**: 🔴 P0 | **复杂度**: ⭐⭐⭐ 中等 | **估算工作量**: 28-35 小时

### 修订说明
> 本文档已根据 CODE-SPEC-ALIGNMENT-PLAN.md 中定义的混合方案（Hybrid Approach）进行修订。主要变更：
> - API 端点从 9 个精简为 5 个
> - Watchdog 从 4 层简化为 2 层（5s 和 30s）
> - 使用动态代码加载（dynamic code loading）而非进程重启
> - Phase 1 移除 P2P 发现，改为手动更新检查
> - 工作量估算：35-45h → 28-35h

## 1. 系统概述

### 架构变化
```
原架构：中央控制灰度发布 → 所有节点同步更新
新架构：节点独立决策 → 何时更新由 Bridge 决定
```

### 核心特点
- ✅ 每个 Bridge 节点独立运行
- ✅ 不依赖中央服务协调
- ✅ 节点自主决定更新时机
- ✅ 本地验证和测试
- ✅ 完全离线可工作
- ✅ 故障自动回滚

---

## 2. 架构设计

### 系统组件

```
Bridge 节点（独立）
├─ 更新检测模块
│  ├─ 手动检查新版本（Phase 1，后续支持 P2P 自动发现）
│  ├─ 检查更新兼容性
│  └─ 评估是否应该更新
│
├─ 本地验证模块
│  ├─ 运行单元测试
│  ├─ 运行集成测试
│  ├─ 验证关键功能
│  └─ 性能基准测试
│
├─ 安全验证模块
│  ├─ 代码签名验证
│  ├─ 对抗性测试
│  ├─ 安全漏洞扫描
│  └─ 资源限制检查
│
├─ 决策模块
│  ├─ 判断是否更新
│  ├─ 选择更新时机
│  └─ 评估风险
│
├─ 热更新执行模块
│  ├─ 使用动态代码加载（dynamic code loading）
│  ├─ 不重启进程，不中断现有连接
│  ├─ 等待旧代码完成
│  └─ 切换到新代码
│
└─ 监控和回滚模块
   ├─ 双层 Watchdog（5s + 30s）
   ├─ 性能衰退检测
   ├─ 自动故障回滚
   └─ 记录更新历史
```

### 与现有系统的集成

```
Bridge 本地
├─ EvolutionEngine
│  └─ 决策是否更新
├─ 性能基准系统
│  └─ 验证更新是否导致性能衰退
├─ 安全系统
│  └─ 对抗性测试新版本
└─ 日志系统
   └─ 记录所有更新过程
```

---

## 3. 核心功能设计

### 3.1 更新发现机制

**手动检查更新（Phase 1）**

> **注意**：Phase 1 不实现 P2P 自动发现，采用手动更新检查方式。P2P 发现将在后续阶段集成。

```javascript
// Bridge 节点手动检查更新（Phase 1）
const update_discovery = {
  frequency: "手动触发或启动时检查",  // Phase 1: 无自动 P2P 发现

  sources: [
    "官方发布渠道",
    "本地配置的更新源"
    // P2P peer 节点发现将在后续阶段支持
  ],

  information: {
    version: "2.1.0",
    changelog: "修复 Bug，优化性能",
    compatibility: [">=2.0.0"],
    signatures: {
      author: "sig1...",
      official: "sig2..."
    }
  }
};
```

### 3.2 兼容性和风险评估

```javascript
const evaluate_update = {
  step1_compatibility: {
    check: "当前版本是否兼容新版本？",
    method: "检查 breaking changes",
    result: "compatible" | "requires_rollback_plan"
  },

  step2_local_test: {
    actions: [
      "运行单元测试",
      "运行集成测试",
      "运行对抗性测试",
      "性能基准测试"
    ],
    requirement: "所有测试必须通过"
  },

  step3_risk_assessment: {
    factors: [
      "代码改动规模",
      "涉及模块数量",
      "安全测试结果",
      "性能影响"
    ],
    decision: "安全_可以更新" | "风险_延后更新" | "危险_不更新"
  }
};
```

### 3.3 智能决策逻辑

**Bridge 何时应该更新？**

```javascript
const should_update = {
  // 优先级：安全性 > 稳定性 > 新功能

  must_update: [
    "安全漏洞修复（CRITICAL）",
    "系统崩溃修复"
  ],

  should_update: [
    "性能显著改进（>15%）",
    "重要 Bug 修复",
    "重要功能添加"
  ],

  can_skip: [
    "小功能优化（<5%）",
    "非关键 Bug",
    "美化改进"
  ],

  should_not_update: [
    "测试失败的版本",
    "降低性能的版本",
    "安全漏洞版本",
    "用户明确禁用的版本"
  ]
};
```

### 3.4 更新执行流程

```
┌─────────────────────────────────────────────────┐
│          Bridge 节点更新流程                    │
├─────────────────────────────────────────────────┤
│                                               │
│ 1️⃣ 发现新版本                                 │
│    从 P2P 网络获取更新信息                      │
│    ↓                                          │
│ 2️⃣ 下载和验证                                 │
│    下载新版本代码                              │
│    验证代码签名（确保来源可信）                  │
│    ↓                                          │
│ 3️⃣ 本地测试                                   │
│    ├─ 单元测试                                │
│    ├─ 集成测试                                │
│    ├─ 对抗性测试                              │
│    └─ 性能基准测试                            │
│    ↓ 通过所有测试？                           │
│    YES → 继续 | NO → 放弃更新，记录原因        │
│    ↓                                          │
│ 4️⃣ 风险评估                                   │
│    ├─ 兼容性检查                              │
│    ├─ 改动规模评估                            │
│    ├─ 安全风险评估                            │
│    └─ 性能影响评估                            │
│    ↓ 风险可接受？                             │
│    YES → 继续 | NO → 延后或不更新             │
│    ↓                                          │
│ 5️⃣ 选择更新时机                              │
│    ├─ 用户使用率低谷                          │
│    ├─ 网络连接稳定                            │
│    ├─ 电池电量充足                            │
│    └─ 存储空间足够                            │
│    ↓ 等待最佳时机...                         │
│    ↓                                          │
│ 6️⃣ 执行热更新（动态代码加载）                 │
│    ├─ 使用 dynamic code loading 加载新模块    │
│    ├─ 不重启进程，在运行中替换模块             │
│    ├─ 切换流量到新代码                        │
│    ├─ 等待旧代码完成                          │
│    └─ 清理旧代码                              │
│    ↓                                          │
│ 7️⃣ 双层监控（实时）                           │
│    ├─ 5s 检测：API 是否响应、进程是否存活     │
│    └─ 30s 检测：业务逻辑和整体系统健康        │
│    ↓ 发现问题？                               │
│    YES → 立即回滚 | NO → 继续监控             │
│    ↓                                          │
│ 8️⃣ 更新完成                                   │
│    ├─ 验证所有功能正常                        │
│    ├─ 记录更新时间和效果                      │
│    ├─ 更新本地版本号                          │
│    └─ 通知本地应用程序                        │
│                                               │
└─────────────────────────────────────────────────┘
```

### 3.5 故障回滚流程

**如果更新失败怎么办？**

```javascript
const rollback_process = {
  trigger: {
    conditions: [
      "Watchdog 检测到崩溃",
      "错误率 > 10%",
      "性能衰退 > 20%",
      "关键功能不可用",
      "用户手动触发回滚"
    ]
  },

  action: {
    immediate: "立即停止新版本",
    switch: "切换回旧版本",
    verify: "验证旧版本是否正常",
    notify: "通知 EvolutionEngine（记录失败）"
  },

  failure_analysis: {
    log: "记录失败日志",
    root_cause: "分析失败原因",
    prevent: "更新防守规则防止再次发生"
  }
};
```

---

## 4. 数据模型

### 4.1 版本元数据

```javascript
{
  version_id: "uuid",
  version_number: "2.1.0",

  // 来源信息
  source: {
    type: "official" | "community",
    author: "author_id",
    publish_date: "2026-04-23T10:00:00Z"
  },

  // 签名验证
  signatures: {
    author_signature: "sig...",
    official_approval: "official_sig..." // 如果需要审批
  },

  // 兼容性
  compatibility: {
    min_version: "2.0.0",
    max_version: null,
    breaking_changes: []
  },

  // 变更说明
  changelog: "修复 Bug，优化性能",

  // 本地更新历史
  local_update_history: {
    node_id: "bridge_123",
    download_at: "2026-04-23T11:00:00Z",
    tested_at: "2026-04-23T11:05:00Z",
    test_results: "PASSED",
    updated_at: "2026-04-23T12:00:00Z",
    status: "active" | "rolled_back" | "failed"
  }
}
```

### 4.2 更新决策记录

```javascript
{
  decision_id: "uuid",
  version: "2.1.0",
  timestamp: "2026-04-23T11:00:00Z",

  // 决策过程
  decision_process: {
    compatibility_check: "PASS",
    test_results: "PASS",
    risk_assessment: "LOW",
    performance_impact: "+5%",  // 性能改进
    decision: "UPDATE",
    reason: "安全补丁，必须更新"
  },

  // 更新结果
  update_result: {
    start_time: "2026-04-23T12:00:00Z",
    end_time: "2026-04-23T12:05:00Z",
    status: "SUCCESS",
    watchdog_alarms: 0,
    user_impact: "零影响"
  }
}
```

---

## 5. API 接口（5 个端点）

### 5.1 更新管理

```javascript
// 检查可用更新
GET /api/v1/updates/available
Response: {
  available_versions: [
    {
      version: "2.1.0",
      type: "security_patch",
      size: "50MB",
      estimated_update_time: "5分钟"
    }
  ]
}

// 获取版本信息
GET /api/v1/updates/{version}
Response: { 完整的版本信息 }

// 执行更新
POST /api/v1/updates/{version}/apply
{
  auto_rollback_if_failed: true,
  preferred_update_time: "off_peak"  // 用户使用率低谷
}
Response: { update_id, status: "in_progress" }

// 回滚更新
POST /api/v1/updates/{version}/rollback
Response: { rollback_id, status: "starting" }

// 获取更新历史
GET /api/v1/updates/history
Query: { limit: 10, status: "all" | "success" | "failed" }
Response: [ { 更新历史记录 } ]
```

> **已移除的端点**（相比原始规范）：
> - `GET /api/v1/updates/{update_id}/status` - 状态通过 apply 响应和 history 查询获取
> - `POST /api/v1/updates/{version}/block` - 移至后续阶段
> - `GET /api/v1/updates/recommendations` - 移至后续阶段
> - `PUT /api/v1/updates/policy` - 移至后续阶段

---

## 6. 关键指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| **更新成功率** | ≥ 99% | 成功更新的比例 |
| **更新检测延迟** | < 24 小时 | 新版本发布到发现的时间 |
| **更新执行时间** | < 10 分钟 | 从开始到完成的时间 |
| **故障检测时间** | < 1 分钟 | 发现问题到回滚的时间 |
| **测试覆盖率** | ≥ 95% | 更新前的测试覆盖 |

---

## 7. 设计原则

### 原则一：节点自主
```
不依赖中央服务
├─ 每个 Bridge 独立决策
├─ 可以离线工作
└─ 不受网络延迟影响
```

### 原则二：安全第一
```
更新前充分验证
├─ 代码签名检查
├─ 本地完整测试
├─ 兼容性验证
└─ 风险评估
```

### 原则三：用户体验
```
更新无感知
├─ 不中断服务
├─ 在低谷时更新
├─ 自动回滚故障
└─ 用户可控制
```

### 原则四：故障自愈
```
完全自动回滚
├─ 双层 Watchdog（5s + 30s）
├─ 实时监控
├─ 快速回滚
└─ 自动分析原因
```

---

## 8. API 实现状态 (2026-04-24)

> **状态**: ✅ 已实现

### 已实现端点

| 端点 | 方法 | 状态 | 文件 |
|------|------|------|------|
| `/api/v1/updates/available` | GET | ✅ | `src/api/routes/updates.js` |
| `/api/v1/updates/:version` | GET | ✅ | `src/api/routes/updates.js` |
| `/api/v1/updates/:version/apply` | POST | ✅ | `src/api/routes/updates.js` |
| `/api/v1/updates/:version/rollback` | POST | ✅ | `src/api/routes/updates.js` |
| `/api/v1/updates/history` | GET | ✅ | `src/api/routes/updates.js` |

### 核心模块

| 模块 | 状态 | 文件 |
|------|------|------|
| HotUpdateManager | ✅ | `src/core/hot-update-manager.js` |
| VersionManager | ✅ | `src/updates/version-manager.js` |

---

## 9. 实现检查清单

- [x] 版本发现和下载（手动触发，Phase 1）
- [ ] 代码签名验证
- [ ] 本地测试框架
- [ ] 兼容性检查引擎
- [ ] 决策和评估系统
- [x] 动态代码加载热更新（dynamic code loading）
- [x] 双层 Watchdog（5s + 30s）
- [x] 自动回滚系统
- [x] API 端点实现（5 个端点）
- [x] 测试覆盖（集成测试）

---

**关键改变**：
✅ 从中央灰度控制 → 节点独立决策
✅ 从多节点版本同步 → 各节点自主更新
✅ 从中央验证 → 本地完整验证
✅ 从被动回滚 → 主动故障检测和自动回滚
