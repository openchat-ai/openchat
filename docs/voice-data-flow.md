# 语音数据流与调试手册（QiniuDirectClient 架构）

## 架构总览

```
┌──────────────┐                    ┌────────────────┐                  ┌──────────────┐
│  手机 A       │  form upload ────→ │  七牛云 S3      │ ←── S3 LIST ─── │  手机 B       │
│  (发送方)     │    .enc 文件       │  (中继存储)     │    .enc 文件    │  (接收方)     │
│              │ ←── S3 GET ─────── │                │ ── form upload →│              │
│  录音 → 编码  │                   │                │                 │  下载 → 解码  │
│  → 上传       │                   │                │                 │  → 播放       │
└──────────────┘                    └────────────────┘                 └──────────────┘
```

**核心变化**：不再经过 Bridge 中转音频，所有音频数据直接读写七牛云 S3。

---

## 数据流向总图

```
MIC → PCM(16bit) → buffer 48KB → NeuralAudioCodec.encode → LMDN binary → form upload → Qiniu
                                                                                          │
                                                                                    S3 LIST ↓
                                                                                    .enc files
                                                                                          │
                                                                              S3 GET(download)
                                                                                          │
                                                                              NeuralAudioCodec.decode
                                                                                    ┌──┴──┐
                                                                                    │     │
                                                                                    ▼     ▼
                                                                               PCM(16bit)  F0 元数据
                                                                                    │     │
                                                                                    │     ▼
                                                                                    │  ScoreNote[] → 五线谱 UI
                                                                                    │  (scrolling staff)
                                                                                    ▼
                                                                              WAV ← audioplayers → Player
```

---

## 关键数据结构说明

### PCM 16-bit 原始音频
| 属性 | 值 |
|------|-----|
| 采样率 | 24000 Hz |
| 位深 | 16-bit signed little-endian |
| 声道 | 单声道 (mono) |
| 每帧大小 | 48000 bytes (= 1秒) |
| 正常值 | 非零，交替的 LSB/MSB 字节 |
| 静音值 | 全零 |

### LMDN 编码格式（`.enc` 文件）
```
偏移 0:  0xBB 0x12 0x30        # Type=MEDIA, Sub=LMDN (3 bytes)
偏移 3:  PLEN[2:0]              # Payload length (3 bytes, big-endian)
偏移 6:  payload                # 位分配(6B) + 帧数据 + F0元数据
末尾-2:  CKSUM                  # 校验和 (1 byte, TYPE+CMD+PL+PARAM 求和 & 0xFF)
末尾-1:  0x7E                   # 帧结束标记
```

| 属性 | 值 |
|------|-----|
| 1秒语音典型大小 | ~4000-6000 bytes |
| 静音/空输入大小 | ~35-50 bytes (仅 F0 元数据) |
| 识别方式 | 首字节 `0xBB` |
| 旧格式特征 | 首字节 `0x7B` (JSON `{`) |

---

## 录制链（发送方）

### 步骤 A1：麦克风 → PCM 流

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| AudioRecorder | `voice_room_screen.dart:143` | `record: ^6.0.0` 包 |
| 启动流 | `voice_room_screen.dart:150` | `startStream(RecordConfig(pcm16bits, 24000Hz, mono))` |
| 权限检查 | `voice_room_screen.dart:148` | `hasPermission()` → `requestPermission()` |
| 数据块大小 | ~480 bytes/chunk (10ms) | iOS/Android 底层决定 |

**调试检查点 C1**：确认 `stream.listen` 回调被触发
- 方式：在 `_buffer.addAll(chunk)` 前加日志
- 正常：每 ~10ms 触发一次，`chunk.length ≈ 480`
- 故障：回调从未触发 → 检查麦克风权限、`record` 包初始化

### 步骤 A2：PCM 缓冲 → 编码触发

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| buffer | `voice_room_screen.dart:156` | `List<int> _buffer` |
| 触发条件 | `voice_room_screen.dart:164` | `_buffer.length >= bufSize` (=48000) |
| 帧提取 | `voice_room_screen.dart:165` | `frame = _buffer.take(bufSize)` |
| 重叠淡入 | `voice_room_screen.dart:168-180` | 相邻帧首尾 fadeSamples 个样本混合 |

**调试检查点 C2**：确认 `bufSize` 达到
- 正常：每 ~1 秒触发一次 encode
- 故障：从未触发 → buffer 积压不涨，可能麦克风未输出数据
- 重叠数据：`_prevOverlap` 不为 null 时启用（首帧为 null）

### 步骤 A3：编码（PCM → LMDN）

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| 编码器 | `voice_room_screen.dart:145` | `LmdnProcessor(sampleRate, enableCodec: true)` |
| 调用 | `voice_room_screen.dart:182` | `_processor?.processMicrophoneInput(frame)` |
| 编码函数 | `lmdn_codec.dart` | `NeuralAudioCodec.encode()` |
| MDCT 帧大小 | 96 样本 (= 2 × _n, _n=48) | 48 点 MDCT → 48 个频域系数 |
| 位分配 | 16 个频带，每带 3 bits | 扫描前 250 帧的能量分布 |
| 输出格式 | LMDN binary | 首字节 `0xBB 0x12 0x30` |

**调试检查点 C3**：确认 encode 输出正确
- 正常：返回的 `encoded.data` 首 3 字节 = `0xBB 0x12 0x30`
- 大小：1秒正常语音 ~4000-6000 bytes，静音 ~35-50 bytes
- 故障：返回 null → `_isProcessing = false` 或 `_codec = null`

**位分配默认值**（当 `maxScan <= 10` 帧时）：
```
[4, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
```

### 步骤 A4：上传到七牛

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| 上传函数 | `qiniu_direct_client.dart:486` | `_putBinary(key, data)` |
| Key 路径 | `qiniu_direct_client.dart:523` | `oc/audio/{targetPeerId}/{peerId}_{seq}.enc` |
| 上传方式 | `qiniu_direct_client.dart:487-500` | Qiniu 表单上传 → S3 PUT 回退 |
| Token 生成 | `qiniu_direct_client.dart:74` | `_uploadToken(key)` — 本地 HMAC-SHA1 |
| Token 范围 | scope = `{bucket}:{key}` | 仅限上传到指定 key |
| Token 有效期 | 3600 秒 | 从生成时刻起 |
| 超时 | 15s (表单) / 10s (S3) | |

**调试检查点 C4**：确认文件出现在七牛
- 方式：`_list('oc/audio/{targetPeerId}/')` 或 浏览器访问 S3 LIST URL
- 正常：`{peerId}_{seq}.enc` 文件存在，size ~4-6KB
- 故障：文件不存在
  - Token 生成失败 → HMAC 密钥不匹配
  - 网络不通 → 检查 upload 域名是否可达 (`upload-z0.qiniup.com`)
  - 超时 → 文件太大或网络慢

**回退机制**：
```
_putBinary:
  1. if _useFormUpload → Qiniu 表单上传 (POST multipart)
     成功 → return
     失败 → log warning → 继续
  2. S3 V4 预签名 PUT (x-amz-content-sha256: UNSIGNED-PAYLOAD)
     成功 → return
     失败 → throw Exception
```

**自测回环（self-test）**：
- `targetPeerId = peerId`（同目录上传 + 同目录 poll）
- `sendEncodedAudio` 写入 `oc/audio/{peerId}/{peerId}_{seq}.enc`
- `pollEncodedAudio` 列出 `oc/audio/{peerId}/` → 找到自己上传的文件

---

## 播放链（接收方）

### 步骤 B1：定时轮询（Poll）

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| 定时器 | `voice_room_screen.dart:193` | `Timer.periodic(pollMs)` |
| 间隔 | `audio.json` → `pollMs` | 默认 2000ms |
| Poll 函数 | `qiniu_direct_client.dart:526` | `pollEncodedAudio()` |
| S3 LIST | `qiniu_direct_client.dart:176` | `_list('oc/audio/{peerId}/')` |
| 文件删除 | `qiniu_direct_client.dart:532` | 下载后 `_delete(key)` |
| 超时 | 8s (LIST) / 10s (DELETE) | |

**调试检查点 C5**：确认 S3 LIST 返回文件
- 方式：直接请求 S3 LIST URL
- 正常：HTTP 200，XML 中包含 `<Key>` 条目
- 故障：
  - HTTP 403 → 预签名签名算法错误（检查 AK/SK/region/datetime）
  - HTTP 400 → 参数格式错误（prefix 编码）
  - XML 为空列表 → 对方未发送文件

### 步骤 B2：下载 → 解码（双输出）

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| 下载 | `qiniu_direct_client.dart:513` | `_getBinary(key)` — S3 GET 预签名 |
| 解码 | `voice_room_screen.dart:199` | `_processor?.processReceivedAudio(c)` |
| 解码函数 | `lmdn_codec.dart:373` | `NeuralAudioCodec.decode()` |
| **输出 1：波形** | `ProcessedAudioResult.pcm` | PCM 16-bit, 48000 bytes (1秒 @ 24000Hz) |
| **输出 2：曲谱** | `ProcessedAudioResult.notes` | `List<ScoreNote>` — 从码流 F0 提取 |
| 队列 | `voice_room_screen.dart:219-224` | PCM 累积 ~3 秒 → WAV → 播放 |
| 曲谱累积 | `voice_room_screen.dart:_allNotes` | `List<ScoreNote>` 逐帧追加 |

#### F0 元数据提取

LMDN 码流中每 4 帧写入 20 bits F0 包：

| 字段 | 位数 | 说明 |
|------|------|------|
| midiInt | 7 | MIDI 音符号 (0-127) |
| cent | 5 | 微音分偏移 (-16 ~ +15) |
| conf | 4 | 置信度 (0-15) |
| voiced | 1 | 有声/无声标志 |
| spare | 3 | 保留 |

每 4 帧 = 4 × 96/24000 = 0.016s 产生一个 F0 条目。连续相同 MIDI 的音符合并为单个 `ScoreNote`（延长 durSec）。

流程：
```
decode() → 在 frameIdx % 4 == 0 时读取 F0 包
         → 若 voiced && midiInt > 0 → 创建/合并 ScoreNote
         → 存入 LmdnDecoded.notes
         → processReceivedAudio 返回 ProcessedAudioResult {pcm, notes}
         → voice_room_screen 将 notes 追加到 _allNotes
         → setState 触发 ResidentMusicScore 重绘
```

#### 波形输出

- 当前已实现：PCM → WAV 封装 → `audioplayers` 播放
- WAV 头格式：`RIFF(4) + size(4) + WAVE(4) + fmt (16) + data(8) + PCM_data`

#### 曲谱输出（待实现）

- LMDN 码流中包含 F0 基频元数据
  - 每 4 帧一组：7+5+4+1+3 = 20 bits F0 包（含 pitch/voicing/gain）
  - 当前 `decode()` 在第 413-416 行 **读取后丢弃**
  - 需要改造 `decode()` 提取 F0 信息
- 可选的额外 F0 分析：`_yinF0()` / `_peakTrackF0()`（`lmdn_codec.dart:94-122`，当前未调用）
- 目标格式：`List<ScoreNote>{midi, startSec, durSec}` → 驱动五线谱 UI

**调试检查点 C6**：确认 decode 双输出正确
- 波形路径：`processReceivedAudio` 返回 PCM 长度 ≈ 48000 bytes
- 解码前（输入）：首字节 `0xBB`（LMDN 格式）
- 解码后（输出-波形）：首字节为 PCM 数据（非 `0xBB`）
- 解码后（输出-曲谱）：F0 数据需从码流中提取，传递给 `resident_music_score.dart`
- 故障：返回 null → 解码异常（格式错误、校验和不匹配）

### 步骤 B3：播放

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| 播放器 | `voice_room_screen.dart:144` | `AudioPlayer()` — `audioplayers` 包 |
| 播放 | `voice_room_screen.dart:257` | `player.play(BytesSource(wav))` |
| 串行播放 | `voice_room_screen.dart:213` | `_playNext()` 链式回调 |
| 淡入淡出 | `voice_room_screen.dart:236-251` | 批次边界 fadeSamples 个样本 |

### 步骤 B4：五线谱曲谱展示

| 元素 | 代码位置 | 说明 |
|------|---------|------|
| 五线谱组件 | `resident_music_score.dart` | `_StaffPainter` 自定义绘制 |
| 音符数据 | `ScoreNote{midi, startSec, durSec}` | MIDI 号 + 起始时间 + 时长 |
| 动画 | `AnimationController` | 4 秒循环，note 从右向左流动 |
| 播放标记 | 橙色竖线 | 当前播放位置 |

**数据流**：
```
LMDN 码流 → decode() 提取 F0 → 基频 → MIDI 映射 → ScoreNote[]
                                                                  ↓
                                                          resident_music_score.dart
                                                                  ↓
                                                          _StaffPainter.paint()
                                                              (五线谱 + 流动音符)
```

**当前状态**：曲谱展示已从码流提取 F0 数据（`decode()` 解析每 4 帧的 MIDI/voicing 信息），通过 `ProcessedAudioResult.notes` 传递到 `voice_room_screen.dart` 的 `_allNotes`，驱动 `ResidentMusicScore` 五线谱组件实时滚动展示。

**调试检查点 C8**：确认曲谱数据到达 UI
- 正常：`ScoreNote[]` 非空，notes 在五线谱上从右向左流动
- 故障：五线谱空白 → F0 未从码流提取；notes 不流动 → AnimationController 未启动
- 正常：`player.onPlayerComplete` 触发 → 播放下一条
- 故障：
  - `player.play` 抛出异常 → 检查 WAV 头格式是否正确
  - `onPlayerComplete` 不触发 → 音频长度为零或损坏
  - 无声但有播放进度 → 检查音量、音频路由（听筒/扬声器）

---

## 自测回环（Self-Test）完整数据流

```
按 Demo 按钮 → _initSelfTest()
  │
  ├─ 1. 生成/读取 peerId (SharedPreferences)
  ├─ 2. QiniuDirectClient(peerId: ${peerId})
  ├─ 3. register() → 上传 oc/users/{peerId}.json ✅ 确认文件存在
  ├─ 4. _targetPeerId = peerId (自己)
  ├─ 5. 等待 demoDelayMs (默认 0ms)
  └─ 6. _startAudio()
        │
        ├─ 录音链: A1 → A2 → A3 → A4 (上传到 oc/audio/{peerId}/)
        └─ 播放链: B1 → B2 → B3 (从 oc/audio/{peerId}/ 下载)
```

**预期时序**（正常情况）：
```
t=0s    按 Demo → 注册 → 开始录音
t=1s    第1帧（48000 PCM）→ 编码 → 上传 → seq 0
t=2s    第2帧 → 编码 → 上传 → seq 1
t=2s    Poll 运行 → S3 LIST → 找到 seq 0 → 下载 → 解码 → 入播放队列
t=2.1s  播放 seq 0（用户听到约 2.1s 前的自己）
t=3s    第3帧 → 编码 → 上传
t=4s    Poll 运行 → 找到 seq 1 → 下载 → 解码 → 入播放队列
```

**实际延迟**：~2-3秒（1秒缓冲 + 2秒 poll 间隔）

---

## EPC 通话录制

每次通话结束时，将所有 LMDN 帧合成为一个 `.epc` 文件保存到七牛，作为完整通话记录。

### 数据流

```
通话开始 → _callFrames[] 逐帧累积
              ↓
通话结束 → _saveEpc()
              ↓
       concatenate(all frames) → Uint8List epc
              ↓
       saveEpcRecord(epc) → _putBinary → oc/recordings/{peerId}/{timestamp}.epc
```

### 文件格式

`.epc` 文件 = 简单串联的 LMDN 帧，每帧自描述：

```
[LMDN frame 0][LMDN frame 1]...[LMDN frame N]
```

每帧格式：
```
0xBB 0x12 0x30 | PL(3B) | payload(PL bytes) | CKSUM(1B) | 0x7E
```

解码器 `decode()` 通过扫描 `0xBB 0x12 0x30` 头自动解析多帧。

### 存储位置

```
oc/recordings/{peerId}/{timestamp}.epc
```

| 元素 | 值 |
|------|-----|
| bucket | dapin-xp |
| 路径前缀 | `oc/recordings/` |
| 文件命名 | `{毫秒时间戳}.epc` |
| 上传方式 | `_putBinary` (表单上传 → S3 PUT 回退) |
| 触发时机 | 通话结束时 `_endCall()` |

### 与实时 poll 的关系

- `.enc` 文件：实时 poll 消费，下载后删除（用于实时播放）
- `.epc` 文件：通话结束才上传，不会被 poll 消费（用于存档回放）
- 二者互不干扰

**调试检查点 C9**：确认 EPC 文件存在
- 方式：S3 LIST `oc/recordings/{peerId}/`
- 正常：`{timestamp}.epc` 文件存在，size = N帧 × ~5KB/帧
- 故障：文件不存在 → `_endCall()` 未触发或 `saveEpcRecord` 异常

---

## 本地回环模式（零 S3 延迟）

通话界面提供 **本地/实时** 切换按钮（`Icons.storage` / `Icons.cloud_upload`），可在通话中实时切换 `_localMode`：

| 模式 | 图标 | 录音去向 | 回放来源 | 用途 |
|------|------|---------|---------|------|
| 本地 | `Icons.storage` | `_localQueue`（内存） | `_localQueue`（内存） | 回环自测、离线录音 |
| 实时 | `Icons.cloud_upload` | S3 form upload | S3 LIST+GET | 远程 P2P 通话 |

本地模式下录音帧不经过 S3，直接在内存队列中传输：

```
麦克风 → encode → _localQueue → decode → 播放队列
```

- **零网络延迟**：无 S3 PUT/GET，无预签名 URL 开销
- **逻辑不变**：`processMicrophoneInput` → `_localQueue.add()` + `_callFrames.add()`（EPC 录制仍继续）
- **消费端**：`_audioTimer` → swap `_localQueue`（O(1) 无复制）→ `processReceivedAudio`
- **与 S3 流共享**：`_playQueue`、`_playNext`、EPC 录制逻辑完全一致
- **切换安全**：切换至实时模式时自动清空 `_localQueue`，避免残留帧
- **实现位置**：`voice_room_screen.dart:211-214`（写入分支），`voice_room_screen.dart:230-235`（读取分支）

---

## 语音消息模式（按住录音，松手播放）

自测时可选"语音消息"模式，实现微信式按住→录音→松手→编解码→播放：

```
按下 → AudioRecorder.startStream → _vmBuffer 累积 PCM
松手 → AudioRecorder.stop → Uint8List.fromList(_vmBuffer)
     → processMicrophoneInput (编码为 LMDN 多帧)
     → processReceivedAudio  (解码回 PCM)
     → audioplayers.play(BytesSource(wav))
```

- **零网络**：纯本地编解码，不涉及 S3
- **无缓冲延迟**：一次性编码/解码全部 PCM，无分帧 fade
- **调试价值**：验证全链路（录音→编码→解码→播放），无网络干扰
- **按钮**：`Listener` 监听 `onPointerDown`/`onPointerUp`，按下即录、松手即停
- **实现位置**：`_startVmRecord()` / `_endVmRecord()` in `voice_room_screen.dart`

---

## 语音消息聊天（聊天页发语音）

聊天页 `chat_screen.dart` 支持按住录音→上传 S3→发送键值→对方下载播放：

```
按下麦克风按钮 → AudioRecorder.startStream → _vmBuffer 累积 PCM
松手 → stop → encode(LMDN) → putBinary(oc/chat/{chatId}/{ts}.enc)
     → sendJson({type: 'voice_msg', data: {key, sessionId}})
对方收到 WS `voice_msg` → 显示语音气泡
点气泡 → getBinary(key) → decode → audioplayers.play
```

| 步骤 | 方法 | 位置 |
|------|------|------|
| 录音 | `_startVmRecord()` | `chat_screen.dart:108` |
| 编码+上传 | `_endVmRecord()` → `putBinary()` | `chat_screen.dart:143` |
| WS 发送 | `bridgeWsProvider.sendJson()` | `chat_screen.dart:156` |
| WS 接收 | `wsSub` 监听 `voice_msg` | `chat_screen.dart:46` |
| 下载+播放 | `_playVoiceMsg()` → `getBinary()` → `processReceivedAudio()` | `chat_screen.dart:167` |

**调试检查点**：
- C10: 按下按钮→录音灯亮→_vmBuffer 有数据
- C11: 松手→编码成功(日志 `vm encoded X B -> Y B`)
- C12: 上传成功(七牛文件 `oc/chat/{chatId}/{ts}.enc` 存在)
- C13: WS 消息 `voice_msg` 发送并接收
- C14: 播放时下载→解码→audioplayers.play

---

## 语音房间（多人实时通话）

`room_screen.dart` 实现多人实时语音房间：

```
加入房间 → 录音流→encode→putBinary(oc/rooms/{roomId}/{myPeerId}/{seq}.enc)
定时器 → listFiles(oc/rooms/{roomId}/) → 发现所有参与者
       → 遍历每个参与者的 .enc 文件 → getBinary → decode → playQueue
       → 跳过已播放 seq、已静音的参与者
```

| 元素 | 说明 |
|------|------|
| 上传路径 | `oc/rooms/{roomId}/{myPeerId}/{seq}.enc` |
| 发现参与 | `listFiles(prefix)` → 解析 `parts[3]` 作为 peerId |
| 去重播放 | `_playedSeqs[peerId]` 跟踪每个参与者的最大已播 seq |
| 静音 | `_mutedPeers[peerId] = true` → 跳过该参与者的文件 |
| 房间信号 | 通过 `/room` route 传入 `roomId`，硬编码 peerId |

**开发者入口**：People 页自定义动作 `room:open` → 输入房间 ID → `/room?roomId=xxx`

**调试检查点**：
- C15: 录音→上传到 `oc/rooms/{roomId}/{peerId}/`
- C16: `listFiles` 返回多个参与者的文件
- C17: 下载→解码→播放，跳过自身和已静音者

---

## 调试检查点索引

所有 checkpoints 统一格式 `[C{N}]`，终端直接 `grep "\[C"` 一条命令看全链路：

| C | grep 关键词 | 组件 | 位置 |
|---|------------|------|------|
| 1 | `[C1] registered peer=` | 注册 | `voice_room_screen.dart:83` |
| 2 | `[C2] processor\|mic perm\|mic denied` | 权限 | `voice_room_screen.dart:169-173` |
| 3 | `[C3] record stream\|stream null` | 录音流 | `voice_room_screen.dart:177-179` |
| 4 | `[C4] sent seq=` | 上传 S3 | `voice_room_screen.dart:212` |
| 5 | `[C5] polled ` | 轮询 | `voice_room_screen.dart:232` |
| 6 | `[C6] decoded ` | 解码 | `voice_room_screen.dart:238` |
| 7 | `[C7] play \|error` | 播放 | `voice_room_screen.dart:296,315` |
| 8 | `[C8] notes=` | 曲谱 | `voice_room_screen.dart:241` |
| 9 | `[C9] saved epc\|no frames\|error` | EPC | `voice_room_screen.dart:320-323` |
| 10 | `[C10] recording start\|stream\|init\|mic\|error` | VM 录音 | `chat_screen.dart:116-140` |
| 11 | `[C11] raw pcm\|encoded \|encode fail\|error` | VM 编码 | `chat_screen.dart:143-164` |
| 12 | `[C12] uploaded key=` | VM 上传 | `chat_screen.dart:158` |
| 13 | `[C13] ws sent\|received voice_msg` | WS 信令 | `chat_screen.dart:160,46` |
| 14 | `[C14] download\|decoded\|playback\|error` | VM 播放 | `chat_screen.dart:172-187` |
| 15 | `[C15] room init\|processor\|mic\|stream\|upload\|init` | 房间初始化 | `room_screen.dart:48-106` |
| 16 | `[C16] listFiles\|participants\|poll:\|error` | 房间轮询 | `room_screen.dart:107-141` |
| 17 | `[C17] skip muted\|empty data` | 房间去重 | `room_screen.dart:125-133` |

---

## 文件索引

| 文件 | 职责 |
|------|------|
| `openchat-flutter/lib/ui/screens/voice_room_screen.dart` | P2P 语音通话 + 自测回环 + 语音消息模式 |
| `openchat-flutter/lib/ui/screens/chat_screen.dart` | 聊天页（文字 + 语音消息） |
| `openchat-flutter/lib/ui/screens/room_screen.dart` | 多人语音房间（S3 共享目录） |
| `openchat-flutter/lib/core/api/qiniu_direct_client.dart` | Qiniu 上传/下载/列目录/删除 |
| `openchat-flutter/lib/core/audio/lmdn_codec.dart` | LMDN 神经音频编解码器（含 F0 分析函数） |
| `openchat-flutter/lib/core/ui_voice_config.dart` | 音频配置（buffer/poll/denoise） |
| `oc/config/audio.json` | 运行时音频配置（七牛侧） |
| `openchat-flutter/lib/ui/components/resident/resident_music_score.dart` | 五线谱曲谱展示组件 |
| `openchat-flutter/lib/core/api/bridge_ws_client.dart` | WebSocket 桥（文本聊天 + 信令） |

## 版本历史

| 日期 | 变更 | 说明 |
|------|------|------|
| 2026-06-02 | 创建 | 首次编写 QiniuDirectClient 架构数据流 |
| 2026-06-02 | 更新 | 补充解码双输出（波形+曲谱），标注 F0 提取待实现 |
| 2026-06-02 | 更新 | 补充 EPC 通话录制：_callFrames 累积 → _endCall 时合成 .epc 上传 |
| 2026-06-02 | 更新 | F0 提取从码流读取 MIDI/voicing → 驱动五线谱实时展示 |
| 2026-06-02 | 更新 | 本地回环模式：_localMode 切换按钮 + 零 S3 延迟内存传输 |
| 2026-06-02 | 更新 | 语音消息模式：按住录音 + 松手编解码播放 + 零网络全链路验证 |
| 2026-06-02 | 更新 | 聊天页语音消息：录音→上传 S3→WS 送 key→对方下载播放 |
| 2026-06-02 | 更新 | 多人语音房间：room_screen + S3 共享目录 + 静音/去重 |
| 2026-06-02 | 更新 | 调试检查点 C1-C17 结构化日志：`[C{N}]` 格式 + grep 索引表 |
