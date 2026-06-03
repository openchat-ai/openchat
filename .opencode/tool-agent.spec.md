# spec: opencode agent tool-detection

> 给 opencode agent 增加从对话中识别工具/指令并自动执行的能力，含安全权限控制。

## 数据流

```
用户对话 → Agent 解析 → 工具/指令识别
  ↓ 匹配成功              ↓ 无匹配
  权限检查 ← Permission    正常回复
  ↓ allow/ask              ↓
  执行工具 → 返回结果 → 回复用户
```

## 接口签名

```json
// .opencode/opencode.json
{
  "agent": {
    "<agent-name>": {
      "permission": { "<tool>": "allow" | "ask" | "deny" }
    }
  },
  "permission": {
    "<tool>": "allow" | { "<pattern>": "allow" | "ask" | "deny" }
  }
}

// .opencode/agents/<name>.md frontmatter
---
permission:
  <tool>: allow | ask | deny
---
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 对话中提到模糊指令（如"跑一下"） | Agent 根据上下文推断最佳匹配工具并执行 |
| 指令匹配失败（如"帮我买咖啡"） | 回复无法执行，不报错 |
| 权限 deny | 拒绝执行，说明原因 |
| 权限 ask | 询问用户确认后执行 |
| 输出来自 `external_directory` | 按权限规则检查路径 |
| 命令含密码/api key | 不上传到 LLM 上下文 |
| 连续多个工具 | 串行执行，按顺序返回结果 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `.opencode/opencode.json` | 项目级 Agent + Permission 配置 | 50 |
| `.opencode/agents/<name>.md` | 工具识别 Agent 定义 | 80 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C1 | `[tool-detect]` | agent prompt | 检测到工具提及 |
| C2 | `[tool-exec]` | agent prompt | 工具执行结果 |
| C3 | `[tool-deny]` | agent prompt | 权限拒绝 |

## 不变量

```
// === invariants ===
// - .opencode/ 下的配置对项目内所有会话生效
// - Agent Permission 优先于顶层 Permission
// - 敏感词（apiKey, token, password）永不进 LLM 上下文
// - 外部目录访问需显式 external_directory 规则
```
