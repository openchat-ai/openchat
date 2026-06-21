import 'dart:ui';
import 'package:flutter/material.dart';

/// ===== glass_constants.dart =====
const Color backgroundDark = Color(0xFF0A0A0F);
const Color backgroundCard = Color(0xFF12121A);
const Color backgroundElevated = Color(0xFF1A1A25);

const Color neonCyan = Color(0xFF00F0FF);
const Color neonPurple = Color(0xFFB829F7);
const Color neonPink = Color(0xFFFF2E8C);
const Color neonBlue = Color(0xFF2979FF);
const Color neonGreen = Color(0xFF00E676);
const Color neonOrange = Color(0xFFFF9100);

const Color textPrimary = Color(0xFFFFFFFF);
const Color textSecondary = Color(0xFFB0B0C0);
const Color textTertiary = Color(0xFF707080);

const double glassOpacity = 0.12;
const double glassBlur = 20.0;
const double glassBorderRadius = 24.0;
const double glassBorderRadiusSmall = 16.0;

const LinearGradient gradientCyanPurple = LinearGradient(
  colors: [neonCyan, neonPurple],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

const LinearGradient gradientPinkBlue = LinearGradient(
  colors: [neonPink, neonBlue],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

const LinearGradient gradientMulti = LinearGradient(
  colors: [neonCyan, neonPurple, neonPink],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

final BoxShadow glowCyan = BoxShadow(
  color: neonCyan.withValues(alpha: 0.4),
  blurRadius: 20,
  spreadRadius: 2,
);

final BoxShadow glowPurple = BoxShadow(
  color: neonPurple.withValues(alpha: 0.4),
  blurRadius: 20,
  spreadRadius: 2,
);

final BoxShadow glowPink = BoxShadow(
  color: neonPink.withValues(alpha: 0.4),
  blurRadius: 20,
  spreadRadius: 2,
);

/// ===== app_theme.dart =====
enum ThemeStyle {
  glassmorphism,
  minimalZen,
  natureOrganic,
  retroWave,
  corporatePro,
}

class AppTheme {
  final ThemeStyle style;
  final String name;
  final String description;

  final Color background;
  final Color surface;
  final Color primary;
  final Color secondary;
  final Color accent;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;

  final Color success;
  final Color warning;
  final Color error;
  final Color info;

  final List<Color> gradientPrimary;
  final List<Color> gradientAccent;

  final double radiusSmall;
  final double radiusMedium;
  final double radiusLarge;

  final List<BoxShadow> shadows;

  final bool useGlassmorphism;
  final bool useGlow;
  final bool useNeon;
  final double? glassOpacity;
  final double? blurAmount;

  const AppTheme({
    required this.style,
    required this.name,
    required this.description,
    required this.background,
    required this.surface,
    required this.primary,
    required this.secondary,
    required this.accent,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.success,
    required this.warning,
    required this.error,
    required this.info,
    required this.gradientPrimary,
    required this.gradientAccent,
    this.radiusSmall = 8,
    this.radiusMedium = 16,
    this.radiusLarge = 24,
    required this.shadows,
    this.useGlassmorphism = false,
    this.useGlow = false,
    this.useNeon = false,
    this.glassOpacity,
    this.blurAmount,
  });

  static List<AppTheme> get all => [glassmorphism, minimalZen, natureOrganic, retroWave, corporatePro];

  static const AppTheme glassmorphism = AppTheme(
    style: ThemeStyle.glassmorphism,
    name: '赛博霓虹',
    description: 'Glassmorphism 3.0风格，霓虹光效与毛玻璃质感',
    background: Color(0xFF0A0A0F),
    surface: Color(0xFF12121A),
    primary: Color(0xFF00F0FF),
    secondary: Color(0xFFB829F7),
    accent: Color(0xFFFF2E8C),
    textPrimary: Colors.white,
    textSecondary: Color(0xFFB0B0C0),
    textTertiary: Color(0xFF707080),
    success: Color(0xFF00E676),
    warning: Color(0xFFFF9100),
    error: Color(0xFFFF2E8C),
    info: Color(0xFF2979FF),
    gradientPrimary: [Color(0xFF00F0FF), Color(0xFFB829F7)],
    gradientAccent: [Color(0xFFFF2E8C), Color(0xFF2979FF)],
    radiusSmall: 12,
    radiusMedium: 20,
    radiusLarge: 28,
    shadows: [BoxShadow(color: Color(0xFF00F0FF), blurRadius: 20, spreadRadius: -5, blurStyle: BlurStyle.normal)],
    useGlassmorphism: true,
    useGlow: true,
    useNeon: true,
    glassOpacity: 0.12,
    blurAmount: 20,
  );

  static const AppTheme minimalZen = AppTheme(
    style: ThemeStyle.minimalZen,
    name: '极简禅意',
    description: '日式极简美学，留白与克制',
    background: Color(0xFFFAFAF8),
    surface: Colors.white,
    primary: Color(0xFF2C2C2C),
    secondary: Color(0xFF8B8B8B),
    accent: Color(0xFFE85D4E),
    textPrimary: Color(0xFF1A1A1A),
    textSecondary: Color(0xFF666666),
    textTertiary: Color(0xFF999999),
    success: Color(0xFF4A7C59),
    warning: Color(0xFFD4A373),
    error: Color(0xFFE85D4E),
    info: Color(0xFF6B8E9F),
    gradientPrimary: [Color(0xFF2C2C2C), Color(0xFF4A4A4A)],
    gradientAccent: [Color(0xFFE85D4E), Color(0xFFF4A261)],
    radiusSmall: 4,
    radiusMedium: 8,
    radiusLarge: 12,
    shadows: [BoxShadow(color: Colors.black, blurRadius: 12, offset: Offset(0, 2), blurStyle: BlurStyle.normal)],
  );

  static const AppTheme natureOrganic = AppTheme(
    style: ThemeStyle.natureOrganic,
    name: '自然有机',
    description: '大地色系，有机曲线与自然灵感',
    background: Color(0xFFF5F1EB),
    surface: Color(0xFFFAF8F5),
    primary: Color(0xFF2D5A4A),
    secondary: Color(0xFF8B6F4E),
    accent: Color(0xFFD4A574),
    textPrimary: Color(0xFF2C2416),
    textSecondary: Color(0xFF5C4D3C),
    textTertiary: Color(0xFF8B7D6B),
    success: Color(0xFF5A8F6E),
    warning: Color(0xFFE6A94E),
    error: Color(0xFFC75B4B),
    info: Color(0xFF5A7A8C),
    gradientPrimary: [Color(0xFF2D5A4A), Color(0xFF4A7C6F)],
    gradientAccent: [Color(0xFFD4A574), Color(0xFFE8C9A0)],
    radiusSmall: 16,
    radiusMedium: 24,
    radiusLarge: 32,
    shadows: [BoxShadow(color: Color(0xFF2D5A4A), blurRadius: 16, offset: Offset(0, 4), blurStyle: BlurStyle.normal)],
  );

  static const AppTheme retroWave = AppTheme(
    style: ThemeStyle.retroWave,
    name: '复古蒸汽波',
    description: '80年代复古美学，粉色日落与霓虹网格',
    background: Color(0xFF1A0B2E),
    surface: Color(0xFF2D1B4E),
    primary: Color(0xFFFF71CE),
    secondary: Color(0xFF01CDFE),
    accent: Color(0xFF05FFA1),
    textPrimary: Color(0xFFFFE4F8),
    textSecondary: Color(0xFFB8A1C9),
    textTertiary: Color(0xFF7A6B8A),
    success: Color(0xFF05FFA1),
    warning: Color(0xFFFFE600),
    error: Color(0xFFFF3864),
    info: Color(0xFF01CDFE),
    gradientPrimary: [Color(0xFFFF71CE), Color(0xFF01CDFE)],
    gradientAccent: [Color(0xFFFF71CE), Color(0xFFFF3864)],
    radiusSmall: 0,
    radiusMedium: 4,
    radiusLarge: 8,
    shadows: [BoxShadow(color: Color(0xFFFF71CE), blurRadius: 20, spreadRadius: 2, blurStyle: BlurStyle.normal)],
    useGlow: true,
    useNeon: true,
  );

  static const AppTheme corporatePro = AppTheme(
    style: ThemeStyle.corporatePro,
    name: '商务专业',
    description: '深蓝商务风格，专业可信赖',
    background: Color(0xFF0F172A),
    surface: Color(0xFF1E293B),
    primary: Color(0xFF3B82F6),
    secondary: Color(0xFF64748B),
    accent: Color(0xFF10B981),
    textPrimary: Color(0xFFF1F5F9),
    textSecondary: Color(0xFF94A3B8),
    textTertiary: Color(0xFF64748B),
    success: Color(0xFF10B981),
    warning: Color(0xFFF59E0B),
    error: Color(0xFFEF4444),
    info: Color(0xFF3B82F6),
    gradientPrimary: [Color(0xFF3B82F6), Color(0xFF1D4ED8)],
    gradientAccent: [Color(0xFF10B981), Color(0xFF059669)],
    radiusSmall: 6,
    radiusMedium: 10,
    radiusLarge: 14,
    shadows: [BoxShadow(color: Colors.black, blurRadius: 12, offset: Offset(0, 4), blurStyle: BlurStyle.normal)],
  );
}

/// ===== floating_nav_bar.dart =====
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

class FloatingNavBar extends StatelessWidget {
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
              color: neonCyan.withValues(alpha: 0.2),
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
                        colors: [neonCyan.withValues(alpha: 0.3), neonPurple.withValues(alpha: 0.3)],
                      ) : null,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: isSelected ? [
                        BoxShadow(
                          color: neonCyan.withValues(alpha: 0.3),
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
                          color: isSelected ? neonCyan : textTertiary,
                          size: 24,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          item.label,
                          style: TextStyle(
                            color: isSelected ? neonCyan : textTertiary,
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

/// ===== fluid_button.dart =====
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
    this.gradientColors = const [neonCyan, neonPurple],
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

/// ===== glass_card.dart =====
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

/// ===== holographic_text.dart =====
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
    this.colors = const [neonCyan, neonPurple, neonPink],
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

/// ===== neon_border.dart =====
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
