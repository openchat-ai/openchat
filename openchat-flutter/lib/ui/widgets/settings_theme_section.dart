import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import 'settings_theme_preview.dart';

class SettingsThemeSection extends ConsumerWidget {
  final AppTheme theme;
  final ThemeModeSetting themeMode;

  const SettingsThemeSection({
    super.key,
    required this.theme,
    required this.themeMode,
  });

  static const _modeLabels = {
    ThemeModeSetting.auto: '跟随系统',
    ThemeModeSetting.light: '浅色模式',
    ThemeModeSetting.dark: '深色模式',
    ThemeModeSetting.manual: '手动选择',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SliverToBoxAdapter(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
          child: Text('外观'.toUpperCase(), style: TextStyle(color: theme.textTertiary, fontSize: 11,
            fontWeight: FontWeight.w600, letterSpacing: 2)),
        ),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('主题模式', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: ThemeModeSetting.values.map((mode) {
              final sel = mode == themeMode;
              return GestureDetector(
                onTap: () => ref.read(themeModeProvider.notifier).state = mode,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    gradient: sel ? LinearGradient(colors: theme.gradientPrimary) : null,
                    color: sel ? null : theme.background,
                    borderRadius: BorderRadius.circular(20),
                    border: sel ? null : Border.all(color: theme.textTertiary.withValues(alpha: 0.2), width: 1),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(_modeIcon(mode), color: sel ? Colors.white : theme.textSecondary, size: 16),
                    const SizedBox(width: 6),
                    Text(_modeLabels[mode]!, style: TextStyle(
                      color: sel ? Colors.white : theme.textSecondary, fontSize: 12,
                      fontWeight: sel ? FontWeight.w600 : FontWeight.normal)),
                  ]),
                ),
              );
            }).toList()),
          ]),
        ),
        if (themeMode == ThemeModeSetting.manual) ...[
          const SizedBox(height: 12),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
              border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('选择主题', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
              const SizedBox(height: 12),
              for (final t in const [
                {'theme': AppTheme.glassmorphism, 'name': 'Glass'},
                {'theme': AppTheme.minimalZen, 'name': 'Zen'},
                {'theme': AppTheme.natureOrganic, 'name': 'Nature'},
                {'theme': AppTheme.retroWave, 'name': 'Retro'},
                {'theme': AppTheme.corporatePro, 'name': 'Corporate'},
              ]) ...[
                SettingsThemePreview(previewTheme: t['theme'] as AppTheme, name: t['name'] as String),
                const SizedBox(height: 8),
              ],
            ]),
          ),
        ],
        const SizedBox(height: 8),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.gradientPrimary[0].withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1)),
          child: Row(children: [
            Container(width: 40, height: 40,
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10))),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('当前主题', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
              const SizedBox(height: 2),
              Text(theme.name, style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w600)),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: theme.gradientPrimary[0].withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8)),
              child: Text(_modeLabels[themeMode]!, style: TextStyle(color: theme.gradientPrimary[0],
                fontSize: 11, fontWeight: FontWeight.w500)),
            ),
          ]),
        ),
      ]),
    );
  }

  IconData _modeIcon(ThemeModeSetting mode) {
    switch (mode) {
      case ThemeModeSetting.auto: return Icons.brightness_auto;
      case ThemeModeSetting.light: return Icons.brightness_5;
      case ThemeModeSetting.dark: return Icons.brightness_2;
      case ThemeModeSetting.manual: return Icons.palette_outlined;
    }
  }
}
