# spec: RoomScreen（多人语音房间）

> 多人在线实时语音房间：每个参与者录音→上传 S3 共享目录，定时轮询所有参与者文件

## 数据流

```
加入房间
  → QiniuDirectClient(peerId).register()
  → AudioRecorder.startStream → _buffer → encode → putBinary(oc/rooms/{roomId}/{myPeerId}/{seq}.enc)

_audioTimer (pollMs)
  → listFiles(oc/rooms/{roomId}/) → 解析所有 peerId → 更新 _participants
  → 遍历非自身、非静音的参与者
      → getBinary(oc/rooms/{roomId}/{peerId}/{seq}.enc)
      → 只处理 seq > _playedSeqs[peerId]
      → processReceivedAudio → _playQueue.add(pcm)
  → _playNext() 消费 _playQueue → wav → audioplayers.play

离开房间
  → recordSub.cancel → recorder.dispose → player.dispose → processor.dispose
  → audioTimer.cancel → client.dispose → Navigator.pop
```

## 接口签名

```dart
class RoomScreen extends ConsumerStatefulWidget {
  final String roomId;
  const RoomScreen({required this.roomId});

  /// 构建流程：_initRoom → _startAudio → _audioTimer(_pollRoom)
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  QiniuDirectClient? _client;        // 注册的客户端
  AudioRecorder? _recorder;          // 录音
  AudioPlayer? _player;              // 播放
  LmdnProcessor? _processor;         // 编解码
  Timer? _audioTimer;                // 轮询定时器
  int _audioSeq = 0;                 // 自身上传序号
  bool _muted = false;               // 自身静音
  String _myPeerId = '';
  final Map<String, int> _playedSeqs = {};   // peerId → max seq played
  final Map<String, bool> _mutedPeers = {};  // peerId → muted
  final Set<String> _participants = {};      // discovered peers

  Future<void> _initRoom();          // 注册 client，启动 audio
  Future<void> _startAudio();        // 初始化 录音→上传 流
  Future<void> _pollRoom();          // listFiles → 下载→解码→playQueue
  Future<void> _playNext();          // 消费 playQueue
  void _leaveRoom();                 // 清理全部资源
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 房间只有自己 | _participants = {myPeerId}，UI 显示"等待其他人加入" |
| 新参与者中途加入 | 下次 poll 发现新 peerDir，状态更新，setState |
| 参与者离开 | 其 .enc 文件停止新增，_playedSeqs 停留在最后一个 seq |
| 自身静音 | 录音流收到 muted → _buffer.clear() 丢弃 PCM，不上传 |
| 静音他人 | _mutedPeers[peerId] = true → poll 跳过该参与者所有文件 |
| 网络断开恢复 | listFiles 空 → 下个周期重试；getBinary 失败 → try/catch |
| 房间 ID 为空 | roomId="default"（路由缺省值） |
| 大量参与者 | 每个 poll 遍历所有 peer → n 次 getBinary → 依次处理 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `room_screen.dart` | 全功能房间（UI + 录音 + 轮询 + 播放） | 200 |

> 注：当前为单文件，超过 200 行时应拆分为 `room_audio.dart` + `room_screen.dart`

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C15 | `[C15] room init\|processor\|mic\|stream\|upload\|error` | _startAudio | 注册 ok → 权限 ok → stream 启动 → 录音上传中 |
| C16 | `[C16] listFiles\|participants\|poll:\|error` | _pollRoom | `listFiles prefix=... count=N` → `participants updated` → `poll: fetched=N played=N` |
| C17 | `[C17] skip muted\|empty data` | _pollRoom | 对静音参与者显示 `skip muted peer=xxx` |

## 不变量 (invariants)

```
// === invariants ===
// - _playedSeqs 只增不减，同一 peer 的旧 seq 永不二次播放
// - _audioTimer 在 dispose() / _leaveRoom() 前必须 cancel
// - _participants 由 poll timer 更新，UI 线程只读
// - _mutedPeers 切换不影响正在播放的音频（只阻断后续轮询）
```
