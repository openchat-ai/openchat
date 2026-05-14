import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';

class VoiceRoomScreen extends ConsumerStatefulWidget {
  const VoiceRoomScreen({super.key});

  @override
  ConsumerState<VoiceRoomScreen> createState() => _VoiceRoomScreenState();
}

class _VoiceRoomScreenState extends ConsumerState<VoiceRoomScreen> {
  bool _isInRoom = false;
  bool _isMuted = false;

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'VOICE ROOM',
          style: TextStyle(
            color: theme.textPrimary,
            fontSize: 24,
            fontWeight: FontWeight.bold,
            letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 2,
          ),
        ),
        actions: [
          _buildActionButton(Icons.search_rounded, theme),
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
          child: _isInRoom ? _buildRoomView(theme) : _buildLobbyView(theme),
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

  Widget _buildLobbyView(AppTheme theme) {
    return Column(
      children: [
        _buildRoomCategories(theme),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: 6,
            itemBuilder: (context, index) => _buildRoomCard(index, theme),
          ),
        ),
      ],
    );
  }

  Widget _buildRoomCategories(AppTheme theme) {
    final categories = ['全部', '游戏', '音乐', '学习', '交友', 'K歌'];
    return Container(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (context, index) => const SizedBox(width: 10),
        itemBuilder: (context, index) {
          final isFirst = index == 0;
          return AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            decoration: BoxDecoration(
              gradient: isFirst ? LinearGradient(colors: theme.gradientAccent) : null,
              color: isFirst ? null : theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(18),
              border: isFirst ? null : Border.all(
                color: theme.textTertiary.withValues(alpha: 0.15),
                width: 1,
              ),
              boxShadow: isFirst && theme.useGlow ? [
                BoxShadow(
                  color: theme.accent.withValues(alpha: 0.4),
                  blurRadius: 15,
                  spreadRadius: 1,
                ),
              ] : null,
            ),
            child: Text(
              categories[index],
              style: TextStyle(
                color: isFirst ? Colors.white : theme.textSecondary,
                fontWeight: isFirst ? FontWeight.w600 : FontWeight.normal,
                fontSize: 13,
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildRoomCard(int index, AppTheme theme) {
    final memberCount = 12 + index * 3;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusLarge + 4),
        border: Border.all(
          color: theme.gradientPrimary[0].withValues(alpha: 0.3),
          width: 1,
        ),
        boxShadow: theme.useGlow ? [
          BoxShadow(
            color: theme.primary.withValues(alpha: 0.1),
            blurRadius: 30,
            spreadRadius: -5,
          ),
        ] : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: theme.gradientPrimary),
                  borderRadius: BorderRadius.circular(theme.radiusMedium - 4),
                  boxShadow: theme.useGlow ? [
                    BoxShadow(
                      color: theme.primary.withValues(alpha: 0.5),
                      blurRadius: 20,
                      spreadRadius: 2,
                    ),
                  ] : null,
                ),
                child: const Icon(
                  Icons.mic_rounded,
                  color: Colors.white,
                  size: 28,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '语音房间 ${index + 1}',
                      style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Icon(
                          Icons.people_outline,
                          color: theme.textTertiary,
                          size: 14,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '$memberCount 人在线',
                          style: TextStyle(
                            color: theme.textTertiary,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: theme.success.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            '进行中',
                            style: TextStyle(
                              color: theme.success,
                              fontSize: 10,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () => setState(() => _isInRoom = true),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: theme.gradientPrimary),
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: theme.useGlow ? [
                      BoxShadow(
                        color: theme.primary.withValues(alpha: 0.5),
                        blurRadius: 20,
                        spreadRadius: 2,
                      ),
                    ] : null,
                  ),
                  child: const Text(
                    '加入',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: List.generate(4, (i) => _buildAvatar(theme, i)),
          ),
        ],
      ),
    );
  }

  Widget _buildAvatar(AppTheme theme, int index) {
    return Container(
      margin: const EdgeInsets.only(right: 8),
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.gradientPrimary[0].withValues(alpha: 0.8),
            theme.gradientPrimary[1].withValues(alpha: 0.4),
          ],
        ),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      child: Center(
        child: Text(
          '${index + 1}',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildRoomView(AppTheme theme) {
    return Column(
      children: [
        Expanded(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 120,
                  height: 120,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: theme.gradientPrimary),
                    borderRadius: BorderRadius.circular(40),
                    boxShadow: theme.useGlow ? [
                      BoxShadow(
                        color: theme.primary.withValues(alpha: 0.5),
                        blurRadius: 40,
                        spreadRadius: 5,
                      ),
                    ] : null,
                  ),
                  child: const Icon(
                    Icons.mic_rounded,
                    color: Colors.white,
                    size: 48,
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  '正在语音中..',
                  style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '已连接 12 人',
                  style: TextStyle(
                    color: theme.textSecondary,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ),
        ),
        _buildRoomControls(theme),
      ],
    );
  }

  Widget _buildRoomControls(AppTheme theme) {
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusLarge),
        border: Border.all(
          color: theme.textTertiary.withValues(alpha: 0.1),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _buildControlButton(
            _isMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
            _isMuted ? theme.error : theme.primary,
            () => setState(() => _isMuted = !_isMuted),
          ),
          _buildControlButton(
            Icons.call_end_rounded,
            theme.error,
            () => setState(() => _isInRoom = false),
            isEndCall: true,
          ),
          _buildControlButton(
            Icons.more_vert_rounded,
            theme.textSecondary,
            () {},
          ),
        ],
      ),
    );
  }

  Widget _buildControlButton(IconData icon, Color color, VoidCallback onTap, {bool isEndCall = false}) {
    final theme = ref.watch(currentThemeProvider);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: isEndCall ? 72 : 56,
        height: isEndCall ? 72 : 56,
        decoration: BoxDecoration(
          gradient: isEndCall 
            ? LinearGradient(colors: [theme.error, theme.error.withValues(alpha: 0.7)])
            : LinearGradient(
                colors: [
                  color.withValues(alpha: 0.2),
                  color.withValues(alpha: 0.05),
                ],
              ),
          borderRadius: BorderRadius.circular(isEndCall ? 24 : 18),
          border: Border.all(
            color: color.withValues(alpha: 0.3),
            width: 1,
          ),
          boxShadow: theme.useGlow ? [
            BoxShadow(
              color: color.withValues(alpha: 0.4),
              blurRadius: 20,
              spreadRadius: 2,
            ),
          ] : null,
        ),
        child: Icon(
          icon,
          color: Colors.white,
          size: isEndCall ? 32 : 24,
        ),
      ),
    );
  }
}
