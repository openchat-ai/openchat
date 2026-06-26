# spec: AgentPageScreen
> Agent 页: LLM tool-loop 对话 + slash 命令。用 /api/v1/agent/chat 跟桥通信。

## 数据流
```
输入框 → _send() → / 开头? → _runLocalSlash(HTTP 调 bridge) / 否则 agentChat(HTTP POST /api/v1/agent/chat) → _messages 追加 → UI 渲染
```

## 接口签名
```dart
class AgentPageScreen extends ConsumerStatefulWidget;
Future<String> _client.agentChat(text, chatId, role);
Future<String> _client.status();
Future<String> _client.projects();
Future<List<ExperimentInfo>> _client.list();
Future<Map<String, dynamic>> _client.run(id, inputs);
```

## 边界条件
| 条件 | 预期行为 |
|------|---------|
| 输入为空 | _send 直接 return |
| 网络错误 | catch → messages 追加 [error] |
| 未知 slash | default: 'unknown slash' |
| 并发发送 | _busy 标志位禁止 |

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `screen_agent_page.dart` | Agent 对话 UI + slash | 250 |

## 调试检查点
| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| - | - | - | - |

## 不变量
```
// === invariants ===
// - _busy 为 true 时禁用输入和发送
// - slash 命令本地解析,不走 LLM 避免误解
```
