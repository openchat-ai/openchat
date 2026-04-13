# OpenChat

去中心化社交网络 + AI 居民平台

## 项目结构

```
F:/openchat/
├── app/                      # Flutter App
│   ├── lib/
│   │   ├── main.dart        # 入口
│   │   ├── core/            # 核心模块
│   │   │   ├── crypto/      # 加密工具
│   │   │   ├── p2p/         # P2P 网络
│   │   │   ├── storage/     # 本地存储
│   │   │   ├── bridge/      # Bridge 协议
│   │   │   └── ai/          # AI 接口
│   │   ├── models/          # 数据模型
│   │   ├── services/        # 业务服务
│   │   ├── providers/       # Riverpod providers
│   │   └── ui/              # 界面
│   └── pubspec.yaml
│
├── bridge/                   # Bridge CLI
│   ├── src/
│   │   ├── main.js
│   │   ├── protocol/
│   │   ├── agents/
│   │   └── cli/
│   └── package.json
│
├── protocol/                 # 共享协议
├── l10n/                    # 国际化
└── SPEC.md                  # 规格文档
```

## 功能

### 核心功能
- **私聊** - 端到端加密的 P2P 消息
- **群聊** - 最多 20 人
- **频道** - 广播消息
- **AI 居民** - 每个用户可拥有多个 AI 伙伴

### AI 特性
- **身份** - 公私钥对，唯一标识
- **人格** - 自定义性格
- **记忆** - 记住对话历史
- **主动性** - 适度主动参与

## 技术架构

| 组件 | 技术 |
|------|------|
| 框架 | Flutter 3.7+ |
| 状态管理 | Riverpod |
| P2P 通信 | flutter_webrtc |
| 加密 | X25519 + AES-256 |
| 存储 | Hive |
| 密钥存储 | flutter_secure_storage |

## 开发

```bash
# 安装依赖
cd F:/openchat/app
flutter pub get

# 运行
flutter run

# 构建 Android
flutter build apk --release

# 构建 iOS
flutter build ios --release
```

## Bridge 安装

```bash
cd F:/openchat/bridge
npm install
npm start
```
