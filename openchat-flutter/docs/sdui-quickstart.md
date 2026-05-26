# SDUI 快速入门 — 5 分钟改 UI

> 不编译、不重装 APK，只需编辑 JSON 文件上传到 Qiniu。

## 你能改什么

| 要改的东西 | 改哪个文件 | 举例 |
|-----------|-----------|------|
| 通话界面按钮颜色 | `ui_room_sdui.json` | 改 `"color": "#4CAF50"` |
| 按钮大小 | `ui_room_sdui.json` | 改 `"size": 64` |
| 按钮图标 | `ui_room_sdui.json` | 改 `"icon": "mic_off"` |
| 状态文字 | `ui_voice.json` | 改 `"callingText"` |
| 连接标签 | `ui_voice.json` | 改 `"mutedLabel"` |
| 音频编码模式 | `audio.json` | 改 `"mode": "opus"` |
| 淡入淡出长度 | `audio.json` | 改 `"fadeBytes": 480` |
| 联系人列表布局 | `ui_people.json` | SDUI JSON 任意修改 |

## 改颜色

1. 下载 `oc/config/ui_room_sdui.json` 到本地
2. 找你想改的按钮，比如红色的挂断按钮：
   ```json
   {"type": "button", "icon": "call_end", "action": "hangup", "color": "#F44336", "size": 72}
   ```
3. 把 `"#F44336"` 改成你想用的颜色（Hex 格式，如 `#2196F3` 蓝色）
4. 上传回 Qiniu

## 改按钮

已有 action（不需要改 Dart）：
- `hangup` — 挂断
- `toggle_mute` — 静音切换
- `accept_call` — 接听

### 注册新 action（不需要改 switch）

`voice_room_screen.dart` 的 `_customActions` map 支持注册新 action，无需改 `_handleAction` 的 switch：

```dart
// 在 initState 或任何地方注册：
_customActions['toggle_speaker'] = () {
  // 你的新 action 逻辑
  _setSpeakerphone(!_speakerOn);
};
```

然后在 JSON 中用：
```json
{"type": "button", "icon": "volume_up", "action": "toggle_speaker"}
```

**限制**：action 逻辑本身仍需 Dart 代码（无法避免），但注册不需要改 switch-case 结构。

## 完整参考

### 支持的颜色
Hex 格式：`#RRGGBB`。常见值：
- `#F44336` 红
- `#2196F3` 蓝
- `#4CAF50` 绿
- `#FF9800` 橙
- `#9E9E9E` 灰
- `#FFFFFF` 白

### 支持的图标
`call`, `call_end`, `mic`, `mic_off`, `phone`, `close`, `check`, `person`, `refresh`, `settings`, `info`, `warning`, `error`, `favorite`, `share`, `menu`

### 按钮属性
| 属性 | 类型 | 说明 |
|------|------|------|
| `type` | `"button"` | 固定值 |
| `icon` | 字符串 | 图标名（图标表） |
| `iconSize` | 数字 | 图标像素大小 |
| `size` | 数字 | 按钮宽高（正方形） |
| `color` | 字符串 | Hex 背景色 |
| `textColor` | 字符串 | Hex 图标色 |
| `action` | 字符串 | 动作名（见上） |
| `pad` | 数字 | 外边距 |
