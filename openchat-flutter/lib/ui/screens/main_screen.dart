import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui_config.dart';
import 'home_screen.dart';
import 'agent_hub_screen.dart';
import 'people_screen.dart';
import 'voice_room_screen.dart';
import 'chat_list_screen.dart';
import 'dev_ide_screen.dart';
import 'settings_screen.dart';

final bottomNavIndexProvider = StateProvider<int>((ref) => 0);

class MainScreen extends ConsumerStatefulWidget {
  const MainScreen({super.key});

  @override
  ConsumerState<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends ConsumerState<MainScreen> {
  Map<String, dynamic>? _sduiLayout;

  @override
  void initState() {
    super.initState();
    SduiConfig.load('main').then((m) { if (mounted) setState(() => _sduiLayout = m); });
  }

  Widget _buildScreen(String name) {
    switch (name) {
      case 'home': return const HomeScreen();
      case 'agent': return const AgentHubScreen();
      case 'people': return const PeopleScreen();
      case 'chat': return const ChatListScreen();
      case 'dev': return const DevIdeScreen();
      case 'settings': return const SettingsScreen();
      default: return Center(child: Text('Unknown: $name'));
    }
  }

  ({IconData inactive, IconData active}) _resolveIcon(String name) {
    switch (name) {
      case 'home': return (inactive: Icons.home_outlined, active: Icons.home_rounded);
      case 'agent': return (inactive: Icons.psychology_outlined, active: Icons.psychology_rounded);
      case 'people': return (inactive: Icons.people_outline, active: Icons.people_rounded);
      case 'chat': return (inactive: Icons.chat_bubble_outline, active: Icons.chat_bubble_rounded);
      case 'dev': return (inactive: Icons.code_outlined, active: Icons.code_rounded);
      case 'settings': return (inactive: Icons.person_outline, active: Icons.person_rounded);
      default: return (inactive: Icons.circle_outlined, active: Icons.circle_rounded);
    }
  }

  static const _fallbackTabs = [
    {'icon': 'home', 'label': '首页', 'screen': 'home'},
    {'icon': 'agent', 'label': 'Agent', 'screen': 'agent'},
    {'icon': 'people', 'label': '好友', 'screen': 'people'},
    {'icon': 'chat', 'label': '聊天', 'screen': 'chat'},
    {'icon': 'dev', 'label': '控制台', 'screen': 'dev'},
    {'icon': 'settings', 'label': '我的', 'screen': 'settings'},
  ];

  List<Map<String, dynamic>> _getTabs() {
    final raw = _sduiLayout?['tabs'];
    if (raw is List && raw.isNotEmpty) return raw.cast<Map<String, dynamic>>();
    return _fallbackTabs;
  }

  @override
  Widget build(BuildContext context) {
    final currentIndex = ref.watch(bottomNavIndexProvider);
    final theme = ref.watch(currentThemeProvider);
    final tabs = _getTabs();
    final clampedIndex = currentIndex.clamp(0, tabs.length - 1);
    final fab = _sduiLayout?['fab'] as Map? ?? {};
    final fabIcon = fab['icon'] as String? ?? 'palette';
    final fabAction = fab['action'] as String? ?? 'theme';

    return Scaffold(
      extendBody: true,
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      body: IndexedStack(
        index: clampedIndex,
        children: tabs.map((t) => _buildScreen(t['screen'] as String? ?? 'home')).toList(),
      ),
      bottomNavigationBar: _buildBottomNav(context, clampedIndex, theme, tabs),
      floatingActionButton: fab['hidden'] == true ? null : FloatingActionButton(
        onPressed: () {
          if (fabAction == 'theme') Navigator.pushNamed(context, '/theme');
          else if (fabAction.startsWith('navigate:')) Navigator.pushNamed(context, fabAction.substring(9));
        },
        backgroundColor: _hexColor(fab['color']) ?? theme.primary,
        child: Icon(_fabIcon(fabIcon), color: Colors.white),
      ),
    );
  }

  IconData _fabIcon(String name) {
    switch (name) {
      case 'palette': return Icons.palette;
      case 'add': return Icons.add;
      case 'settings': return Icons.settings;
      case 'person': return Icons.person;
      default: return Icons.palette;
    }
  }

  Color? _hexColor(String? s) {
    if (s == null) return null;
    return Color(int.parse(s.replaceAll('#', '0xFF')));
  }

  Widget _buildBottomNav(BuildContext context, int currentIndex, AppTheme theme, List<Map<String, dynamic>> tabs) {
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(32),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1),
        boxShadow: theme.shadows,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: tabs.asMap().entries.map((entry) {
            final index = entry.key;
            final item = entry.value;
            final iconName = item['icon'] as String? ?? 'home';
            final label = item['label'] as String? ?? '';
            final icons = _resolveIcon(iconName);
            final isSelected = index == currentIndex;
            return GestureDetector(
              onTap: () => ref.read(bottomNavIndexProvider.notifier).state = index,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOutBack,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  gradient: isSelected ? LinearGradient(colors: theme.gradientPrimary) : null,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: isSelected ? [BoxShadow(color: theme.primary.withValues(alpha: 0.4), blurRadius: 20, spreadRadius: 2)] : null,
                ),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  AnimatedScale(scale: isSelected ? 1.2 : 1.0, duration: const Duration(milliseconds: 200),
                    child: Icon(isSelected ? icons.active : icons.inactive, color: isSelected ? Colors.white : theme.textTertiary, size: 22)),
                  const SizedBox(height: 4),
                  Text(label, style: TextStyle(color: isSelected ? Colors.white : theme.textTertiary, fontSize: 9, fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal)),
                ]),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}
