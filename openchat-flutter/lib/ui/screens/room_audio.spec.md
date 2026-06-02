# spec: RoomAudio (多人房间音频)

> 多人语音房间音频管理：录制 + 跨参与者解码 + 播放队列。

## 数据流

```
_startAudio()
  → AudioRecorder.startStream
  → stream.listen(chunk)
    → buffer 累积到 bufSize
    → processor.processMicrophoneInput
    → client.sendEncodedAudio (oc/rooms/{roomId}/{myPeerId}/{seq}.enc)
    → _callFrames.add

_audioTimer (pollMs 周期)
  → client.listFiles(oc/rooms/{roomId}/)
  → 解析所有 peerId → _participants 更新
  → 遍历非自身、非静音的参与者
    → getBinary(oc/rooms/{roomId}/{peerId}/{seq}.enc)
    → 只处理 seq > _playedSeqs[peerId]
    → processReceivedAudio → _playQueue.add
  → _playNext 消费 _playQueue → audioplayers.play
```

## 接口签名

```dart
class RoomAudio {
  AudioRecorder? recorder;
  AudioPlayer? player;
  LmdnProcessor? processor;
  Timer? audioTimer;
  StreamSubscription? recordSub;
  int audioSeq;
  bool muted;
  final Map<String, int> playedSeqs;
  final Map<String, bool> mutedPeers;
  final Set<String> participants;
  final List<Uint8List> playQueue, callFrames;

  QiniuDirectClient? client;
  String? roomId, myPeerId;
  LmdnConfig audioCfg;

  Future<void> startAudio();
  Future<void> pollRoom();
  Future<void> playNext();
  Future<void> endCall();
  void dispose();
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 房间只有自己 | participants = {myPeerId} |
| 新参与者中途加入 | 下次 poll 发现新 peerDir |
| 参与者离开 | 帧停止新增, _playedSeqs 停留在最后 seq |
| 自身静音 | 录音流 muted → buffer.clear() 丢弃 |
| 静音他人 | _mutedPeers[peerId] = true → poll 跳过 |
| 网络断开恢复 | listFiles 空 → 下周期重试 |
| seq 倒回 (重连) | _playedSeqs 守卫, 不会重放 |
| _playQueue 累积 | 串行消费, 不会丢帧 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `room_audio.dart` | 多人房间音频控制器 | 200 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C15 | `[C15] room init\|processor\|mic\|stream\|upload` | startAudio | 注册→权限→stream→上传 |
| C16 | `[C16] listFiles\|participants\|poll:` | pollRoom | `listFiles prefix=... count=N` |
| C17 | `[C17] skip muted` | pollRoom | `skip muted peer=xxx` |

## 不变量 (invariants)

```
// === invariants ===
// - _playedSeqs 只增不减, 旧 seq 永不二次播放
// - _audioTimer 在 dispose() / endCall() 前必须 cancel
// - _participants 由 poll timer 更新, UI 线程只读
// - _mutedPeers 切换不影响正在播放的音频
// - callFrames.append-only, endCall 后清空
// - playQueue 单线程消费, dispose 清空
```
