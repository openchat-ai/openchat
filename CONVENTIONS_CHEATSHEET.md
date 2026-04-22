# 📌 全局约定速查表

## 状态标记规范

```
✅ = 已完全实现并集成
⏱️ = 可选功能/未来规划

禁止：❌ ⚠️ ⏳ [ ] [x]
```

## 短步快跑原则

```
Step大小：< 2小时，< 500行代码
流程：功能 → 测试 → 提交 → 验证
禁止：一次性写大量代码后再测试
```

## 文档维护

| 文档 | 位置 | 维护频率 |
|-----|------|---------|
| 全局约定 | GLOBAL_CONVENTIONS.md | 月 |
| 架构 | arch.md | 周 |
| 规则 | rules.md | 周或变更时 |
| 计划 | plan.md | 每个Step完成后 |
| 研究 | research.md | 周或技术变更时 |

## 提交规范

```
格式：type(scope): subject

type: feat|fix|docs|refactor|test|chore
scope: 模块名或功能区域
subject: 简明扼要的说明

示例：
  docs(rules): 更新规则说明
  feat(skill-manager): 添加Skill持久化
```

## 检查清单（每个Step必须）

- [ ] 代码 < 500行
- [ ] 单元测试 > 90%
- [ ] 所有测试通过
- [ ] 没有破坏现有功能
- [ ] 文档已更新
- [ ] Commit message规范
- [ ] 预提交钩子通过

## 核心不可违反原则

1. ✅ 测试优先 - 测试 > 代码
2. ✅ 文档同步 - 代码和文档必须同时更新
3. ✅ 小步提交 - < 500行，通过所有测试
4. ✅ 审查必须 - 不能自我审查
5. ✅ 回滚安全 - 失败立即回滚

## 快速链接

- 📖 [GLOBAL_CONVENTIONS.md](./GLOBAL_CONVENTIONS.md) - 完整规范（必读）
- 📋 [STATUS_CONVENTION.md](./STATUS_CONVENTION.md) - 状态标记规范
- 🔱 [rules.md](./rules.md) - 项目核心规则
- 📋 [plan.md](./plan.md) - 实现计划
- 📚 [research.md](./research.md) - 技术研究

---

**最后更新**：2026-04-22
**维护者**：项目架构师
**优先级**：🔴 最高 - 所有工作必须遵守
