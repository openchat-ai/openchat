import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

/// Reusable button widget for voice room control bar.
class VoiceRoomCtrlBtn extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final bool big;
  final String? label;

  const VoiceRoomCtrlBtn({
    super.key,
    required this.icon,
    required this.color,
    required this.onTap,
    this.big = false,
    this.label,
  });

  @override
  Widget build(BuildContext context) {
    if (label != null) {
      return GestureDetector(
        onTap: onTap,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: big ? 72 : 56,
            height: big ? 72 : 56,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(big ? 24 : 18),
              border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
            ),
            child: Icon(icon, color: Colors.white, size: big ? 32 : 24),
          ),
          const SizedBox(height: 8),
          Text(label!, style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12)),
        ]),
      );
    }
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: big ? 72 : 56,
        height: big ? 72 : 56,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(big ? 24 : 18),
          border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
        ),
        child: Icon(icon, color: Colors.white, size: big ? 32 : 24),
      ),
    );
  }
}

/// Self-test mode selection screen (实时通话 vs 语音消息).
class VoiceRoomModeSelect extends StatelessWidget {
  final AppTheme theme;
  final VoidCallback onStartCall;
  final VoidCallback onStartVoiceMsg;

  const VoiceRoomModeSelect({
    super.key,
    required this.theme,
    required this.onStartCall,
    required this.onStartVoiceMsg,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            const Icon(Icons.mic_rounded, size: 64, color: Colors.white),
            const SizedBox(height: 24),
            Text('选择模式',
                style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 48),
            VoiceRoomCtrlBtn(
              icon: Icons.headset,
              color: theme.primary,
              onTap: onStartCall,
              label: '实时通话',
            ),
            const SizedBox(height: 24),
            VoiceRoomCtrlBtn(
              icon: Icons.send_rounded,
              color: theme.textPrimary,
              onTap: onStartVoiceMsg,
              label: '语音消息',
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}

/// Voice message recording UI (按住说话).
class VoiceRoomVmScreen extends StatelessWidget {
  final AppTheme theme;
  final bool recording;
  final VoidCallback onPointerDown;
  final VoidCallback onPointerUp;
  final VoidCallback onBack;

  const VoiceRoomVmScreen({
    super.key,
    required this.theme,
    required this.recording,
    required this.onPointerDown,
    required this.onPointerUp,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            Icon(recording ? Icons.mic : Icons.mic_none, size: 64,
                color: recording ? theme.error : theme.textPrimary),
            const SizedBox(height: 24),
            Text(recording ? '录音中...' : '按住说话',
                style: TextStyle(color: theme.textPrimary, fontSize: 20)),
            const SizedBox(height: 48),
            Listener(
              onPointerDown: (_) => onPointerDown(),
              onPointerUp: (_) => onPointerUp(),
              onPointerCancel: (_) => onPointerUp(),
              child: Container(
                width: 120, height: 120,
                decoration: BoxDecoration(
                  color: recording ? theme.error.withValues(alpha: 0.3) : theme.primary.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(60),
                  border: Border.all(
                      color: recording ? theme.error : theme.primary, width: 2),
                ),
                child: Icon(Icons.mic, size: 48,
                    color: recording ? theme.error : theme.textPrimary),
              ),
            ),
            const SizedBox(height: 48),
            TextButton(
              onPressed: onBack,
              child: Text('返回', style: TextStyle(color: theme.textTertiary)),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
