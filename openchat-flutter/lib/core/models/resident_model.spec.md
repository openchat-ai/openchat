# spec: Resident Models

> AI 居民/活动/动态流/子代摘要数据模型，含 fromJson 解析与 trait 标签

## 数据流

```
服务端 JSON
  → Resident.fromJson
      → 解析 traits (Map<key, double>)
      → 筛选 notable (>=0.7 或 <=0.3) → traitLabels
      → ResidentActivity.fromJson list → activities
  → UI 读取: resident.name, .traitLabels, .isActive, ...
```

## 接口签名

```dart
class ResidentActivity {
  final String id, type, message;
  final DateTime timestamp;
  final String? agentId, agentName, agentRole, task, summary;
  factory ResidentActivity.fromJson(Map<String, dynamic> json);
}

class Resident {
  final int id;
  final String name, status, home;
  final DateTime createdAt;
  final String? deletedAt;
  final int activityCount;
  final List<ResidentActivity> activities;
  // 家族字段
  final int? parentId;
  final String? parentName;
  final Map<String, double> traits;
  final int? sageId;
  List<String> get traitLabels;  // 偏向明显的特征
  bool get isActive;  // status == 'active'
  bool get isDeleted; // status == 'deleted'
  factory Resident.fromJson(Map<String, dynamic> json);
}

class FeedItem {
  final String id, type, message, residentName;
  final DateTime timestamp;
  final String? agentName, agentRole, task, summary;
  final int residentId;
  factory FeedItem.fromJson(Map<String, dynamic> json);
}

class ChildSummary {
  final int id, depth, activityCount;
  final String name, status;
  final DateTime createdAt;
  final Map<String, double> traits;
  bool get isActive;
  factory ChildSummary.fromJson(Map<String, dynamic> json);
}

const traitLabelMap = {
  'diligence':   '勤劳',
  'curiosity':   '好奇',
  'courage':     '勇敢',
  'sociability': '合群',
  'creativity':  '创造',
};
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| traits 缺字段 | traitLabels 返回空 list |
| activityCount 缺字段 | 默认为 0 |
| activities 缺字段 | 默认为 [] |
| status 既非 'active' 也非 'deleted' | isActive=false, isDeleted=false |
| 时间格式非法 | DateTime.parse 抛 FormatException |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `resident_model.dart` | Resident + traitLabelMap + traitLabels | 100 |
| `resident_activity.dart` | ResidentActivity 数据类 | 50 |
| `feed_item.dart` | FeedItem 数据类 | 50 |
| `child_summary.dart` | ChildSummary 数据类 | 60 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| - | - | - | 纯数据类，无日志 |

## 不变量（invariants）

```
// === invariants ===
// - 所有字段 final，不可变
// - traitLabels 与 fromJson 解析逻辑必须保持一致（>=0.7 强、<=0.3 弱）
// - status 字符串严格匹配 'active' / 'deleted' / 'sleeping'
```
