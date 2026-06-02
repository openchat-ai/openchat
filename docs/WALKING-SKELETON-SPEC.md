# spec: Walking Skeleton (E2E Demo)

> 单一目标：让 "手机说话 → Qiniu → lmdn → agent → 工具 → 返回 → 手机播放" 端到端跑通一次。
> 5 天预算。期间禁止 refactor。

## 0. 启动前必读（协作 + verify-commit 兼容）

### 0.1 与主程序并发约定

主程序当前在 `main` 分支做 `refactor(client): split 14 files into 50+ modules` 大手术。
此 spec 的工作**必须**做物理隔离：

- 新分支：`skeleton/bridge-side`（不在 main）
- 新目录：`apps/bridge/`（不存在的目录，主程序的 refactor 不会扫到）
- 此 spec 本身**必须先 `git add` 并 commit**，否则任何 `git clean -fd` 都会删掉它（已被差点删除过一次）

### 0.2 verify-commit P0 阻塞规则（已生效）

`scripts/verify-commit.mjs` 现在是 **err = 阻塞**，违规直接拒绝 commit：

| 规则 | 阈值 | 应对 |
|------|------|------|
| 新 .dart >50 行无 spec | 阻塞 | Phase A 不写 Dart → 不触发 |
| 白名单 .dart 改 >100 行无同步 spec | 阻塞 | Phase A 不改白名单 → 不触发 |
| **`*.spec.md` 文件**缺标准章节 | 阻塞 | 本 spec 是 `.md` 单扩展名，**不被章节校验**；但 §5.1 的 `apps/bridge/skeleton.spec.md` 是双扩展名，**必须**含 §0.3 模板 |
| 总 diff > 500 行 | 阻塞 | **Phase A 必须拆 ≥3 个 commit**（见 §5.4） |

> 本 spec 当前 ~190 行，一次 commit 远低于 500 → 安全。

### 0.3 `apps/bridge/skeleton.spec.md` 必含章节模板

为通过 verify-commit 章节检查，写 `apps/bridge/skeleton.spec.md` 时复制以下骨架：

```markdown
# spec: apps/bridge/skeleton

## 数据流
（参考 WALKING-SKELETON-SPEC.md §2，或直接引用）

## 接口签名
（参考 WALKING-SKELETON-SPEC.md §3）

## 边界条件
（参考 WALKING-SKELETON-SPEC.md §4）

## 文件清单
（参考 WALKING-SKELETON-SPEC.md §5.1）

// === invariants ===
// - skeleton-codec.mjs SR=24000 不可改
// - 跨设备字节必须经 lmdn
// - reply 文件名必须含 -reply 后缀
```

四个 `## 数据流` `## 接口签名` `## 边界条件` `## 文件清单` 章节**字面必须存在**（verify-commit 用 `content.includes()` 严格匹配，**不带编号**）。

## 1. 真实现状（grep 验证）

```
✅ App 录音→lmdn 编码→上传 oc/chat/$chatId/$ts.enc
   chat_voice_recorder.dart: C10 (录音) + C11 (encode) + C12 (uploaded)

❌ Bridge 端处理 oc/chat/ 目录：完全缺失
   grep "oc/chat|\\.enc" bridge/src/ → 0 匹配

✅ App 下载→lmdn 解码→播放
   chat_voice_player.dart: C14 (download + decode + play)
```

**Bridge 端是唯一缺口。** 4 个新文件可解决，约 530 行。

## 1.1 已发现的字节级 Blocker（Day A1 必须先解决）

diff `lpc-mdct-codec.js` vs `lmdn_codec.dart` 发现：

| 项 | Bridge JS | App Dart | 影响 |
|---|---|---|---|
| **采样率** | `SR = 48000` (硬编码) | `24000` (硬编码) | **手机上传的 .enc 用 JS 端按 48kHz 解，PCM 时长错乱 / 音调拉高 / 可能 throw** |
| Frame 数公式 | `ceil((totalSamples - 2N) / N) + 1` | `ceil(totalSamples / N)` | 末帧差 1，末尾 PCM 可能截断 |
| EPC 头/CS/0x7E | 完全一致 ✅ | — |
| Bit allocation | 算法一致 ✅ | — |
| F0 块（midi+cent+conf+voiced+onset） | 写法一致 ✅ | — |

**Day A1 第一件事**：从 `lpc-mdct-codec.js` fork 出 `apps/bridge/skeleton-codec.mjs`，改 SR=24000，对齐 frame 数公式，跑通正弦波 round-trip。

## 2. 数据流

```
[App 端 已实现]
  AudioRecorder.startStream(pcm16 @ 24kHz)
    → ChatVoiceRecorder._vmBuffer.addAll(chunk)    [C10]
    → LmdnProcessor.processMicrophoneInput(pcm)    [C11]  ← lmdn encode
    → QiniuDirectClient.putBinary("oc/chat/$chatId/$ts.enc")  [C12]

[Bridge 端 待实现]
  pollQiniuList("oc/chat/")
    → 发现 *.enc 新 key
    → qiniuDownload(key)                           [C13]
    → lpcMdctCodec.decode(bytes) → PCM @ 24kHz     [C13b]  ← fork 后的 24kHz 版本
    → stt(pcm) → text                              [C13c]  ← v0: hard-code "你好"
    → agentEngine.processStream(text)              [C13d]  ← 必触发 TOOL_CALL
    → tts(reply) → PCM @ 24kHz                     [C13e]  ← v0: PowerShell SAPI
    → lpcMdctCodec.encode(replyPcm) → bytes        [C13f]
    → qiniuUpload("oc/chat/$chatId/$ts-reply.enc")

[App 端 已实现]
  ChatVoicePlayer.playKey(replyKey)
    → QiniuDirectClient.getBinary(replyKey)        [C14]
    → LmdnProcessor.processPlaybackAudio(raw) → PCM
    → AudioPlayer.play(pcm)
```

## 3. 接口签名

```js
// apps/bridge/skeleton-codec.mjs
class SkeletonCodec {
  async initialize();
  async encode(pcm /* Buffer @ 24kHz int16 */) /* → {data: Buffer, frameCount} */;
  async decode(epcBytes /* Buffer */) /* → {pcm: Buffer, score: ScoreNote[]} */;
}

// apps/bridge/skeleton-qiniu.mjs
async function qiniuList(prefix) /* → string[] */;
async function qiniuGet(key) /* → Buffer */;
async function qiniuPut(key, data) /* → void */;

// apps/bridge/skeleton-tts.mjs
async function tts(text /* string */) /* → Buffer pcm16 @ 24kHz */;

// apps/bridge/skeleton.mjs (main)
async function processChatEnc(key);   // 单条 .enc → reply.enc 完整链路
async function pollLoop();             // 1s 轮询 oc/chat/
```

## 4. 边界条件

| 条件 | 预期行为 |
|------|---------|
| 手机上传 0 字节 .enc | Bridge 跳过（log warn），不调 agent |
| .enc 头不是 BB 01 CC | log error + 跳过 + 不调 agent |
| agent 不调用任何工具 | log warn，仍可继续生成 reply（但记入失败统计） |
| TTS 失败 | reply.enc 不上传，标记此 reqId 失败 |
| reply.enc 已存在（重复处理） | Bridge 维护 seenKeys Set 去重 |
| App 重复轮询同一 chatId | Bridge 端文件名含时间戳，App 端用最近一条 |

## 5. 文件清单

### 5.1 待创建（Phase A）

| 文件 | 职责 | 关键依赖 |
|------|------|---------|
| `apps/bridge/skeleton-codec.mjs` | fork `lpc-mdct-codec.js` + SR=24000 + 修 frame 数公式 | 无 |
| `apps/bridge/skeleton-qiniu.mjs` | list / get / put 最小封装 | 复用 `bridge/src/core/qiniu-signaling.js` 中 _ak/_sk 默认值 |
| `apps/bridge/skeleton-tts.mjs` | TTS 适配 | PowerShell SAPI / edge-tts CLI / ffmpeg+espeak |
| `apps/bridge/skeleton-agent.mjs` | 调 agent-engine + 注册 1 个工具 | `bridge/src/core/agent/agent-engine.js` + provider-kit |
| `apps/bridge/skeleton.mjs` | 主循环 + 编排 | 上述四个 |
| `apps/bridge/skeleton.spec.md` | 满足 verify-commit 的 spec 章节 | — |

**行数不设硬上限**，但单文件 >200 行会触发 verify-commit warn（不阻塞）。

### 5.2 Day-by-Day

| Day | 任务 | 验证 |
|-----|------|------|
| **A0** | commit spec + 切分支 + 建 apps/bridge/ 空目录 | `git status` 干净 |
| **A1.1** | 写 skeleton-codec.mjs（fork + SR=24000 + 公式修正） | 本地正弦波 encode → decode round-trip，PCM 长度差 ≤ 1 帧（96 样本） |
| **A1.2** | 拉一条真实手机 .enc 喂给 skeleton-codec.mjs | 解码出 PCM 存 wav，能听出录音内容（哪怕模糊） |
| **A2** | 写 skeleton-qiniu + skeleton-tts + skeleton-agent + skeleton.mjs | Bridge 跑起来，手机录一段，Qiniu 看到 `*-reply.enc` |
| **A3** | 独立 Node 进程下载 reply.enc → 解码 → 写 wav | wav 是合理的中文 TTS（哪怕生硬） |

### 5.3 Phase A 退出标准

- A3 的 wav 能听出是 TTS 回复
- agent 日志含 `TOOL_CALL`
- 连续 5 次手机录音 → Bridge 处理 → reply 上传都成功
- commit message: `feat(skeleton): phase A done — bridge side complete`

### 5.4 Commit 拆分计划（绕开 R4 500 行阻塞）

| Commit | 文件 | 估计行数 |
|--------|------|---------|
| 1 | spec 本身 + apps/bridge/skeleton.spec.md | <300 |
| 2 | skeleton-codec.mjs (fork + 改) + 自检脚本 | <400 |
| 3 | skeleton-qiniu.mjs + skeleton-tts.mjs | <300 |
| 4 | skeleton-agent.mjs + skeleton.mjs（主循环） | <400 |
| 5 | A1.2 验证脚本 + 真实 .enc 测试结果记录 | <200 |

每个 commit 自包含、可独立 review、不超 500 行。

## 6. 成功标准（一处定义）

12 个 C 标记按顺序在日志中出现：

| C | 来源 | 含义 |
|---|------|------|
| C10 | App 日志 (`oc/logs/{peerId}/`) | recording start |
| C11 | App 日志 | encoded N → M B |
| C12 | App 日志 + Qiniu 控制台 | `oc/chat/$chatId/$ts.enc` 存在 |
| C13 | Bridge stdout | `[C13] downloaded $key` |
| C13b | Bridge stdout | `[C13b] decoded $N samples` |
| C13c | Bridge stdout | `[C13c] text=...` |
| C13d | Bridge stdout | `[C13d] TOOL_CALL=...` (至少一次) |
| C13e | Bridge stdout | `[C13e] reply=...` |
| C13f | Bridge stdout + Qiniu | `oc/chat/$chatId/$ts-reply.enc` 存在 |
| C14 | App 日志 | downloaded + decoded |
| 🔊 | 真实喇叭 | 听到中文 TTS 回复（Phase B） |

**🔊 不出现就不算成功**。

## 7. 不变量（违反即重写）

```
// === invariants ===
// - 跨设备字节必须经过 lmdn（App 端 LmdnProcessor，Bridge 端 skeleton-codec.mjs，皆 24kHz）
// - 跨设备传输必须走 Qiniu oc/chat/ 路径
// - agentEngine.processStream 必须被调用一次，且至少触发一次 TOOL_CALL 事件
// - Bridge 端 reply 文件命名必须含 -reply 后缀（避免被 App 当作新请求重复处理）
// - Bridge 端维护 seenKeys Set 去重，App 端只播放含 -reply 的文件
// - skeleton-codec.mjs 必须 SR=24000，禁止改回 48000
```

## 8. Phase B — 真机闭环（用户主导）

### 8.1 用户操作

1. `git pull`
2. `node apps/bridge/skeleton.mjs` 启 Bridge
3. 手机开 App → 聊天屏录音说"你好"
4. 听是否自动播放 reply

### 8.2 可能需要的 1 个 APK 改动

若不会自动播放 `-reply.enc`，在 chat 列表加：
- 监听同 chatId 下新文件 → 含 `-reply` 后缀的调 `ChatVoicePlayer.playKey()`
- 约 30 行 Dart 改动 → 用户 `flutter build apk` 一次

## 9. 冷冻规则

### 9.1 Refactor 禁令

Phase A/B 期间禁止任何 `refactor:` 开头的 commit。

理由：最近 20 个 commit 全是 `refactor: split N-line file`，0 个推进 demo。

### 9.2 不许碰

- `_archive/` 之外的任何已有 Dart 文件（除加日志）
- 任何主程序当前在改的文件（用 `git log --since='1h'` 查）
- `core/agent/resident-*` / `deity-*` / `mirror-*` / `ai-person*`
- `core/quality/*` / `core/convergence/` / `core/evolution/` / `core/p2p/`

### 9.3 允许的简化

- hard-code chatId、peerId、bucket、region
- v0 STT 直接返回 "你好"
- v0 TTS 用任何能出 wav 的现成方案（PowerShell SAPI 最快）
- 跳过认证 / contextToken 续期
- console.log 不用 logger
- 复制粘贴，不抽象

## 10. AI 需要用户提供的信息

`~/.openchat/config.json` 自查后已知就绪：
- `providers.openrouter.apiKey` ✅
- `current = openrouter/openrouter/free` ✅
- `bridge.qiniuEnabled = true` ✅

仅缺：
- 手机 peerId（AI 可拉 Qiniu `oc/logs/` 自找）
- 一条 `.enc` 文件 key（AI 可拉 Qiniu `oc/chat/` 自找）

## 11. AI 远程驱动能力

- 写/读 Qiniu 任意路径
- `oc/debug/{peerId}/<action>.cmd` 触发手机 ping/diag/test_put/test_get/test_delete/test_list
- `oc/config/ui_*.json` 远程调 SDUI 渲染（Phase B 加 reply 自动播放按钮可用此通道）

## 12. 退出条件

| 结果 | 含义 |
|------|------|
| 5 天内 12 标记 + 🔊 出现 | 进入下一阶段（讨论产品方向、N=2、清理 _archive/） |
| 5 天到但未跑通 | 在 `docs/demo-record.md` 写 ≤300 字复盘，找一个真人讲一遍 spec 听挑战 |
| 期间方向漂移 | 立即停手，重读 §2 |

## 13. 立即执行（用户回主目录后）

```bash
cd F:\openchat
# 防止 spec 被 clean
git add docs/WALKING-SKELETON-SPEC.md
git commit -m "docs(skeleton): walking skeleton spec v4 + 协作约定 + 已知 blocker"
# 切隔离分支
git checkout -b skeleton/bridge-side
git push origin skeleton/bridge-side  # 远程备份
```

然后告诉 AI "开始 A0"，AI 自动建 `apps/bridge/` 目录 + 写 `skeleton.spec.md` 满足 verify-commit。

