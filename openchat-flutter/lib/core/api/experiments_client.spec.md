# spec: ExperimentsClient
> Bridge /api/v1/experiments + /agent/chat + /projects + /status 的 HTTP 客户端

## 数据流
```
Flutter UI → ExperimentsClient.method() → Dio GET/POST → Bridge /api/v1/* → JSON response → 解析返回
```

## 接口签名
```dart
Future<List<ExperimentInfo>> list();
Future<Map<String, dynamic>> run(String id, {Map<String, dynamic>? inputs, Map<String, dynamic>? deps});
Future<String> agentChat(String text, {String chatId, String? role, List<String>? tools});
Future<String> projects();
Future<String> status();
```

## 边界条件
| 条件 | 预期行为 |
|------|---------|
| 网络断开 | Dio 抛异常,调用方 catch |
| Bridge 离线 | 连接超时 10s |
| 响应格式不符 | ?/?? null-safe fallback |

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `experiments_client.dart` | API 客户端 | 100 |

## 调试检查点
| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| - | - | - | - |

## 不变量
```
// === invariants ===
// - 所有 HTTP 调用通过 Dio 实例
// - 无自动重试逻辑
```
