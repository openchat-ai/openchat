# spec: VoiceRoomAudio (音频控制器)

> Voice Room 音频管理：录音/编码/上传/播放/解码。由 voice_room_screen 持有。

## 数据流

```
startAudio()
  → LmdnConfig.load() → 初始化 processor
  → AudioRecorder.startStream (pcm16 mono 24kHz)
  → stream.listen(chunk)
    → buffer 累积到 bufferBytes
    → crossfade with prevOverlap
    → processor.processMicrophoneInput (LMDN 编码)
    → localMode ? localQueue.add : client.sendEncodedAudio
    → callFrames.add (供 _saveEpc 归档)

audioTimer (pollMs 周期)
  → localMode ? 读 localQueue : client.pollEncodedAudio
  → processor.processReceivedAudio (LMDN 解码)
  → playQueue.add → playNext (FadeIn/Out + WAV wrap)
  → notes 累加 → setState
```

## 接口签名

```dart
class VoiceRoomAudio {
  AudioRecorder? recorder;
  AudioPlayer? player;
  LmdnProcessor? processor;
  StreamSubscription? recordSub;
  Timer? audioTimer;
  List<int> vmBuffer;
  bool vmRecording;
  final List<Uint8List> playQueue, localQueue, callFrames;
  final List notes;
  bool playing, muted, localMode;
  int audioSeq;
  LmdnConfig audioCfg;

  QiniuDirectClient? client;
  String? targetPeerId;
  String state;
  bool Function() isMounted;
  void Function(void Function()) setStateCb;

  Future<void> startAudio();
  Future<void> startVmRecord();
  Future<void> endVmRecord();
  Future<void> playNext();
  void dispose();
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 麦克风权限拒绝 | log [C2] mic denied, 静默返回 |
| 录音流返回 null | log [C3] stream null, 退出 |
| audioTimer != null 重复调用 | 守卫阻断 |
| 静音状态 | buffer.clear() 立即清空 |
| state != connected | 不处理音频帧 |
| playNext 队列空 | _playing=false, 等待下一帧 |
| WAV 头生成 | 24kHz/16bit/mono 标准 |
| 缓冲区空 | pollEncodedAudio 返回空 → 下一周期 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `voice_room_audio.dart` | 音频控制器 (录音/编码/播放/解码) | 280 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C2 | `[C2] processor\|mic` | startAudio | `processor init ok` → `mic perm ok` |
| C3 | `[C3] record stream` | startAudio | `record stream started` |
| C4 | `[C4] sent` | startAudio stream | `sent seq=N size=M` |
| C5 | `[C5] polled` | startAudio timer | `polled N chunks` |
| C6 | `[C6] decoded` | startAudio timer | `decoded N B` |
| C7 | `[C7] play` | playNext | `play N B` 或 `error: E` |
| C8 | `[C8] notes` | startAudio timer | `notes=N` |

## 不变量 (invariants)

```
// === invariants ===
// - audioTimer 单线程管理, dispose() 中必须 cancel
// - playQueue 单线程消费, dispose() 中清空
// - callFrames append-only, _saveEpc 后清空
// - processMicrophoneInput 必须在主 isolate 串行调用
// - audioSeq 在 connected 状态单调递增
// - localMode 切换不清空 playQueue (只清 localQueue)
// - 65536 用于 u16 → s16 转换 (无笔误)
```
