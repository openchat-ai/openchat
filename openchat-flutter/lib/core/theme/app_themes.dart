import 'package:flutter/material.dart';

enum AppThemeMode { modern, cyberpunk, neon, minimal, glassmorphism }

class AppTheme {
  final String name;
  final Color primaryColor;
  final Color accentColor;
  final Color backgroundColor;
  final Color cardColor;
  final Color textColor;
  final Color textSecondaryColor;
  final bool useGradient;
  final List<Color>? gradientColors;
  final double borderRadius;
  final bool showGlow;

  const AppTheme({
    required this.name,
    required this.primaryColor,
    required this.accentColor,
    required this.backgroundColor,
    required this.cardColor,
    required this.textColor,
    required this.textSecondaryColor,
    this.useGradient = false,
    this.gradientColors,
    this.borderRadius = 16,
    this.showGlow = false,
  });
}

class AppThemes {
  static const AppTheme modern = AppTheme(
    name: '现代简�?,
    primaryColor: Color(0xFF6366F1),
    accentColor: Color(0xFF8B5CF6),
    backgroundColor: Color(0xFFF8FAFC),
    cardColor: Colors.white,
    textColor: Color(0xFF1E293B),
    textSecondaryColor: Color(0xFF64748B),
    borderRadius: 16,
  );

  static const AppTheme cyberpunk = AppTheme(
    name: '赛博朋克',
    primaryColor: Color(0xFFFF00FF),
    accentColor: Color(0xFF00FFFF),
    backgroundColor: Color(0xFF0D0D1A),
    cardColor: Color(0xFF1A1A2E),
    textColor: Color(0xFFE0E0E0),
    textSecondaryColor: Color(0xFF888888),
    useGradient: true,
    gradientColors: [Color(0xFFFF00FF), Color(0xFF00FFFF)],
    borderRadius: 8,
    showGlow: true,
  );

  static const AppTheme neon = AppTheme(
    name: '霓虹炫彩',
    primaryColor: Color(0xFFFF6B6B),
    accentColor: Color(0xFF4ECDC4),
    backgroundColor: Color(0xFF1A1A2E),
    cardColor: Color(0xFF252542),
    textColor: Colors.white,
    textSecondaryColor: Color(0xFFB0B0B0),
    useGradient: true,
    gradientColors: [Color(0xFFFF6B6B), Color(0xFF4ECDC4)],
    borderRadius: 24,
    showGlow: true,
  );

  static const AppTheme minimal = AppTheme(
    name: '极致简�?,
    primaryColor: Colors.black,
    accentColor: Colors.grey,
    backgroundColor: Colors.white,
    cardColor: Color(0xFFF5F5F5),
    textColor: Colors.black,
    textSecondaryColor: Colors.grey,
    borderRadius: 0,
  );

  static const AppTheme glassmorphism = AppTheme(
    name: '毛玻�?,
    primaryColor: Color(0xFF667EEA),
    accentColor: Color(0xFF764BA2),
    backgroundColor: Color(0xFF1A1A2E),
    cardColor: Color(0x33FFFFFF),
    textColor: Colors.white,
    textSecondaryColor: Color(0xCCFFFFFF),
    useGradient: true,
    gradientColors: [Color(0xFF667EEA), Color(0xFF764BA2)],
    borderRadius: 24,
  );

  static List<AppTheme> get all => [modern, cyberpunk, neon, minimal, glassmorphism];
}
