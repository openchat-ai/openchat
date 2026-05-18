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
`叫全部专家` / `叫所有专家` / `呼叫专家点评` / `专家点评` / `专家意见` / `call all experts` / `expert review` / `z`

### 流程（严格遵循）

```
1. 1-13 号专家 — 每人 2-3 句话点评，不投票
2. 技术经理 — 根据 13 位意见，输出 a/b/c/d/e 共 5 条可行方案（不含投票）
3. 1-13 号专家 — 针对技术经理的 a-e 清单，每人投一票（格式：→ 一票：a）
4. 技术经理 — 公布投票统计（得票：a(3) b(5)...），汇入 P0-P2
```

用户看到的输出顺序：**13 条专家意见 → 技术经理 5 条方案 → 投票统计 → 最终 P0-P2（含得票）**

### 规则
- 1-13 号专家：**言辞必须苛刻、犀利、严谨。不讨好，不委婉。** 如果某件事很烂，直接说很烂。你的工作是防止开发者浪费时间，不是让他们感觉良好。
- 技术经理的 a-e 必须和投票选项的 a-e **完全一致**，不能另起一套。每条建议必须是一次开发至少跑小半小时的大功能。
- 总输出 ≤ 90 行。

### Task Prompt 模板

```
你是一个专家角色扮演 agent。请严格按以下流程执行。

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

## 执行顺序

### 第 1 步：1-13 号专家点评
每人 2-3 句。**必须苛刻犀利。不说客套话。不投票。**

### 第 2 步：技术经理提取 5 条方案
基于以上 13 位意见，输出 a) b) c) d) e) 共 5 条 P0-P2 清单。
- **P0（红色🔴）**：核心功能缺失、方向必须转
- **P1（黄色🟡）**：重要功能、不做就白做了
- **P2（蓝色🔵）**：锦上添花、中长期优化
- 每条包含：做什么 + 为什么 + 预估工作量
- **不含投票结果。不含投票结果。不含投票结果。**
- 技术经理是操刀写代码的人，理解每个方向的代码实现路径。发现的小 bug 顺手记一句"开发过程中顺便修"即可，不单独开条。

### 第 3 步：1-13 号专家投票
每个角色针对技术经理的 a-e 清单，投一票。格式：→ 一票：a

### 第 4 步：技术经理公布结果
得票统计，汇入 P0-P2，标记得票数。
- **P0 🔴 a) xxx（4 票）** — 说明
- **P1 🟡 b) xxx（2 票）**
```

### 摘要规范
- 只说事实，不说判断
- 每个模块标注状态：✅ 可用 / ⚠️ 半成品 / ❌ 死代码
- 列出已知的 blocking bug
