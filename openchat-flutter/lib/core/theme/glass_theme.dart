import 'package:flutter/material.dart';
import 'dart:ui';

class GlassTheme {
  // 核心色彩系统 - 赛博朋克暗色基底
  static const Color backgroundDark = Color(0xFF0A0A0F);
  static const Color backgroundCard = Color(0xFF12121A);
  static const Color backgroundElevated = Color(0xFF1A1A25);
  
  // 霓虹强调�?  static const Color neonCyan = Color(0xFF00F0FF);
  static const Color neonPurple = Color(0xFFB829F7);
  static const Color neonPink = Color(0xFFFF2E8C);
  static const Color neonBlue = Color(0xFF2979FF);
  static const Color neonGreen = Color(0xFF00E676);
  static const Color neonOrange = Color(0xFFFF9100);
  
  // 文字色彩
  static const Color textPrimary = Color(0xFFFFFFFF);
  static const Color textSecondary = Color(0xFFB0B0C0);
  static const Color textTertiary = Color(0xFF707080);
  
  // 玻璃效果配置
  static const double glassOpacity = 0.12;
  static const double glassBlur = 20.0;
  static const double borderRadius = 24.0;
  static const double borderRadiusSmall = 16.0;
  
  // 渐变预设
  static const LinearGradient gradientCyanPurple = LinearGradient(
    colors: [neonCyan, neonPurple],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
  
  static const LinearGradient gradientPinkBlue = LinearGradient(
    colors: [neonPink, neonBlue],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
  
  static const LinearGradient gradientMulti = LinearGradient(
    colors: [neonCyan, neonPurple, neonPink],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
  
  // 辉光效果
  static BoxShadow glowCyan = BoxShadow(
    color: neonCyan.withValues(alpha: 0.4),
    blurRadius: 20,
    spreadRadius: 2,
  );
  
  static BoxShadow glowPurple = BoxShadow(
    color: neonPurple.withValues(alpha: 0.4),
    blurRadius: 20,
    spreadRadius: 2,
  );
  
  static BoxShadow glowPink = BoxShadow(
    color: neonPink.withValues(alpha: 0.4),
    blurRadius: 20,
    spreadRadius: 2,
  );
}

// 玻璃卡片组件
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
    this.opacity = GlassTheme.glassOpacity,
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
        borderRadius: borderRadius ?? BorderRadius.circular(GlassTheme.borderRadius),
        boxShadow: hasGlow ? [glowEffect ?? GlassTheme.glowCyan] : null,
      ),
      child: ClipRRect(
        borderRadius: borderRadius ?? BorderRadius.circular(GlassTheme.borderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: GlassTheme.glassBlur, sigmaY: GlassTheme.glassBlur),
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
              borderRadius: borderRadius ?? BorderRadius.circular(GlassTheme.borderRadius),
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

// 霓虹边框组件
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
          color: GlassTheme.backgroundCard,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(borderRadius - borderWidth),
          child: child,
        ),
      ),
    );
  }
}

// 流体按钮
class FluidButton extends StatefulWidget {
  final Widget child;
  final VoidCallback onPressed;
  final List<Color> gradientColors;
  final double height;
  final bool isOutlined;
  
  const FluidButton({
    super.key,
    required this.child,
    required this.onPressed,
    this.gradientColors = const [GlassTheme.neonCyan, GlassTheme.neonPurple],
    this.height = 56,
    this.isOutlined = false,
  });
  
  @override
  State<FluidButton> createState() => _FluidButtonState();
}

class _FluidButtonState extends State<FluidButton> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _glowAnimation;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    )..repeat(reverse: true);
    _glowAnimation = Tween<double>(begin: 0.3, end: 0.6).animate(_controller);
  }
  
  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _glowAnimation,
      builder: (context, child) {
        return GestureDetector(
          onTap: widget.onPressed,
          child: Container(
            height: widget.height,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: widget.isOutlined ? null : LinearGradient(colors: widget.gradientColors),
              border: widget.isOutlined ? Border.all(
                color: widget.gradientColors[0],
                width: 2,
              ) : null,
              boxShadow: [
                BoxShadow(
                  color: widget.gradientColors[0].withValues(alpha: _glowAnimation.value),
                  blurRadius: 20,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: Center(
              child: DefaultTextStyle(
                style: TextStyle(
                  color: widget.isOutlined ? widget.gradientColors[0] : Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
                child: widget.child,
              ),
            ),
          ),
        );
      },
    );
  }
}

// 全息文字
class HolographicText extends StatelessWidget {
  final String text;
  final double fontSize;
  final FontWeight fontWeight;
  final List<Color> colors;
  
  const HolographicText({
    super.key,
    required this.text,
    this.fontSize = 24,
    this.fontWeight = FontWeight.bold,
    this.colors = const [GlassTheme.neonCyan, GlassTheme.neonPurple, GlassTheme.neonPink],
  });
  
  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      shaderCallback: (bounds) {
        return LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ).createShader(bounds);
      },
      child: Text(
        text,
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: fontWeight,
          color: Colors.white,
          letterSpacing: 1,
        ),
      ),
    );
  }
}

// 浮动导航�?class FloatingNavBar extends StatelessWidget {
  final int currentIndex;
  final Function(int) onTap;
  final List<NavItem> items;
  
  const FloatingNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    required this.items,
  });
  
  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        margin: const EdgeInsets.all(16),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(32),
          gradient: LinearGradient(
            colors: [
              Colors.white.withValues(alpha: 0.1),
              Colors.white.withValues(alpha: 0.05),
            ],
          ),
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.1),
            width: 1,
          ),
          boxShadow: [
            BoxShadow(
              color: GlassTheme.neonCyan.withValues(alpha: 0.2),
              blurRadius: 30,
              spreadRadius: -5,
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: items.asMap().entries.map((entry) {
                final index = entry.key;
                final item = entry.value;
                final isSelected = index == currentIndex;
                
                return GestureDetector(
                  onTap: () => onTap(index),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeInOut,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      gradient: isSelected ? LinearGradient(
                        colors: [GlassTheme.neonCyan.withValues(alpha: 0.3), GlassTheme.neonPurple.withValues(alpha: 0.3)],
                      ) : null,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: isSelected ? [
                        BoxShadow(
                          color: GlassTheme.neonCyan.withValues(alpha: 0.3),
                          blurRadius: 15,
                          spreadRadius: 1,
                        ),
                      ] : null,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          isSelected ? item.activeIcon : item.icon,
                          color: isSelected ? GlassTheme.neonCyan : GlassTheme.textTertiary,
                          size: 24,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item.label,
                          style: TextStyle(
                            color: isSelected ? GlassTheme.neonCyan : GlassTheme.textTertiary,
                            fontSize: 10,
                            fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ),
      ),
    );
  }
}

class NavItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  
  NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
  });
}
