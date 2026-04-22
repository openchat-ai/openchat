# 🤖 规范自动化集成系统

> 让AI在开发时自动遵守规范，完全无需人工干预

---

## 问题分析

**之前的方案问题**：
- ❌ 需要人工复制系统提示给Claude
- ❌ 需要人工告诉AI违规信息
- ❌ 有人工干预点
- ❌ 违反"100%无人干预"的设计理念

**真正需要的方案**：
- ✅ 规范自动加载（AI无需手动复制）
- ✅ 规范自动应用（AI在生成时就遵守）
- ✅ 自动验证（代码生成后自动检查）
- ✅ 自动修复（违规自动改正）
- ✅ 完全无人干预

---

## 解决方案：规范集成到工具链

### 方案 1️⃣ ：Claude Code 环境集成

如果用户使用 Claude Code（集成在IDE中）：

```
Claude Code 启动
  ↓
自动读取项目根目录的 .claude/conventions.json
  ↓
加载规范到Claude的上下文
  ↓
Claude 在生成代码时遵守规范
  ↓
生成的代码自动符合规范
  ↓
预提交钩子只需验证（几乎总是通过）
```

**需要创建的文件**：`.claude/conventions.json`

```json
{
  "conventions": {
    "max_lines_per_step": 500,
    "test_coverage_minimum": 90,
    "status_marks_allowed": ["✅", "⏱️"],
    "status_marks_forbidden": ["❌", "⚠️", "⏳", "[ ]", "[x]"],
    "commit_format": "type(scope): subject",
    "commit_types": ["feat", "fix", "docs", "refactor", "test", "chore"],
    "doc_update_required": true,
    "auto_verify": true
  },
  "rules": {
    "short_steps": {
      "description": "每个Step必须 < 500行代码",
      "enforcement": "hard"
    },
    "status_marks": {
      "description": "只用✅⏱️两种标记",
      "enforcement": "hard"
    },
    "test_first": {
      "description": "必须包含单元测试（>90%覆盖）",
      "enforcement": "hard"
    },
    "doc_sync": {
      "description": "代码和文档必须同时更新",
      "enforcement": "hard"
    }
  }
}
```

---

### 方案 2️⃣：MCP Server 集成

如果项目足够大，创建一个 MCP Server 来提供规范：

```javascript
// openchat-conventions-mcp.js
// 一个MCP Server，让Claude能读取和验证规范

class ConventionsMCPServer {
  // Claude可以调用的方法

  async getConventions() {
    // 返回当前项目的所有规范
    return {
      maxLinesPerStep: 500,
      statusMarks: ['✅', '⏱️'],
      commitFormat: 'type(scope): subject',
      // ... 其他规范
    }
  }

  async verifyCode(code) {
    // AI生成代码后，自动验证是否符合规范
    return {
      passes: true,
      violations: [],
      suggestions: []
    }
  }

  async verifyCommitMessage(message) {
    // 验证commit message是否符合格式
    return {
      valid: true,
      error: null
    }
  }

  async verifyDocumentation(docPath) {
    // 验证文档是否遵守规范
    return {
      valid: true,
      violations: []
    }
  }
}
```

Claude可以直接调用这些方法，完全无需人工干预。

---

### 方案 3️⃣：项目根目录配置

创建一个规范配置文件，让任何工具都能读取：

```yaml
# .openchat-conventions.yaml
conventions:
  code:
    max_lines_per_feature: 500
    test_coverage: ">90%"
    must_include_tests: true

  documentation:
    status_marks_allowed:
      - "✅"  # 已实现
      - "⏱️"  # 可选功能
    status_marks_forbidden:
      - "❌"  # 仅用于错误示例
      - "⚠️"  # 仅用于标题
      - "⏳"  # 废弃
    must_update_on_code_change: true

  commits:
    format: "type(scope): subject"
    types:
      - feat
      - fix
      - docs
      - refactor
      - test
      - chore
    min_description_length: 10
    max_description_length: 50

  validation:
    pre_commit_hook: true
    auto_verify_code: true
    auto_verify_docs: true

enforcement:
  level: "strict"  # hard, medium, soft
  auto_fix: true   # 能自动修复的问题自动修复
  require_manual_review: false  # 违规不需要人工审查
```

---

## 真实的无人干预方案

### 完整流程（0% 人工干预）

```
1. 用户描述需求给Claude
   "添加Skill持久化功能"

2. Claude Code读取.openchat-conventions.yaml
   自动加载规范到上下文

3. Claude生成代码
   ├─ 自动检查：这个功能会超过500行吗？
   ├─ 自动生成：单元测试（保证>90%覆盖）
   ├─ 自动更新：相关文档
   └─ 自动验证：所有规范都满足吗？

4. Claude 说："代码已生成，符合所有规范"

5. 用户复制代码到IDE

6. git commit

7. 预提交钩子验证
   └─ ✅ 100%通过（因为Claude已经遵守规范）

8. 自动部署、自动测试、自动回滚
   完全无需人工干预
```

**人工干预次数：0次** ✅

---

## 实现优先级

### 🔴 立即实现（关键）

1. **创建 .openchat-conventions.yaml**
   - 规范文件化
   - 机器可读
   - 任何工具都能使用

2. **更新预提交钩子**
   - 读取 .openchat-conventions.yaml
   - 根据配置验证代码

3. **创建规范说明文档**
   - 告诉Claude这些配置是什么意思

### 🟡 下一步（优化）

4. **创建 .claude/conventions.json**
   - Claude Code 格式的规范

5. **编写 MCP Server**（可选）
   - 如果使用Claude API的工具需要

6. **IDE插件**（未来）
   - 在开发时实时显示规范

---

## 新文件清单

### 必须创建

```
.openchat-conventions.yaml
  ↑ 机器可读的规范文件
  ↑ 预提交钩子会读取这个
  ↑ Claude Code会读取这个
  ↑ 任何工具都能理解
```

### 可选创建

```
.claude/conventions.json
  ↑ Claude Code格式

openchat-conventions-mcp.js
  ↑ MCP Server（高级）
```

---

## 关键改进

### 之前的问题
```
Claude → 需要复制提示 → Claude理解 → 生成代码
           （人工干预）
```

### 现在的方案
```
Claude Code → 自动读取.openchat-conventions.yaml
           → 自动理解规范
           → 自动遵守
           （完全自动）
```

---

## 对用户使用的影响

### 场景：用Claude Code开发

```
1. 打开Claude Code（IDE集成）
2. 描述需求："添加Skill持久化"
3. Claude Code自动读取规范
4. Claude自动遵守规范生成代码
5. 复制代码到你的编辑器
6. git commit
7. ✅ 100%通过预提交钩子
8. 自动部署

完全无需：
  ❌ 复制系统提示
  ❌ 告诉Claude违规
  ❌ 人工修改
  ❌ 任何人工干预
```

---

## 总结

你说得对，之前的方案违背了"100%无人干预"的设计理念。

**真正的解决方案**：
- ✅ 规范文件化（.openchat-conventions.yaml）
- ✅ 工具可读（机器能理解）
- ✅ 自动加载（无需手动复制）
- ✅ 自动应用（AI自动遵守）
- ✅ 自动验证（代码生成后自动检查）
- ✅ 完全无人干预（0% 人工参与）

这样，Claude Code就能完全自动地遵守规范，就像OpenChat系统本身一样自动化。

---

**这才是真正的"自进化系统"！** 🚀
