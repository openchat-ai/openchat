import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';

class SettingsThemePreview extends ConsumerWidget {
  final AppTheme previewTheme;
  final String name;

  const SettingsThemePreview({
    super.key,
    required this.previewTheme,
    required this.name,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentTheme = ref.watch(currentThemeProvider);
    final sel = previewTheme.style == currentTheme.style;
    final idx = AppTheme.all.indexWhere((t) => t.style == previewTheme.style);
    return GestureDetector(
      onTap: () { if (idx >= 0) ref.read(currentThemeIndexProvider.notifier).state = idx; },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200), padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: sel ? previewTheme.gradientPrimary[0].withValues(alpha: 0.1) : currentTheme.background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: sel ? previewTheme.gradientPrimary[0] : currentTheme.textTertiary.withValues(alpha: 0.2),
            width: sel ? 2 : 1)),
        child: Row(children: [
          Row(children: [
            _colorDot(previewTheme.gradientPrimary[0]),
            _colorDot(previewTheme.gradientPrimary[1]),
            _colorDot(previewTheme.accent),
          ]),
          const SizedBox(width: 12),
          Expanded(child: Text(name, style: TextStyle(color: currentTheme.textPrimary, fontSize: 13,
            fontWeight: sel ? FontWeight.w600 : FontWeight.normal))),
          if (sel) Icon(Icons.check_circle, color: previewTheme.gradientPrimary[0], size: 20),
        ]),
      ),
    );
  }

  Widget _colorDot(Color c) => Container(
    margin: const EdgeInsets.only(right: 4), width: 16, height: 16,
    decoration: BoxDecoration(color: c, shape: BoxShape.circle,
      border: Border.all(color: Colors.white.withValues(alpha: 0.2), width: 1)),
  );
}
