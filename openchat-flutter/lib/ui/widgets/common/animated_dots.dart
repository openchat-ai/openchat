// animated_dots.dart — pulsing 3-dot loading indicator
//
// Usage:  AnimatedDots(color: theme.textTertiary)

import 'package:flutter/material.dart';

class AnimatedDots extends StatefulWidget {
  final Color color;
  final double size;
  const AnimatedDots({super.key, required this.color, this.size = 5});

  @override
  State<AnimatedDots> createState() => _AnimatedDotsState();
}

class _AnimatedDotsState extends State<AnimatedDots> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  // === invariants ===
  // - _c.repeat() 永不调用 stop(); dispose 才释放
  // - 3 个点相位差 0.18, 周期 1.2s → 永远不全部同时暗
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            final phase = (_c.value - i * 0.18);
            final t = phase < 0 ? phase + 1 : (phase > 1 ? phase - 1 : phase);
            final alpha = (t < 0.5 ? t * 2 : (1 - t) * 2).clamp(0.2, 1.0);
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 1),
              child: Container(
                width: widget.size,
                height: widget.size,
                decoration: BoxDecoration(
                  color: widget.color.withValues(alpha: alpha),
                  shape: BoxShape.circle,
                ),
              ),
            );
          }),
        );
      },
    );
  }
}
