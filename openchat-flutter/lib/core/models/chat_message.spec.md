# spec: chat_message.dart
> Typed chat message model, replaces Map<String, dynamic>.

## 数据流
input:  raw Map or JSON string
output: typed ChatMessage with enums (MessageSender, MessageType)

## 接口签名
- `ChatMessage({sender, type, text, time, ts, isError?, hash?, reasoning?, key?, isNew?})` const constructor
- `ChatMessage.copyWith({...})`  — immutable update
- `ChatMessage.toMap() / fromMap(Map)`  — Map round-trip
- `ChatMessage.toJson() / fromJson(String)`  — JSON round-trip
- getters: `isMe`, `isVoice`, `isText`

## 边界条件
- sender 不在枚举值: fromMap 默认 ai
- type 不在枚举值: fromMap 默认 text
- text/time 缺省: 默认空串
- ts 缺省: 当前毫秒
- optional 字段全 null-safe
- jsonDecode 失败: 调用方负责 catch (此处不抛)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| lib/core/models/chat_message.dart | typed model + JSON 转换 | 200 |

## 调试检查点
| C | 触发 | 预期 |
|---|------|------|
| 1 | 添加 ChatMessage 到 ListView | keyed by ts, isNew=true 触发 slide-in |

## 不变量
- sender 严格 'me'/'ai' (fromMap 强校验)
- type 严格 'text'/'voice' (fromMap 强校验)
- copyWith 不修改原对象
- toMap 仅写入非空 optional 字段
