# spec: VoiceRoomScreen (1-on-1 语音通话)

> P2P 语音通话主屏：信令 + SDUI 渲染，音频逻辑已拆分至 VoiceRoomAudio。

## 数据流

```
启动 (initState)
  → 解析路由参数 (targetPeerId/client/selfTest)
  → 创建 VoiceRoomAudio 实例
  → VoiceUiConfig.load() (异步)
  → _initSelfTest() 或 _signalTimer 启动 (2s 周期轮询)

用户操作 _acceptCall()
  → 发送 call-accept 信令
  → _audio.state = 'connected'
  → _audio.startAudio() → 委托 VoiceRoomAudio

终操作 _endCall() / _handleAction()
  → _saveEpc() → 上传 .epc
  → _audio.localQueue.clear()
  → Navigator.pop

build()
  → SDUI layout 渲染（状态文本/按钮/五线谱）
  → 或 _buildDefaultUI() 回退
```

## 接口签名

```dart
class VoiceRoomScreen extends ConsumerStatefulWidget with SduiPageState {
  const VoiceRoomScreen({super.key});
}

class _VoiceRoomScreenState extends ConsumerState<VoiceRoomScreen> {
  String _state = 'calling';  // 'calling' | 'ringing' | 'connected' | 'ended' | 'voiceMessage'
  bool _muted = false;
  bool _isSelfTest = false;
  bool _vmMode = false;
  bool _ended = false;
  final List<ScoreNote> _allNotes = [];
  final VoiceRoomAudio _audio = VoiceRoomAudio();  // 拆分至 voice_room_audio.dart

  QiniuDirectClient? _client;
  String? _targetPeerId;
  Timer? _signalTimer;
  VoiceUiConfig _uiVoice = const VoiceUiConfig();

  void _acceptCall();
  void _endCall();
  Future<void> _saveEpc();
  void _startVmRecord();
  void _endVmRecord();
  void _handleAction(String action);
  Widget _buildDefaultUI(AppTheme, String stateText, String statusLabel);
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 麦克风权限拒绝 | VoiceRoomAudio 静默返回 (log [C2]) |
| 已 _ended 重复调用 _endCall | _ended 守卫, 静默 |
| _callFrames 为空 | _saveEpc 立即返回 |
| selfTest 模式 | 跳过 _pollResponse, 自动注册 + 自身回环 |
| pollIncoming 失败 | catch 后继续下个周期 |
| EPC 上传失败 | catch 后仅日志, 不影响 UI 关闭 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `voice_room_screen.dart` | 主屏 + 状态机 + 信令轮询 + EPC 归档 | 200 |
| `voice_room_audio.dart` | 录音/编码/播放/解码 (VoiceRoomAudio) | 200 |
| `voice_room_widgets.dart` | UI 控件 (CtrlBtn/ModeSelect/VmScreen) | 200 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C1 | `[C1] registered` | _initSelfTest / initState | `C1 registered peer=X` 或 `C1 target=X` |
| C2 | `[C2] processor init\|mic perm\|mic denied` | VoiceRoomAudio.startAudio | `[C2] processor init ok` |
| C3 | `[C3] record stream started\|stream null` | VoiceRoomAudio.startAudio | `[C3] record stream started` |
| C4 | `[C4] sent seq=\|local enc` | VoiceRoomAudio stream listen | `[C4] sent seq=N size=M` |
| C5 | `[C5] polled\|local` | VoiceRoomAudio timer | `[C5] polled N chunks` |
| C6 | `[C6] decoded` | VoiceRoomAudio timer | `[C6] decoded N B` |
| C7 | `[C7] play\|error` | VoiceRoomAudio.playNext | `[C7] play N B` |
| C8 | `[C8] notes` | VoiceRoomAudio timer | `[C8] notes=N` |
| C9 | `[C9] saved epc\|no frames\|error` | VoiceRoomScreen._saveEpc | `[C9] saved epc N B` |

## 不变量 (invariants)

```
// === invariants ===
// - 状态机单向: calling → connected → ended, 不允许逆向
// - _ended 是单调的, 只能从 false→true, 防止 timer+button 重复触发
// - VoiceRoomAudio 生命周期与 VoiceRoomScreen 一致, dispose 时一起释放
// - _signalTimer 在 dispose 中必须 cancel
// - _allNotes 只在 setState 前追加, 不并发修改
```
