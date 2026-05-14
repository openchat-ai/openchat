import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';

class ThemeSelectorScreen extends ConsumerWidget {
  const ThemeSelectorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentTheme = ref.watch(currentThemeProvider);
    final currentIndex = ref.watch(currentThemeIndexProvider);
    final themeList = AppTheme.all;

    return Scaffold(
      backgroundColor: currentTheme.background,
      appBar: AppBar(
        backgroundColor: currentTheme.surface,
        title: Text('主题设置', style: TextStyle(color: currentTheme.textPrimary)),
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: currentTheme.textPrimary),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: themeList.length,
        itemBuilder: (context, index) {
          final theme = themeList[index];
          final isSelected = index == currentIndex;

          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            color: theme.surface,
            child: ListTile(
              leading: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: theme.gradientPrimary,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              title: Text(
                theme.name,
                style: TextStyle(
                  color: theme.textPrimary,
                  fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                ),
              ),
              subtitle: Text(
                '${theme.gradientPrimary.length} colors',
                style: TextStyle(color: theme.textTertiary, fontSize: 12),
              ),
              trailing: isSelected
                  ? Icon(Icons.check_circle, color: theme.success)
                  : const SizedBox(),
              onTap: () {
                ref.read(currentThemeIndexProvider.notifier).state = index;
              },
            ),
          );
        },
      ),
    );
  }
}
