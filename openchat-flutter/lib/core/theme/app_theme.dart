import 'package:flutter/material.dart';
import 'theme_presets.dart';

export 'theme_presets.dart';

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

  static List<AppTheme> get all => [
    glassmorphism,
    minimalZen,
    natureOrganic,
    retroWave,
    corporatePro,
  ];
}
