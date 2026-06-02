# spec: VoiceRoomWidgets (UI 控件)

> Voice Room UI 控件：按钮 + 模式选择屏 + 语音消息屏。

## 数据流

```
build()
  → VoiceRoomModeSelect / VoiceRoomVmScreen / Default UI
  → VoiceRoomCtrlBtn 复用 (icon + color + onTap)

VoiceRoomModeSelect
  → 显示 2 个 CtrlBtn (实时通话 / 语音消息)
  → 回调 _onStartCall / _onStartVoiceMsg

VoiceRoomVmScreen
  → 显示 mic icon + 按住说话提示
  → Listener (onPointerDown/Up/Cancel)
  → 回调 _onPointerDown / _onPointerUp / _onBack
```

## 接口签名

```dart
class VoiceRoomCtrlBtn extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final bool big;
  final String? label;
}

class VoiceRoomModeSelect extends StatelessWidget {
  final AppTheme theme;
  final VoidCallback onStartCall;
  final VoidCallback onStartVoiceMsg;
}

class VoiceRoomVmScreen extends StatelessWidget {
  final AppTheme theme;
  final bool recording;
  final VoidCallback onPointerDown, onPointerUp, onBack;
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| label 为 null | 显示纯按钮 (无文字) |
| label 非 null | 显示按钮 + 文字 |
| onPointerCancel | 同 onPointerUp (录制结束) |
| big=true | 72x72 + 24 radius + 32 icon |
| big=false | 56x56 + 18 radius + 24 icon |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `voice_room_widgets.dart` | CtrlBtn + ModeSelect + VmScreen | 200 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| (无业务逻辑, 无检查点) |

## 不变量 (invariants)

```
// === invariants ===
// - StatelessWidget 不持有状态
// - 所有交互通过 VoidCallback 回调, 不持有 screen 引用
// - theme 必须非 null (构造时验证)
// - big 模式只影响尺寸, 不影响点击行为
```
