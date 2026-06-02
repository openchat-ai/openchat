# spec: AgentHubScreen

> AI 居民总览页：SDUI 列表 + 统计 + 创建/删除居民对话框

## 数据流

```
initState → 注入 SduiPageState mixin
build
  → ref.watch(residentProvider)
    → loading/error/data
      → data: 构造 items/stats → SduiParser(vars) → SDUI 布局
      → 无 SDUI: _buildFallbackList (无数据时 _buildEmptyState)
  → fab: _buildCreateButton → _showCreateDialog
  → 列表中 onAction 'navigate:ID' → ResidentDetailScreen
  → onAction 'delete:ID' → _confirmDelete
```

## 接口签名

```dart
class AgentHubScreen extends ConsumerStatefulWidget {
  const AgentHubScreen();
}

class _AgentHubScreenState extends ConsumerState<AgentHubScreen> with SduiPageState {
  String get sduiPage => 'agent';
  Widget build(BuildContext context);
  // 内部:
  void _showCreateDialog(BuildContext, AppTheme);
  void _confirmDelete(BuildContext, Resident);
  int _daysSince(DateTime);
  Widget _buildEmptyState(AppTheme, Map?);
  Widget _buildActionButton(IconData, AppTheme, VoidCallback);
  Widget _buildFallbackList(AppTheme, List<Resident>);
  Widget _buildCreateButton(AppTheme);
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| residentProvider loading | 走 CircularProgressIndicator |
| residentProvider error | 走 _buildEmptyState (sduiLayout.errorState) |
| residents 为空 | _buildFallbackList 内 _buildEmptyState |
| create name 为空 | provider 自动命名（保留 null） |
| 列表中点击 "navigate:ID" | push ResidentDetailScreen |
| 列表中点击 "delete:ID" | 二次确认后 provider.delete |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `agent_hub_screen.dart` | 主屏（state + build + 创建/删除 dialog） | 130 |
| `resident_fallback_list.dart` | 硬编码 fallback 列表 + 卡片 | 50 |
| `agent_hub_widgets.dart` | 共享小部件：_buildActionButton, _buildEmptyState | 60 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C-A1 | sdui load page=agent | sdui_config.dart | 加载 agent 布局 |

## 不变量（invariants）

```
// === invariants ===
// - residentProvider 单一来源，UI 不持有本地 list
// - SDUI 失败时 fallback 必须能独立运行（不依赖 sduiLayout）
// - create/delete 后 UI 自动 rebuild（provider 触发）
```
