# 编译边界

> **核心原则**: 约 85% 的日常改动不触发 Flutter 重新编译。仍会触发 APK 的场景见下方"仍需 APK 的常见场景"。

## 决策树

```
需要改动 → 问第一个问题：
┌─────────────────────────────┐
│ 改的是 Qiniu JSON 数据文件？ │
│ (oc/config/*.json)          │
└─────────────┬───────────────┘
       YES    │    NO
       ↓      │    ↓
   可选编译   ┌─────────────────────────────┐
   改 JSON+   │ 改的是 Bridge (Node.js)？    │
   上传即用   └─────────────┬───────────────┘
                     YES    │    NO
                     ↓      │    ↓
                 无需编译   ┌─────────────────────────────┐
                 git push   │ 改的是 Flutter 侧？         │
                 bridge CI  └─────────────┬───────────────┘
                                    YES    │    NO
                                    ↓      │    ↓
                            ┌───────────────────────────┐
                            │ 是纯 SDUI JSON 数据？      │
                            │ (ui_room_sdui/ui_voice/   │
                            │  audio/global 等)         │
                            └─────────────┬─────────────┘
                                    YES    │    NO
                                    ↓      │    ↓
                                可选编译   ┌───────────────────────────┐
                                改 JSON    │ 涉及以下任一：            │
                                上传即用   │ - 新 codec                │
                                           │ - 新 package 依赖         │
                                           │ - AK/SK 凭证轮转          │
                                           │ - Qiniu endpoint/region   │
                                           │ - 新业务 action (Dart)    │
                                           │ - NDK/Gradle 配置         │
                                           └─────────────┬─────────────┘
                                                    YES    │    NO
                                                    ↓      │    ↓
                                                需要编译   ┌───────────────────┐
                                                构建 APK  │ 现有 action 的 UI │
                                                          │ 调整（按钮/布局/  │
                                                          │ 颜色/图标）→      │
                                                          │ 改 JSON 即可      │
                                                          └───────────────────┘
```

## 无需编译的改动（远程配置）

| 文件路径 | 用途 | 改后动作 |
|----------|------|---------|
| `oc/config/ui_voice.json` | 通话界面的所有文本 | 上传到 Qiniu |
| `oc/config/audio.json` | 音频参数（codec、fadeBytes、比特率等） | 上传到 Qiniu |
| `oc/config/ui_people.json` | 联系人列表 SDUI 配置 | 上传到 Qiniu |
| `oc/config/ui_room_sdui.json` | 通话室界面布局（按钮大小/颜色/图标/布局结构） | 上传到 Qiniu |
| `oc/config/global.json` | 全局开关/调试参数 | 上传到 Qiniu |
| `oc/debug/{peerId}/*.cmd` | 调试命令触发 | 写文件到 Qiniu |
| Bridge 侧代码 (`bridge/src/`) | 信令服务、API 端点 | 仅重启 PM2 |
| 本文档或 AGENTS.md | 开发指南 | 直接 git push |

## 仍需 APK 的常见场景

以下场景**当前仍需编译**，因为它们涉及 Dart 代码修改：

| 场景 | 原因 | 未来可远程化？ |
|------|------|---------------|
| **新业务 action**（如扬声器切换、录音） | `_handleAction` 的 switch case 在 Dart 里 | 部分：`_customActions` map 已支持注册新 action，但 action 逻辑本身仍需 Dart |
| **修 crash** | 异常处理在 Dart 代码里 | 远程日志可诊断，修复仍需 APK |
| **AK/SK 凭证轮转** | 凭证用 charCodes 埋在 Dart 中 | 需要 Bridge 端签名代理 |
| **Qiniu endpoint/region 变更** | `static const` 硬编码在 Dart 中 | 需要运行时配置读取 |
| **加新 publih package** | `pubspec.yaml` | 不可远程化 |
| **升级 Flutter SDK / Gradle** | 原生构建配置 | 不可远程化 |

## 通用规则

1. **SDUI 优先** — 任何 UI/文本/行为变更先问能否用 JSON 数据文件实现
2. **Bridge 优先** — 逻辑变更能在 bridge 侧做的，不要动 Dart
3. **`_customActions` map** — 新业务 action 可通过 `voice_room_screen.dart` 中 `_customActions` map 注册，无需改 `_handleAction` 的 switch
4. **推送前跑 `flutter analyze`** — 确保无编译错误

> ⚠️ CI 配置：`build_apk` 默认 `false`。Flutter 文件推送触发 `flutter-check`（analyze-only）。APK 构建需主动勾选或满足特定路径条件。

## 验证清单

改代码推前：
- [ ] 能否用 JSON 配置实现？
- [ ] 能否用 Bridge 端实现？
- [ ] 能否用调试通道实现？
- [ ] 如需编译 → 确认属于上方"仍需 APK 的场景"
- [ ] 改 SDUI JSON 后是否已上传到 Qiniu bucket？
- [ ] 新 action 能否通过 `_customActions` 注册而非改 switch？

## 无需编译的改动（远程配置）

| 文件路径 | 用途 | 改后动作 |
|----------|------|---------|
| `oc/config/ui_voice.json` | 通话界面的所有文本（Calling/Connected/MUTED、来电对话框） | 上传到 Qiniu |
| `oc/config/audio.json` | 音频参数（codec、fadeBytes、demoDelayMs、比特率） | 上传到 Qiniu |
| `oc/config/ui_people.json` | 联系人列表 SDUI 配置 | 上传到 Qiniu |
| `oc/config/ui_room_sdui.json` | 通话室界面布局（SDUI JSON，控制每个状态的 widget 树） | 上传到 Qiniu |
| `oc/config/global.json` | 全局开关/调试参数 | 上传到 Qiniu |
| `oc/debug/{peerId}/*.cmd` | 调试命令触发 | 写文件到 Qiniu |
| Bridge 侧代码 (`bridge/src/`) | 信令服务、API 端点 | 仅重启 PM2 |
| 本文档或 AGENTS.md | 开发指南 | 直接 git push |

## 需要编译的改动

- 新增 codec（原生库集成）
- 新增平台通道（MethodChannel）
- 升级 Flutter SDK / Dart SDK
- 新增 package 依赖（`pubspec.yaml`）
- Android `build.gradle` / `gradle.properties` 变更
- iOS Podfile / Xcode 配置变更

## 通用规则

1. **SDUI 优先** — 任何 UI/文本/行为变更先问能否用 JSON 数据文件实现
2. **Bridge 优先** — 逻辑变更能在 bridge 侧做的，不要动 Dart
3. **3-5 个 Flutter 改动攒一批再推送** — 减少用户安装次数
4. **推送前跑 `flutter analyze`** — 确保无编译错误

> ⚠️ CI 配置 `paths-ignore: ['docs/**', '**.md']`，文档改动不会触发任何 CI 任务。改文档后手动触发检查，或同步改一行代码触发 CI。

## 验证清单

改完代码推前：
- [ ] 能否用 JSON 配置实现？
- [ ] 能否用 Bridge 端实现？
- [ ] 能否用调试通道实现？
- [ ] 如果都需编译 → 攒够 3-5 个改动再推送
- [ ] 改 SDUI JSON 后是否已上传到 Qiniu bucket？
