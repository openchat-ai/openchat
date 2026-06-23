# spec: epc.dart (Flutter)
> EPC binary frame parser/encoder, mirrors provider-kit/bridge EPC codec.

## 数据流
input:  Uint8List (raw bytes from Qiniu or local build)
output: List<EpcFrame> for decode, Uint8List for encode
  - parseLlmReply: Map {content, reasoning_content, error, meta}

## 接口签名
- Epc.decode(Uint8List) → List<EpcFrame>
- Epc.encodeFrame(int type, int sub, Uint8List payload) → Uint8List
- Epc.parseLlmReply(Uint8List) → Map<String, dynamic>
- Epc.encodeChatMessage(Map) → Uint8List  (0x00 0xDD + JSON)
- Epc.encodeLlmReply({content, reasoningContent, meta, error}) → Uint8List  (multi-frame concat)

## 边界条件
- 不完整帧跳过（plen overflow 退出）
- 损坏 payload: utf8 allowMalformed, 返回 partial text
- checksum: decode 跳过校验（写入端算 CS，读端不强制）
- 0 长度 buf: 返回空 list, 不抛

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| lib/core/protocol/epc.dart | 解析+编码 EPC 帧 | 200 |

## 调试检查点
| C | 触发 | 预期 |
|---|------|------|
| 1 | 收到 -reply.epc 解析失败 | Epc.parseLlmReply 返回空 Map, 上层走 fallback |

## 不变量
- decode 不校验 checksum（写入端算 CS，读端跳过）
- encodeFrame 必算 CS (XOR over bytes 1..N-2)
- 解析帧时 type!=TYPE_LLM 的帧跳过（用 parseLlmReply 时）
