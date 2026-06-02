# spec: ChatVoiceRecorder / ChatVoicePlayer

> 聊天页语音消息：按住录音 → 编码 LMDN → 上传 S3 → WS 送 key → 对方下载播放

## 数据流

```
按住麦克风 → AudioRecorder.startStream → _vmBuffer += Uint8List chunks
松手 → AudioRecorder.stop()
     → Uint8List.fromList(_vmBuffer) → processMicrophoneInput → LMDN encoded
     → QiniuDirectClient.putBinary("oc/chat/{chatId}/{ts}.enc", encoded)
     → BridgeWsClient.sendJson({type:"voice_msg", data:{key, sessionId}})

收到 WS voice_msg → getBinary(key)  → processReceivedAudio → ProcessedAudioResult.pcm
                 → wavFromPcm → audioplayers.play(BytesSource)
```

## 接口签名

```dart
class ChatVoiceRecorder {
  /// PCM 累积缓冲区，初始化时 clear()
  final List<int> _vmBuffer = [];
  bool _vmRecording = false;

  /// 请求麦克风权限，启动 stream，开始向 _vmBuffer 追加 PCM 块
  /// 失败条件：权限拒绝、stream 返回 null、processor 初始化失败
  Future<void> startRecord();

  /// 停止录音 → 编码全量 PCM → 上传 S3 → 发送 WS 消息
  /// 返回 S3 key 用于气泡渲染，null 表示失败
  Future<String?> stopRecord({required String chatId});
}

class ChatVoicePlayer {
  /// 从 S3 下载 key → 解码 → audioplayers.play
  /// 失败条件：key 不存在、解码失败（非 LMDN 格式）
  Future<void> playKey(String key);
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 快速点击 (<50ms) | 空 _vmBuffer，stopRecord 返回 null，不崩溃 |
| 权限拒绝 | startRecord 静默返回，日志 `[C10] mic denied` |
| S3 上传失败 | stopRecord 返回 null，日志 `[C12] error` |
| WS 发送失败 (未连接) | sendJson 内部检查 isConnected，静默丢弃 |
| 播放时 key 不存在 | playKey 日志 `[C14] empty data`，不崩溃 |
| 连续快速录制两次 | startRecord 的 _vmRecording 守卫阻断第二次 |
| 录制中退出页面 | dispose → _vmRecorder.dispose() 自动停止 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `chat_voice_recorder.dart` | 录音→编码→上传→WS 发送 | 80 |
| `chat_voice_player.dart` | S3 下载→解码→播放 | 60 |
| `chat_screen.dart` | UI 渲染（气泡、输入框、WS 收发），引用上述两文件 | 150 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C10 | `[C10] recording start\|stream\|mic\|error` | recorder:startRecord | 按下→`start`，松手→走到 C11 |
| C11 | `[C11] raw pcm\|encoded \|fail` | recorder:stopRecord | `raw pcm N B` → `encoded N M B` |
| C12 | `[C12] uploaded key=\|error` | recorder:stopRecord | `uploaded key=oc/chat/...` |
| C13 | `[C13] ws sent\|received voice_msg` | recorder/screen:WS | `ws sent key=...` → WS 到达 |
| C14 | `[C14] download\|decoded\|playback\|error` | player:playKey | `download` → `decoded N B` → `playback start` |

## 不变量 (invariants)

```
// === invariants ===
// - _vmBuffer 只在 startRecord/stopRecord 间由 stream.listen 追加
// - stopRecord 后 _vmBuffer.clear()，防止残留
// - _vmPlayer.play() 前必须 _vmPlayer.stop() 防止重叠播放
```
