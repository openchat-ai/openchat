# spec: VoiceRoomScreen (1-on-1 语音通话)

> P2P 语音通话主屏：信令 + 音频录制/播放 + SDUI 渲染。
> 单文件 644 行，需按 R6 拆分为多文件（信令/音频/UI）。

## 数据流

```
启动 (initState)
  → 解析路由参数 (targetPeerId/client/selfTest)
  → VoiceUiConfig.load() (异步)
  → _initSelfTest() 或 _signalTimer 启动 (2s 周期轮询)

用户操作 _acceptCall() / _endCall() / mode 切换
  → 状态机: calling → connected → ended

_startAudio() (已 connected)
  → 麦克风权限请求 (C2)
  → AudioRecorder.startStream (C3)
  → 流监听: _buffer += chunk → 每 bufferBytes 处理一帧
    → crossfade 与 _prevOverlap
    → LmdnProcessor.processMicrophoneInput → encoded
    → 模式分支:
      _localMode = true  → _localQueue.add()  (本地回环)
      _localMode = false → _client.sendEncodedAudio()  (S3 上传)
    → _callFrames.add(encoded) (供 _saveEpc 归档)
  → _audioTimer (pollMs 周期)
    → _localMode ? 读 _localQueue : _client.pollEncodedAudio()
    → LmdnProcessor.processReceivedAudio → PCM + notes
    → _playQueue.add → _playNext() 消费 → audioplayers.play
    → notes 累加到 _allNotes → 五线谱渲染

_endCall() → _saveEpc() → 上传 .epc → Navigator.pop
```

## 接口签名

```dart
class VoiceRoomScreen extends ConsumerStatefulWidget with SduiPageState {
  const VoiceRoomScreen({super.key});
  // 路由参数: targetPeerId (String?), client (QiniuDirectClient?), selfTest ('true'|null)
}

class _VoiceRoomScreenState extends ConsumerState<VoiceRoomScreen> {
  // 状态机
  String _state = 'calling';  // 'calling' | 'connected' | 'ended'
  bool _muted = false;        // 自身静音
  bool _localMode = true;     // true=本地回环, false=S3 中继
  bool _vmMode = false;       // 语音消息录制模式

  // 组件
  QiniuDirectClient? _client;
  AudioRecorder? _recorder;
  AudioPlayer? _player;
  LmdnProcessor? _processor;
  LmdnConfig _audioCfg = const LmdnConfig();
  VoiceUiConfig _uiVoice = const VoiceUiConfig();

  // 缓冲
  final List<Uint8List> _playQueue = [];   // 待播放 PCM
  final List<Uint8List> _localQueue = [];  // 本地回环缓冲
  final List<Uint8List> _callFrames = [];  // 整通通话 LMDN 帧 (EPC 归档)
  final List<ScoreNote> _allNotes = [];    // 累积乐谱
  final List<int> _vmBuffer = [];          // 语音消息 PCM 缓冲

  // 定时器
  Timer? _signalTimer;   // 2s 周期：轮询 call-accept/end
  Timer? _audioTimer;    // pollMs 周期：拉取/解码/播放
  StreamSubscription? _recordSub;

  // 内部方法
  Future<void> _initSelfTest();
  Future<void> _pollResponse();
  void _acceptCall();
  void _endCall();
  Future<void> _saveEpc();
  Future<void> _startAudio();
  Future<void> _startVmRecord();
  Future<void> _endVmRecord();
  Future<void> _playNext();
  void _handleAction(String action);
  Widget build(BuildContext context);
  Widget _ctrlBtn(IconData, Color, VoidCallback, {bool big, String? label});
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 麦克风权限拒绝 | _startAudio 静默返回 (log [C2] mic denied) |
| 录音流返回 null | _audioStarted=false, 退出 |
| 已 _audioStarted 重复调用 | 静默返回 (guard) |
| 静音状态 | _buffer.clear(), 不上传 |
| _state != connected | 不处理音频帧 |
| 通话已结束重复调用 _endCall | _ended 守卫, 静默 |
| _callFrames 为空 | _saveEpc 立即返回 |
| 切换 _localMode | 下一周期生效, _localQueue 立即清空 |
| 切换 _muted | 下一帧生效 (实时) |
| selfTest 模式 | 跳过 _pollResponse, 自动注册 + 自身回环 |
| pollEncodedAudio 失败 | catch 后继续下个周期 |
| EPC 上传失败 | catch 后仅日志, 不影响 UI 关闭 |

## 文件清单

| 文件 | 职责 | 行数上限 | 实际行数 |
|------|------|---------|---------|
| `voice_room_screen.dart` | 主屏 + 状态机 + 信令轮询 + EPC 归档 | 200 | 317 ⚠️ |
| `voice_room_audio.dart` | 录音/编码/播放/解码 (VoiceRoomAudio 控制器) | 200 | 271 ⚠️ |
| `voice_room_widgets.dart` | UI 控件 (CtrlBtn/ModeSelect/VmScreen) | 200 | 168 ✅ |

> ✅ 已拆 2 轮：644 → 317 + 271 + 168 = 756（净 +112 行因类边界/字段绑定）。
> ⚠️ screen 和 audio 仍超 200 行限制 (R1)，单职责清晰但未达 R1 行数要求。
> 后续可拆：voice_room_signaling.dart (信令+生命周期)、voice_room_audio 小方法抽离。

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C1 | `[C1] registered` | _initSelfTest | `C1 registered peer=X` |
| C2 | `[C2] processor init\|mic perm\|mic denied` | _startAudio | `C2 processor init ok` → `C2 mic perm ok` |
| C3 | `[C3] record stream started\|stream null` | _startAudio | `C3 record stream started` |
| C4 | `[C4] sent` | _startAudio stream | `C4 sent seq=N size=M` |
| C5 | `[C5] polled` | _startAudio timer | `C5 polled N chunks` |
| C6 | `[C6] decoded` | _startAudio timer | `C6 decoded N B` |
| C7 | (audio pipeline) | audio_pipeline | (见 audio_pipeline.spec.md) |
| C8 | `[C8] notes` | _startAudio timer | `C8 notes=N` |
| C9 | (qiniu) | qiniu | (见 qiniu spec) |

## 不变量 (invariants)

```
// === invariants ===
// - 状态机单向: calling → connected → ended, 不允许逆向
// - _ended 是单调的, 只能从 false→true, 防止 timer+button 重复触发
// - _audioStarted 守卫防止并发 _startAudio
// - _buffer 跨回调, 必须在主 isolate 串行访问
// - _audioTimer 在 _endCall 中必须 cancel (R2 资源释放)
// - _localQueue/_playQueue 单线程, dispose 时清空
// - _callFrames.append-only, _saveEpc 后清空
// - _pollMs 必须 < bufferBytes / (sampleRate*2) 否则丢帧
// - mode 切换 (_localMode/_muted) 立即生效, 无需重启音频
```
