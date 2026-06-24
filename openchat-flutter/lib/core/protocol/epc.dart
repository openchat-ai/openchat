// epc.dart — EPC binary frame parser/encoder (Flutter side)
//
// Wire format (aligned with provider-kit/bridge EPC):
//   [0xBB][type][sub][plen:3 BE][payload:plen][cs:1][0x7E]
//
// LLM frames (type=0x10):
//   0x10 CONTENT    — text body
//   0x11 THINKING   — reasoning/thinking content
//   0x14 ERROR      — error message
//   0x16 META       — JSON metadata (hash, tokens, etc.)
//
// Audio frames (type=0x12):
//   0x30 PCM_BATCH  — audio codec frame (handled by audio.dart)
//
// Chat-message frames (type=0x17):
//   0xF0 MSG        — outbound user message (raw text, no JSON)

import 'dart:convert';
import 'dart:typed_data';

class EpcFrame {
  final int type;
  final int sub;
  final Uint8List payload;
  const EpcFrame({required this.type, required this.sub, required this.payload});

  String get text => utf8.decode(payload, allowMalformed: true);
  @override
  String toString() => 'EpcFrame(t=0x${type.toRadixString(16)}, s=0x${sub.toRadixString(16)}, p=${payload.length}B)';
}

class Epc {
  static const int FRAME_START = 0xBB;
  static const int FRAME_END = 0x7E;

  static const int TYPE_CHAT = 0x17;
  static const int TYPE_LLM = 0x10;
  static const int TYPE_AUDIO = 0x12;

  static const int SUB_CHAT_MSG = 0xF0;

  static const int SUB_LLM_CONTENT = 0x10;
  static const int SUB_LLM_THINKING = 0x11;
  static const int SUB_LLM_TOOL_CALL = 0x12;
  static const int SUB_LLM_ERROR = 0x14;
  static const int SUB_LLM_META = 0x16;

  // === invariants ===
  // - decode() 不校验 checksum (bridge 写入端算 CS, Flutter 读端跳过)
  // - 不完整帧会被跳过 (break on plen overflow)
  // - 解析后 sub==CONTENT 等键直接 utf8.decode, 损坏 payload 返回 partial text (allowMalformed)

  static List<EpcFrame> decode(Uint8List buf) {
    final out = <EpcFrame>[];
    int off = 0;
    while (off + 8 <= buf.length) {
      if (buf[off] != FRAME_START) { off++; continue; }
      final type = buf[off + 1];
      final sub = buf[off + 2];
      final plen = (buf[off + 3] << 16) | (buf[off + 4] << 8) | buf[off + 5];
      if (off + 6 + plen + 2 > buf.length) break;
      if (buf[off + 6 + plen + 1] != FRAME_END) { off++; continue; }
      out.add(EpcFrame(
        type: type,
        sub: sub,
        payload: Uint8List.sublistView(buf, off + 6, off + 6 + plen),
      ));
      off += 6 + plen + 2;
    }
    return out;
  }

  static Uint8List encodeFrame(int type, int sub, Uint8List payload) {
    final frame = Uint8List(6 + payload.length + 2);
    int off = 0;
    frame[off++] = FRAME_START;
    frame[off++] = type;
    frame[off++] = sub;
    frame[off++] = (payload.length >> 16) & 0xFF;
    frame[off++] = (payload.length >> 8) & 0xFF;
    frame[off++] = payload.length & 0xFF;
    frame.setRange(off, off + payload.length, payload);
    off += payload.length;
    int cs = 0;
    for (int i = 1; i < off; i++) cs ^= frame[i];
    frame[off++] = cs;
    frame[off++] = FRAME_END;
    return frame.sublist(0, off);
  }

  // LLM 解析: 把 EPC 帧转成 {content, reasoning_content, error, meta}
  // frames 按顺序拼接（多帧流式场景 critical）
  static Map<String, dynamic> parseLlmReply(Uint8List buf) {
    final out = <String, dynamic>{};
    final contentParts = <String>[];
    final reasoningParts = <String>[];
    for (final f in decode(buf)) {
      if (f.type != TYPE_LLM) continue;
      switch (f.sub) {
        case SUB_LLM_CONTENT: contentParts.add(f.text); break;
        case SUB_LLM_THINKING: reasoningParts.add(f.text); break;
        case SUB_LLM_ERROR: out['error'] = f.text; break;
        case SUB_LLM_META:
          try { out['meta'] = jsonDecode(f.text) as Map<String, dynamic>; } catch (_) {}
          break;
      }
    }
    if (contentParts.isNotEmpty) out['content'] = contentParts.join();
    if (reasoningParts.isNotEmpty) out['reasoning_content'] = reasoningParts.join();
    return out;
  }

  // 用户消息封装: EPC(0x17 0xF0) + raw text payload (无 JSON)
  static Uint8List encodeChatMessage(String text) {
    final payload = Uint8List.fromList(utf8.encode(text));
    return encodeFrame(TYPE_CHAT, SUB_CHAT_MSG, payload);
  }

  // LLM 响应封装: 多帧拼接 (thinking + content + meta)
  static Uint8List encodeLlmReply({String? content, String? reasoningContent, Map<String, dynamic>? meta, String? error}) {
    final parts = <Uint8List>[];
    if (reasoningContent != null && reasoningContent.isNotEmpty) {
      parts.add(encodeFrame(TYPE_LLM, SUB_LLM_THINKING, Uint8List.fromList(utf8.encode(reasoningContent))));
    }
    if (content != null && content.isNotEmpty) {
      parts.add(encodeFrame(TYPE_LLM, SUB_LLM_CONTENT, Uint8List.fromList(utf8.encode(content))));
    }
    if (meta != null && meta.isNotEmpty) {
      parts.add(encodeFrame(TYPE_LLM, SUB_LLM_META, Uint8List.fromList(utf8.encode(jsonEncode(meta)))));
    }
    if (error != null && error.isNotEmpty) {
      parts.add(encodeFrame(TYPE_LLM, SUB_LLM_ERROR, Uint8List.fromList(utf8.encode(error))));
    }
    if (parts.isEmpty) return Uint8List(0);
    final total = parts.fold<int>(0, (s, p) => s + p.length);
    final out = Uint8List(total);
    int off = 0;
    for (final p in parts) { out.setRange(off, off + p.length, p); off += p.length; }
    return out;
  }
}
