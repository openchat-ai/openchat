# spec: audio_engine.dart
> Unified audio engine for voice rooms, replaces RoomAudio + VoiceRoomAudio with feature flags.

## 数据流
input:  mic stream + S3 polled audio + S3 direct upload
output: encoded audio frames to S3 + decoded PCM to player queue

## 接口签名
- `AudioEngineConfig({roomId, vmRecordEnabled, localModeEnabled, callFramesEnabled, notesEnabled, peerMuteEnabled})`
- `AudioEngine({cfg, onParticipants?, onNotes?, onState?})`
- lifecycle: `start()` → `leave()`
- per-frame ops: `startVmRecord/endVmRecord` (vm only), `saveCallFrames` (callFrames only)
- state queries: `myPeerId, participants, mutedPeers, muted, ended, vmRecording, localMode, callFrames, notes, state, targetPeerId`
- state setters: `targetPeerId, localMode, state, notes`

## 边界条件
- `_ended` 守卫: leave() 后所有 poll/record/play 操作立即返回
- vmRecordEnabled=false: startVmRecord/endVmRecord 抛 UnimplementedError
- peerMuteEnabled=false: toggleMutePeer/isPeerMuted 始终 false/不操作
- buffer 累积: chunk 累加到 `bufSize` 后才处理一帧

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| lib/core/audio/audio_engine.dart | 统一音频引擎 | 400 |

## 调试检查点
| C | 触发 | 预期 |
|---|------|------|
| 1 | start() 第一次调用 | processor init + recorder perm + stream |
| 2 | mic perm denied | log + early return |
| 3 | poll() 拉新帧 | decode + 入 _playQueue |
| 4 | _playQueue 非空 | batch 3s, fade, play |

## 不变量
- _recordSub/_pollTimer 在 leave() 中 cancel
- _playQueue 重入保护: _playing 标志
- buffer 状态在 listener 闭包内, 不跨 chunk 共享 (per-room)
- uploadToPeer 仅在 targetPeerId != null && state == 'connected'
- callFrames 仅在 callFramesEnabled=true 时追加
- notes 仅在 notesEnabled=true 时 addAll + 触发 onNotes
