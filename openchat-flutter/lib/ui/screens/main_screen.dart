import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import 'home_screen.dart';
import 'agent_hub_screen.dart';
import 'voice_room_screen.dart';
import 'chat_list_screen.dart';
import 'settings_screen.dart';

final bottomNavIndexProvider = StateProvider<int>((ref) => 0);

class MainScreen extends ConsumerWidget {
  const MainScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentIndex = ref.watch(bottomNavIndexProvider);
    final theme = ref.watch(currentThemeProvider);

    return Scaffold(
      extendBody: true,
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      body: IndexedStack(
        index: currentIndex,
        children: const [
          HomeScreen(),
          AgentHubScreen(),
          VoiceRoomScreen(),
          ChatListScreen(),
          SettingsScreen(),
        ],
      ),
      bottomNavigationBar: _buildBottomNav(context, ref, currentIndex, theme),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.pushNamed(context, '/theme'),
        backgroundColor: theme.primary,
        child: const Icon(Icons.palette, color: Colors.white),
      ),
    );
  }

  Widget _buildBottomNav(BuildContext context, WidgetRef ref, int currentIndex, AppTheme theme) {
    final items = [
      _NavItem(Icons.home_outlined, Icons.home_rounded, '首页'),
      _NavItem(Icons.psychology_outlined, Icons.psychology_rounded, 'Agent'),
      _NavItem(Icons.videocam_outlined, Icons.videocam_rounded, '房间'),
      _NavItem(Icons.chat_bubble_outline, Icons.chat_bubble_rounded, '聊天'),
      _NavItem(Icons.person_outline, Icons.person_rounded, '我的'),
    ];

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(32),
        border: Border.all(
          color: theme.textTertiary.withValues(alpha: 0.1),
          width: 1,
        ),
        boxShadow: theme.shadows,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: items.asMap().entries.map((entry) {
            final index = entry.key;
            final item = entry.value;
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
                  boxShadow: isSelected ? [
                    BoxShadow(
                      color: theme.primary.withValues(alpha: 0.4),
                      blurRadius: 20,
                      spreadRadius: 2,
                    ),
                  ] : null,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    AnimatedScale(
                      scale: isSelected ? 1.2 : 1.0,
                      duration: const Duration(milliseconds: 200),
                      child: Icon(
                        isSelected ? item.activeIcon : item.icon,
                        color: isSelected ? Colors.white : theme.textTertiary,
                        size: 22,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.label,
                      style: TextStyle(
                        color: isSelected ? Colors.white : theme.textTertiary,
                        fontSize: 9,
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
    );
  }
}

class _NavItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  
  _NavItem(this.icon, this.activeIcon, this.label);
}
