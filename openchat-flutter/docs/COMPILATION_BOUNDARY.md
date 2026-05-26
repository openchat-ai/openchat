# 编译边界

> **核心原则**: 95% 的日常改动不应触发 Flutter 重新编译（APK 构建）。

## 决策树

```
需要改动 → 问第一个问题：
┌─────────────────────────────┐
│ 改的是 Qiniu JSON 数据文件？ │
│ (oc/config/*.json)          │
└─────────────┬───────────────┘
       YES    │    NO
       ↓      │    ↓
   无需编译   ┌─────────────────────────────┐
   直接上传   │ 改的是 Bridge (Node.js)？    │
             └─────────────┬───────────────┘
                    YES    │    NO
                    ↓      │    ↓
                无需编译   ┌─────────────────────────────┐
                git push   │ 改的是 Flutter 侧？         │
                bridge CI  └─────────────┬───────────────┘
                                   YES    │    NO
                                   ↓      │    ↓
                           ┌───────────────────────────┐
                           │ 是纯数据层（config 类/    │
                           │ constants/API URL）？     │
                           └─────────────┬─────────────┘
                                   YES    │    NO
                                   ↓      │    ↓
                               无需编译   ┌───────────────────────────┐
                               改 JSON    │ 涉及原生代码：            │
                               文件即可   │ - 新 codec                │
                                          │ - 新 native widget        │
                                          │ - 新 package 依赖         │
                                          │ - NDK/Gradle 配置         │
                                          └─────────────┬─────────────┘
                                                   YES    │    NO
                                                   ↓      │    ↓
                                               需要编译   ┌───────────────────────────┐
                                               构建 APK  │ 纯 Dart 逻辑：            │
                                                         │ - UI 调整                 │
                                                         │ - 信号流程                │
                                                         │ - 动画                    │
                                                         └─────────────┬─────────────┘
                                                                  需要编译
                                                                  构建 APK
```

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
