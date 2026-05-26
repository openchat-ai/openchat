# 编译边界 — 什么需要 APK 重建

> 目标：95% 的日常改动不触发 Flutter APK 构建。
> 只有以下模块改动时才需要编译→安装。

## 必须编译（Flutter 内核）

| 模块 | 说明 | 典型改动 |
|------|------|---------|
| `pubspec.yaml` | 新增/移除 native 依赖 | 加新 package、改平台配置 |
| `lib/core/audio/` | 编解码器实现 | 新 codec 接入、音频管线修改 |
| `lib/core/api/signaling.dart` | 信令协议 | 添加新信令类型、修改 poll 协议 |
| `lib/core/api/qiniu_direct_client.dart` | 网络层核心 | 鉴权方式、HTTP 客户端替换 |
| `lib/main.dart` | 应用入口 | 路由、初始化流程 |
| `android/` `ios/` | 原生平台代码 | 权限、NDK、Gradle 配置 |
| native bridge 代码 | FFI / MethodChannel | 新增原生功能调用 |

## 可远程修改（不触发 APK 重建）

| 方式 | 覆盖范围 | 文件/入口 |
|------|---------|----------|
| **SDUI JSON** | UI 布局、按钮文字、颜色、图标 | `oc/config/ui_people.json` 等 |
| **音频参数** | bufferMs、pollMs、codec、降噪、采样率 | `oc/config/audio.json` |
| **全局配置** | Qiniu 后端选择（putS3/getS3等）、pollInterval | `oc/config/global.json` + 个人 `oc/config/{peerId}.json` |
| **Debug 通道** | ping/diag/list_users/switch_backend/exec | `oc/debug/{peerId}/{cmd}.cmd` |
| **file:write** | 写入 `oc/config/`, `oc/debug/`, `oc/logs/` 文件 | SDUI action `file:write?key=...&value=...` |

## 改代码前的决策树

```
有改动需求
 → 是 UI/布局/文字/颜色/图标 变化？ → 改 SDUI JSON（Qiniu oc/config/）
 → 是音频参数（buffer/codec/采样率）？ → 改 oc/config/audio.json
 → 是 Qiniu 后端切换？ → 改 oc/config/global.json
 → 是测试/诊断命令？ → 写 oc/debug/{peerId}/{cmd}.cmd
 → 是信令协议/网络层/codec 实现？ → 改 Dart 代码 → APK 重建
```

## 新增功能评估清单

在决定改 Dart 代码前，逐条确认：

- [ ] 能否用现有 SDUI 组件（column/row/list_tile/button/text）组合出该 UI？
- [ ] 能否通过 `oc/config/audio.json` 参数调整实现？
- [ ] 能否通过 debug 通道临时运行？
- [ ] 能否用 `file:write` 在 Qiniu 上创建/修改文件实现？
- [ ] 这个功能的用户价值是否值得一次 APK 安装成本？
