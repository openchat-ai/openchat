# 🚀 快速开始 - OpenChat 全局约定规范

> **最后更新**: 2026-04-29

## 第一次开始开发？

### 1️⃣ Clone 项目
```bash
git clone <openchat-repo> openchat
cd openchat
```

### 2️⃣ 安装规范
```bash
bash setup-conventions.sh
```

该脚本会自动：
- ✅ 检查规范文档
- ✅ 安装预提交钩子
- ✅ 配置git
- ✅ 验证规范

### 3️⃣ 开始开发
```bash
git checkout -b feature/your-feature
# 开发你的功能...
git commit -m "feat(scope): description"
```

---

## ⚙️ 规范自动检查流程

当你运行 `git commit` 时：

```
Your Changes
    ↓
Pre-commit Hook (自动触发)
    ↓
检查 1: 状态标记规范 (✅ ⏱️)
检查 2: 文档头部格式
检查 3: Commit Message格式
检查 4: 代码行数 (< 500行)
    ↓
全部通过？
    ├─ YES → ✅ 提交成功
    └─ NO  → ❌ 拒绝提交，显示错误
```

---

## 📋 核心规范速查

| 规范 | 要求 | 自动检查 |
|------|------|---------|
| **状态标记** | 只用 ✅ ⏱️ | ✅ |
| **代码行数** | < 500行 | ✅ |
| **Commit格式** | type(scope): subject | ✅ |
| **文档同步** | 代码+文档同时更新 | 🔍 |
| **测试覆盖** | > 90% | 🔍 |

---

## 🛠️ 常见问题

### Q1: 如果预提交钩子被删除了怎么办？
```bash
# 重新安装
bash setup-conventions.sh
```

### Q2: 能否跳过预提交检查？
```bash
# ❌ 禁止使用 --no-verify
git commit --no-verify  # 违反规范！

# ✅ 应该修复问题再提交
# 修复...
git commit -m "..."
```

### Q3: 我看不到详细规范怎么办？
```bash
# 查看完整规范
cat GLOBAL_CONVENTIONS.md

# 查看快速参考
cat CONVENTIONS_CHEATSHEET.md

# 查看状态标记规范
cat STATUS_CONVENTION.md
```

### Q4: 多人开发时如何确保规范对所有人生效？
- ✅ 规范文档已 commit 到 git
- ✅ setup-conventions.sh 自动安装钩子
- ✅ 每次 checkout 时 post-checkout 钩子会检查
- ✅ 团队所有人必须运行 setup-conventions.sh

### Q5: 规范可以改吗？
是的，但要遵循流程：
1. 提出建议（创建 Issue）
2. 讨论和评估
3. 更新 GLOBAL_CONVENTIONS.md
4. 所有人重新运行 setup-conventions.sh

---

## 🔒 规范持久性

### 短期（当前开发环境）
✅ **100% 生效**
- 预提交钩子已安装在 .git/hooks/
- 每次提交自动检查
- 无法被绕过（除非用 --no-verify，但违反规范）

### 长期（整个团队）
✅ **100% 生效**
- 规范文档已 commit 到 git
- setup-conventions.sh 确保新开发者也安装钩子
- post-checkout 钩子定期检查
- 所有人都看到同样的规范和检查

### 能被绕过吗？
```
技术上：YES，用 git commit --no-verify
实际上：NO，因为：
  1. 这违反了核心规范
  2. 代码审查会发现
  3. 项目文化不允许
```

---

## 📚 文档导航

| 文档 | 用途 | 何时查看 |
|-----|------|---------|
| **GLOBAL_CONVENTIONS.md** | 完整规范（宪法） | 需要了解完整规范 |
| **CONVENTIONS_CHEATSHEET.md** | 快速参考 | 快速查询或回顾 |
| **STATUS_CONVENTION.md** | 状态标记规范 | 了解✅⏱️的含义 |
| **setup-conventions.sh** | 自动安装脚本 | 新机器第一次运行 |
| **QUICK_START.md** | 本文档 | 快速上手 |

---

## ✅ 验收清单

开始开发前，请确认：

- [ ] 已运行 `bash setup-conventions.sh`
- [ ] 已阅读 CONVENTIONS_CHEATSHEET.md
- [ ] 理解 5 大核心规范
- [ ] 预提交钩子已启用（git commit 时会显示检查信息）

---

## 🚀 现在准备好了！

```bash
# 创建功能分支
git checkout -b feature/your-feature

# 开发功能
# ... 编写代码 ...

# 提交（会自动检查规范）
git commit -m "feat(scope): 简明扼要的说明"

# 如果检查失败，修复问题后重新提交
```

**规范已就位，质量有保证！** ✨

---

**最后更新**: 2026-04-22
**适用版本**: 1.0+
**维护者**: 项目架构师
