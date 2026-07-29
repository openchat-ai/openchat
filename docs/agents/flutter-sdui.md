# Flutter / SDUI（按需）
- UI/行为/配置：优先 SDUI JSON 或 file:write；debug: `oc/debug/{peerId}/{action}.cmd`
- 仅新原生能力才改 Dart + APK。编译决策: `docs/COMPILATION_BOUNDARY.md`（约 85% 不该编 APK）
- Dart: flutter_lints · Riverpod · freezed · Widget 文件名=类名
- Codec 同步: `neural_audio_codec.dart` ↔ `neural-audio-codec.js`
- push 前 API 签对签（pub.dev），勿猜签名
