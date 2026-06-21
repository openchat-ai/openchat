import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../../core/sdui_config.dart';
import '../widgets/widgets.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> with SduiPageState {
  @override
  String get sduiPage => 'settings';

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final themeMode = ref.watch(themeModeProvider);
    if (sduiLayout['sections'] is List) {
      return SettingsSduiView(layout: sduiLayout, theme: theme, onAction: _handleAction);
    }
    return SettingsHardcodedView(theme: theme, themeMode: themeMode);
  }

  void _handleAction(String action) {
    if (action == 'theme') {
      Navigator.pushNamed(context, '/theme');
    } else if (action.startsWith('navigate:')) {
      Navigator.pushNamed(context, action.substring(9));
    }
  }
}
