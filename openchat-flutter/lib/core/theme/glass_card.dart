import 'dart:ui';
import 'package:flutter/material.dart';
import 'glass_constants.dart';

class GlassCard extends StatelessWidget {
  final Widget child;
  final double? width;
  final double? height;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final BorderRadius? borderRadius;
  final List<Color>? gradientColors;
  final double opacity;
  final bool hasBorder;
  final bool hasGlow;
  final BoxShadow? glowEffect;
  final VoidCallback? onTap;

  const GlassCard({
    super.key,
    required this.child,
    this.width,
    this.height,
    this.padding,
    this.margin,
    this.borderRadius,
    this.gradientColors,
    this.opacity = glassOpacity,
    this.hasBorder = true,
    this.hasGlow = false,
    this.glowEffect,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Widget card = Container(
      width: width,
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        borderRadius: borderRadius ?? BorderRadius.circular(glassBorderRadius),
        boxShadow: hasGlow ? [glowEffect ?? glowCyan] : null,
      ),
      child: ClipRRect(
        borderRadius: borderRadius ?? BorderRadius.circular(glassBorderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: glassBlur, sigmaY: glassBlur),
          child: Container(
            padding: padding ?? const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: gradientColors != null
                ? LinearGradient(
                    colors: gradientColors!.map((c) => c.withValues(alpha: opacity)).toList(),
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : LinearGradient(
                    colors: [
                      Colors.white.withValues(alpha: opacity),
                      Colors.white.withValues(alpha: opacity * 0.5),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
              borderRadius: borderRadius ?? BorderRadius.circular(glassBorderRadius),
              border: hasBorder ? Border.all(
                color: Colors.white.withValues(alpha: 0.1),
                width: 1,
              ) : null,
            ),
            child: child,
          ),
        ),
      ),
    );
    if (onTap != null) {
      card = GestureDetector(
        onTap: onTap,
        child: AnimatedScale(
          scale: 1.0,
          duration: const Duration(milliseconds: 150),
          child: card,
        ),
      );
    }
    return card;
  }
}
