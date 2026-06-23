# spec: animated_dots.dart
> Pulsing 3-dot loading indicator. Replaces static "thinking..." text.

## 数据流
input:  Color + optional size
output: Widget (Row of 3 Containers with phase-shifted alpha)

## 接口签名
- AnimatedDots({color, size=5}) → StatefulWidget

## 边界条件
- 父 dispose: _c 自动 dispose (State.dispose 链)
- 颜色透明: alpha 累乘, 视觉淡
- size 0: 容器不可见, 不崩

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| lib/ui/widgets/common/animated_dots.dart | 3 点相位动画 | 100 |

## 调试检查点
| C | 触发 | 预期 |
|---|------|------|
| 1 | 第一次 build | 3 点中等亮度, 渐变中 |

## 不变量
- _c.repeat() 永不 stop, dispose 才释放
- 3 点相位差 0.18, 周期 1.2s → 永远不全部同时暗
