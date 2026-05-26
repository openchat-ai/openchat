# PeerTalk Flutter 客户端

> **最后更新**: 2026-05-26
> **要求**: Bridge 服务运行在 `localhost:3800`（`cd bridge && npm start`）
> **编译边界**: 改代码前先看 `docs/COMPILATION_BOUNDARY.md`，95% 的改动不应触发 APK 构建

## 快速开始

```bash
# 1. 启动 Bridge（新开终端）
cd ../bridge
npm install && npm start

# 2. 启动 Flutter 客户端（新开终端）
cd ../openchat-flutter
flutter pub get
flutter run
# App 自动连接 http://localhost:3800
```

## 测试

```bash
flutter test          # 单元测试
flutter analyze       # 静态分析（推送前必须通过）
flutter build apk     # 构建 APK（仅核心改动时需要）
```

## 项目概览

PeerTalk Flutter 是一个 **P2P 语音通话客户端**，通过 Bridge 信令服务实现设备间直连。所有 UI 文本和音频参数通过 Qiniu S3 JSON 文件远程配置，**无需重新编译**。

### 核心能力
- **P2P 语音呼叫**: 基于 Bridge WebSocket 信令的端到端通话
- **Qiniu 存储**: 语音录制文件上传（表单上传）→ S3 预签名下载/列目录/删除
- **远程配置**: `oc/config/*.json` 驱动 UI 文本、音频参数、主题
- **SDUI**: 联系人列表等页面通过 JSON 布局定义
- **音频编码**: 支持 raw/Opus/Neural 三种编码模式，通过 `audio.json` 切换

### Qiniu API 路线
| 操作 | 方式 | 端点 |
|------|------|------|
| 上传 | Qiniu 表单上传 + token | `upload-z0.qiniup.com` |
| 下载 | S3 V4 预签名 URL | `*.s3.qiniucs.com` |
| 列目录 | S3 V4 预签名 URL | `*.s3.qiniucs.com` |
| 删除 | S3 V4 预签名 URL | `*.s3.qiniucs.com` |

> ⚠️ 手机端不能访问 `rs.qbox.me` 管理 API，所有手机端操作必须走 S3 端点。

### 远程配置文件

| 配置文件 | 用途 | 无需编译 |
|----------|------|---------|
| `oc/config/ui_voice.json` | 通话界面文字、来电对话框 | ✅ |
| `oc/config/audio.json` | 音频参数（codec、fade、比特率） | ✅ |
| `oc/config/ui_people.json` | 联系人列表 SDUI | ✅ |
| `oc/config/global.json` | 全局功能开关 | ✅ |

添加新字段到上述 JSON 文件**不需要**修改 Dart 代码——`AudioConfig` 和 `VoiceUiConfig` 基于通用 `Map<String, dynamic>` 包装，任何 key 自动可访问。

### 目录结构

```
lib/
├── core/
│   ├── api/
│   │   ├── bridge_client.dart           # WebSocket 信令客户端
│   │   ├── qiniu_direct_client.dart     # Qiniu 存储（上传/下载/删除）
│   │   └── sdui_client.dart             # SDUI 配置拉取
│   ├── audio/
│   │   ├── audio_config.dart            # 远程音频参数（generic map wrapper）
│   │   ├── audio_engine.dart            # 录制/回放引擎
│   │   └── codec/                       # Opus / Neural codec 实现
│   ├── sdui_config.dart                 # SDUI 配置加载器
│   └── ui_voice_config.dart             # 通话界面文字（generic map wrapper）
├── ui/
│   ├── screens/
│   │   ├── people_screen.dart           # 联系人列表 + 来电
│   │   ├── voice_room_screen.dart       # 通话界面
│   │   └── settings_screen.dart         # 设置页
│   └── components/                      # 可复用组件
│       ├── app_card.dart
│       ├── listing.dart
│       └── ...
└── main.dart
```

## 关键流程

### P2P 语音通话
```
联系人列表 → 点击呼叫 → Bridge 信令通知对方
→ 对方收到来电（弹框，文字来自 ui_voice.json）
→ 接听 → 进入通话界面 → 语音录制 → Qiniu上传 → S3 URL → 对方下载播放
→ 挂断 → 清理资源
```

### 远程配置更新
```
开发者上传 JSON 到 Qiniu bucket → App 定时轮询 / 手动刷新
→ 通话界面文字、音频参数、SDUI 布局即时生效
→ 零编译、零发布
```

## 音频参数（远程控制）

所有参数在 `oc/config/audio.json` 中配置，无需修改 Dart 代码：

```json
{
  "codec": "opus",
  "bitrate": 24000,
  "fadeBytes": 1024,
  "demoDelayMs": 500,
  "opusFrameMs": 20,
  "maxDurationSeconds": 300
}
```

## 开发注意事项

1. **不改 Dart 修 UI 文字** — 编辑 `oc/config/ui_voice.json` 并上传即可
2. **不改 Dart 调音频** — 编辑 `oc/config/audio.json` 即可
3. **不改 Dart 改布局** — 试试 SDUI JSON
4. **推送前跑 `flutter analyze`** — CI 会检查，本地先过
5. **改动攒批** — Flutter 改动攒够 3-5 个再推送，减少用户安装次数
