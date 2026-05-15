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
