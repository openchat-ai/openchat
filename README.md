
---

## 🌍 全局约定规范（永久生效）

所有开发工作必须遵守 **GLOBAL_CONVENTIONS.md** 中的规范。

### 🚀 快速开始

```bash
# 1️⃣  第一次开发时安装规范
bash setup-conventions.sh

# 2️⃣  验证规范已启用
bash check-conventions.sh

# 3️⃣  开始开发（规范自动检查）
git commit -m "feat(scope): description"
```

### 🔴 核心规范（5条不可违反）

| # | 规范 | 要求 | 自动检查 |
|---|------|------|---------|
| 1️⃣ | **状态标记统一** | 只用 ✅ ⏱️ | ✅ |
| 2️⃣ | **短步快跑** | < 2小时, < 500行 | ✅ |
| 3️⃣ | **文档同步** | 代码+文档同时更新 | ✅ |
| 4️⃣ | **提交规范** | type(scope): subject | ✅ |
| 5️⃣ | **测试优先** | coverage > 90% | 🔍 |

### 📚 文档导航

| 文档 | 说明 | 何时查看 |
|-----|------|---------|
| **GLOBAL_CONVENTIONS.md** | 完整规范（宪法） | 需要详细了解 |
| **CONVENTIONS_CHEATSHEET.md** | 快速参考 | 快速查询 |
| **QUICK_START.md** | 新开发者指南 | 第一次开发 |
| **STATUS_CONVENTION.md** | 状态标记说明 | 了解✅⏱️ |

### ✅ 规范持久性

✅ **短期（当前开发）** - 100%生效
  - 预提交钩子已安装
  - 每次提交自动检查
  - 无法被绕过（除非用--no-verify，但违反规范）

✅ **长期（整个团队）** - 100%生效
  - 规范文档已commit到git
  - setup-conventions.sh 确保新开发者也安装钩子
  - post-checkout 钩子定期检查
  - 所有人看到同样的规范

### ⚠️ 重要提示

- ✅ 规范已自动启用
- ❌ 禁止使用 `git commit --no-verify` 跳过检查
- 📢 违规代码无法提交
- 🔧 修复问题后重新提交

### 🔧 命令速查

```bash
# 安装规范（新开发者必须运行）
bash setup-conventions.sh

# 检查规范安装状态
bash check-conventions.sh

# 查看完整规范
cat GLOBAL_CONVENTIONS.md

# 查看快速参考
cat CONVENTIONS_CHEATSHEET.md
```

详细说明：参见 **QUICK_START.md**

