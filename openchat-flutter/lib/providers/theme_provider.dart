import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/theme/app_theme.dart';

// 主题模式：自动/手动
enum ThemeModeSetting {
  auto,    // 跟随系统
  light,   // 强制浅色
  dark,    // 强制深色
  manual,  // 手动选择主题
}

// 主题模式状态
final themeModeProvider = StateProvider<ThemeModeSetting>((ref) => ThemeModeSetting.manual);

// 当前选中的主题索引（手动模式下使用）
final currentThemeIndexProvider = StateProvider<int>((ref) => 0);

// 系统主题监听
final systemBrightnessProvider = StateProvider<Brightness>((ref) => Brightness.light);

// 是否是深色模式（根据设置和系统状态计算）
final isDarkModeProvider = Provider<bool>((ref) {
  final themeMode = ref.watch(themeModeProvider);
  final systemBrightness = ref.watch(systemBrightnessProvider);
  
  switch (themeMode) {
    case ThemeModeSetting.auto:
      return systemBrightness == Brightness.dark;
    case ThemeModeSetting.dark:
      return true;
    case ThemeModeSetting.light:
    case ThemeModeSetting.manual:
      return false;
  }
});

// 当前主题（根据模式返回对应的主题）
final currentThemeProvider = Provider<AppTheme>((ref) {
  final themeMode = ref.watch(themeModeProvider);
  final themeIndex = ref.watch(currentThemeIndexProvider);
  final isDarkMode = ref.watch(isDarkModeProvider);
  
  // 自动/浅色/深色模式
  if (themeMode == ThemeModeSetting.auto || 
      themeMode == ThemeModeSetting.dark ||
      themeMode == ThemeModeSetting.light) {
    return isDarkMode ? AppTheme.glassmorphism : AppTheme.minimalZen;
  }

  return AppTheme.all[themeIndex];
});

ThemeData buildThemeData(AppTheme theme) {
  final isDark = theme.background.computeLuminance() < 0.5;
  
  return ThemeData(
    useMaterial3: true,
    brightness: isDark ? Brightness.dark : Brightness.light,
    scaffoldBackgroundColor: theme.background,
    primaryColor: theme.primary,
    colorScheme: ColorScheme(
      brightness: isDark ? Brightness.dark : Brightness.light,
      primary: theme.primary,
      secondary: theme.secondary,
      surface: theme.surface,
      error: theme.error,
      onPrimary: theme.textPrimary,
      onSecondary: theme.textPrimary,
      onSurface: theme.textPrimary,
      onError: Colors.white,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.bold,
        color: theme.textPrimary,
        letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 1,
      ),
      iconTheme: IconThemeData(color: theme.textSecondary),
    ),
    cardTheme: CardThemeData(
      color: theme.surface.withValues(alpha: 0.5),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(theme.radiusMedium),
      ),
    ),
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: Colors.transparent,
      elevation: 0,
      type: BottomNavigationBarType.fixed,
      selectedItemColor: theme.primary,
      unselectedItemColor: theme.textTertiary,
    ),
    textTheme: TextTheme(
      headlineLarge: TextStyle(
        fontSize: 32,
        fontWeight: FontWeight.bold,
        color: theme.textPrimary,
        letterSpacing: -0.5,
      ),
      headlineMedium: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w600,
        color: theme.textPrimary,
      ),
      bodyLarge: TextStyle(
        fontSize: 16,
        color: theme.textPrimary,
      ),
      bodyMedium: TextStyle(
        fontSize: 14,
        color: theme.textSecondary,
      ),
      bodySmall: TextStyle(
        fontSize: 12,
        color: theme.textTertiary,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: theme.surface.withValues(alpha: 0.5),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        borderSide: BorderSide.none,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    ),
  );
}
