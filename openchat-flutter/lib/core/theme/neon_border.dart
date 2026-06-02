import 'package:flutter/material.dart';
import 'glass_constants.dart';

class NeonBorder extends StatelessWidget {
  final Widget child;
  final List<Color> colors;
  final double borderWidth;
  final double borderRadius;
  final bool animated;

  const NeonBorder({
    super.key,
    required this.child,
    required this.colors,
    this.borderWidth = 2,
    this.borderRadius = 24,
    this.animated = true,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(borderRadius),
        gradient: LinearGradient(colors: colors),
        boxShadow: colors.map((c) => BoxShadow(
          color: c.withValues(alpha: 0.5),
          blurRadius: 10,
          spreadRadius: 1,
        )).toList(),
      ),
      padding: EdgeInsets.all(borderWidth),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(borderRadius - borderWidth),
          color: backgroundCard,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(borderRadius - borderWidth),
          child: child,
        ),
      ),
    );
  }
}
