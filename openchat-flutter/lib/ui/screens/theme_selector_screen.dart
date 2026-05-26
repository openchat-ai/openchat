import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';

class ThemeSelectorScreen extends ConsumerStatefulWidget {
  const ThemeSelectorScreen({super.key});
  @override
  ConsumerState<ThemeSelectorScreen> createState() => _ThemeSelectorScreenState();
}

class _ThemeSelectorScreenState extends ConsumerState<ThemeSelectorScreen> with SduiPageState {
  @override
  String get sduiPage => 'theme_selector';

  @override
  Widget build(BuildContext context) {
    final currentTheme = ref.watch(currentThemeProvider);
    final currentIndex = ref.watch(currentThemeIndexProvider);
    final themeList = AppTheme.all;
    final items = themeList.asMap().entries.map((e) => {
      'index': e.key.toString(),
      'name': e.value.name,
      'color': e.value.gradientPrimary.isNotEmpty ? '#${e.value.gradientPrimary[0].value.toRadixString(16).padLeft(8, '0').substring(2)}' : '#7C4DFF',
      'isSelected': (e.key == currentIndex).toString(),
    }).toList();

    final layout = {'type': 'column', 'children': <Map>[
      {'type': 'for_each', 'items': 'items', 'template': {
        'type': 'card', 'margin': 8, 'child': {
          'type': 'list_tile',
          'leadingIcon': 'check',
          'leadingIconColor': '{{isSelected == true ? color : #9E9E9E}}',
          'title': '{{name}}',
          'action': 'select_{{index}}',
        },
      }},
    ]};

    final parser = SduiParser(onAction: (a) {
      if (a.startsWith('select_')) {
        final idx = int.tryParse(a.substring(7)) ?? 0;
        ref.read(currentThemeIndexProvider.notifier).state = idx;
      }
    }, vars: {'items': items});

    return Scaffold(
      backgroundColor: currentTheme.background,
      appBar: AppBar(
        backgroundColor: currentTheme.surface,
        title: Text(sduiStr('title', '涓婚璁剧疆'), style: TextStyle(color: currentTheme.textPrimary)),
        leading: IconButton(icon: Icon(Icons.arrow_back, color: currentTheme.textPrimary), onPressed: () => Navigator.pop(context)),
      ),
      body: parser.parse(layout) ?? ListView.builder(
        padding: const EdgeInsets.all(16), itemCount: themeList.length,
        itemBuilder: (context, index) {
          final theme = themeList[index];
          final isSelected = index == currentIndex;
          return Card(margin: const EdgeInsets.only(bottom: 12), color: theme.surface, child: ListTile(
            leading: Container(width: 40, height: 40, decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary, begin: Alignment.topLeft, end: Alignment.bottomRight), borderRadius: BorderRadius.circular(8))),
            title: Text(theme.name, style: TextStyle(color: theme.textPrimary, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal)),
            subtitle: Text('${theme.gradientPrimary.length} colors', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
            trailing: isSelected ? Icon(Icons.check_circle, color: theme.success) : const SizedBox(),
            onTap: () => ref.read(currentThemeIndexProvider.notifier).state = index,
          ));
        },
      ),
    );
  }
}
