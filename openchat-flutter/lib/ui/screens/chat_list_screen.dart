import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../components/cards/app_cards.dart';

class ChatListScreen extends ConsumerWidget {
  const ChatListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'MESSAGES',
          style: TextStyle(
            color: theme.textPrimary,
            fontSize: 24,
            fontWeight: FontWeight.bold,
            letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 2,
          ),
        ),
        actions: [
          _buildActionButton(Icons.edit_square, theme),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [theme.background, theme.surface],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: 12,
            itemBuilder: (context, index) => _buildMessageCard(index, theme),
          ),
        ),
      ),
    );
  }

  Widget _buildActionButton(IconData icon, AppTheme theme) {
    return Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        border: Border.all(
          color: theme.textTertiary.withValues(alpha: 0.1),
          width: 1,
        ),
      ),
      child: Icon(icon, color: theme.textSecondary, size: 20),
    );
  }

  Widget _buildMessageCard(int index, AppTheme theme) {
    final isUnread = index % 3 == 0;
    final time = '${10 + index}:${(index * 7) % 60}'.padLeft(5, '0');

    return ListCard(
      leading: const Icon(Icons.person, color: Colors.white, size: 24),
      leadingColor: theme.gradientPrimary[0],
      title: '用户 ${index + 1}',
      subtitle: '这是最新消息的内容预览，显示最近的一条消息..',
      onTap: () {},
      showDivider: index < 11,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            time,
            style: TextStyle(
              color: theme.textTertiary,
              fontSize: 11,
            ),
          ),
          if (isUnread) ...[
            const SizedBox(width: 10),
            Container(
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: theme.gradientAccent),
                borderRadius: BorderRadius.circular(10),
                boxShadow: theme.useGlow ? [
                  BoxShadow(
                    color: theme.accent.withValues(alpha: 0.5),
                    blurRadius: 10,
                    spreadRadius: 1,
                  ),
                ] : null,
              ),
              child: const Center(
                child: Text(
                  '2',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
