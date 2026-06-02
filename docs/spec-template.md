# spec: {FeatureName}

> 顶级模型（Opus/Claude）撰写此 spec，低级模型按 spec 翻译为代码。
> 修改代码后不同步更新 spec → git hook 拒绝。

## 数据流

```
{输入} → {处理步骤 1} → {步骤 2} → {输出}
```

## 接口签名

```dart
// 精确到类型和参数名，不含实现体
ReturnType methodName(ParamType param1, ParamType param2);
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 空输入 | |
| 最大值 | |
| 并发访问 | |
| 错误状态 | |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lib/.../foo.dart` | 负责 X | 100 |
| `lib/.../bar.dart` | 负责 Y | 80 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C{N} | `[C{N}]` | `file.dart:line` | ok 或 error 日志 |

## 不变量（invariants）

```
// === invariants ===
// - 规则 1
// - 规则 2
```
