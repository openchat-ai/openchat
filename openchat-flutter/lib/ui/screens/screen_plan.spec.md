# spec: PlanScreen
> Plan 页: 项目管理(DNA 项目列表) + goal 拆解执行。

## 数据流
```
init → _refresh() → GET /api/v1/projects → 显示
goal 输入 → _runGoal() → POST /api/v1/experiments/goal/run → 显示 output
```

## 接口签名
```dart
class PlanScreen extends ConsumerStatefulWidget;
Future<String> _client.projects();
Future<Map<String, dynamic>> _client.run('goal', inputs);
```

## 边界条件
| 条件 | 预期行为 |
|------|---------|
| 网络错误 | projects: '[error] $e'; goal: '[error] $e' |
| goal 为空 | _runGoal 直接 return |

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `screen_plan.dart` | Plan 页面 UI | 150 |

## 调试检查点
| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| - | - | - | - |

## 不变量
```
// === invariants ===
// - _loading 期间禁用操作按钮
```
