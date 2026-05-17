# 项目开发指南

> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| **后端** | Node.js 24 + ESM | Bridge 核心，`bridge/` |
| **API** | Express.js 4 | REST API 服务器 (端口 3001) |
| **P2P** | hyperswarm 4 | DHT 网络 + 节点发现 |
| **WebSocket** | ws 8 | 实时通信 |
| **音频** | RNNoise WASM + ONNX Runtime | 语音降噪 + 神经编解码 |
| **信令** | 七牛云 SDK | P2P 打洞信令 |
| **进程守护** | PM2 5 | 生产环境进程管理 |
| **前端** | Flutter 3.11+ (Dart) | `openchat-flutter/` 客户端 |
| **状态管理** | Riverpod 2.5 | Flutter 状态管理 |
| **持久化** | Hive | Flutter 本地存储 |
| **WebRTC** | flutter_webrtc | 实时音视频 |

## 关键命令

```bash
# === Bridge 后端 ===
cd bridge

npm start                    # 启动 Bridge
npm run dev                  # 开发模式 (文件监听)
npm test                     # 运行测试
npm run pm2:start            # PM2 生产启动
npm run pm2:stop             # PM2 停止
npm run pm2:status           # PM2 状态

# === Flutter 客户端 ===
cd openchat-flutter

flutter pub get              # 安装依赖
flutter run                  # 启动调试
flutter build apk            # 构建 Android APK
flutter build ios            # 构建 iOS
flutter test                 # 运行测试

# === 单模块发布 ===
cd modules/fairy-guardian
npm publish
```

## 代码规范

### JavaScript/Node.js
- **模块系统**: ESM (`import`/`export`)，禁止混用 CJS
- **缩进**: 2 空格
- **字符串**: 单引号优先
- **分号**: 必须
- **命名**: camelCase 变量/函数，PascalCase 类
- **错误处理**: 禁止空 catch 块，必须记录日志
- **文件操作**: 统一使用 `fs/promises` 异步 API

### Dart/Flutter
- 遵循 `flutter_lints` 推荐规则
- 使用 Riverpod 进行状态管理
- Widget 文件名 = 类名 (snake_case)
- 模型类使用 freezed + json_serializable

### Git
- 提交前自动运行 husky pre-commit hook
- Commit message 格式: `type: description` (feat/fix/chore/refactor/docs)
- 禁止提交 `.env` 文件（已在 .gitignore）

---

## 专家点评系统

### 触发词
`叫全部专家` / `叫所有专家` / `呼叫专家点评` / `专家点评` / `专家意见` / `call all experts` / `expert review`

### 流程（严格遵循）

1. **生成项目摘要** — 基于当前会话上下文写一段 ~300 字摘要，涵盖：核心能力 / 模块状态 / 近期变更 / 已知问题。摘要**不贴源码**，只写结论。
2. **启动 1 个 task** — 使用 `general` 子 agent，嵌入摘要 + 14 角色定义 + 用户问题。
3. **约束**：只能调 **1 次 task**，禁止 12 次并行。摘要写在 prompt 里，不额外传文件。

### Task Prompt 模板

```
你是一个专家角色扮演 agent。请依次扮演以下 14 个角色，给出点评。

## 项目摘要
{摘要}

## 用户问题
{用户的问题，如果没有则默认为"点评项目现状"}

## 角色列表
1. 核心工程师 — 代码质量、架构、技术债
2. 产品经理 — 用户价值、产品方向
3. 独立开发者 — 会不会用
4. VC / 投资人 — 值不值得投
5. 开源社区经理 — 新人能不能上手
6. Flutter 开发者 — 移动端好不好接
7. SRE / 运维 — 能不能上线
8. 安全研究员 — 有没有洞
9. AI 研究员 — agent loop 质量
10. 用户支持 — 用户卡在哪
11. 技术写手 — 文档好不好写
12. 竞品分析师 — 市场定位
13. **Git 专家** — commit 质量、分支管理、历史整洁度、回滚安全
14. **技术经理（最后出场）** — 汇总以上 13 位专家意见，给出 P0-P2 分级的可执行任务清单

## 规则
- 1-13 号角色：每个只说 2-3 句话，只点评、批判、指出问题。
- 14 号角色（技术经理）：最后出场，基于前面 13 位的意见，输出 3-5 条按优先级排序的可执行建议。每条建议包含：做什么 + 为什么 + 预估工作量（天）。
  - **P0（红色🔴）**：不修就崩、有法律/安全风险
  - **P1（黄色🟡）**：不做就烂、拖累开发效率或用户留存
  - **P2（蓝色🔵）**：锦上添花、中长期优化
  - 技术经理是操刀写代码的人，每条建议必须体现对代码实现路径的理解，不说空话。
- 言辞必须苛刻、犀利、严谨。不讨好，不委婉。
- 如果某件事很烂，直接说很烂。你的工作是防止开发者浪费时间，不是让他们感觉良好。
- 总输出 ≤ 80 行。
```

### 摘要规范
写摘要时遵循：
- 只说事实，不说判断
- 每个模块标注状态：✅ 可用 / ⚠️ 半成品 / ❌ 死代码
- 列出上一个 sprint 的实际变更（文件数、行数变化）
- 列出当前已知的 blocking bug
