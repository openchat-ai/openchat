import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class ChatBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final AppTheme theme;
  final Map<String, dynamic> layout;
  final VoidCallback onPlayVoice;

  const ChatBubble({
    super.key,
    required this.message,
    required this.theme,
    required this.layout,
    required this.onPlayVoice,
  });

  @override
  Widget build(BuildContext context) {
    final isMe = message['sender'] == 'me';
    final isVoice = message['type'] == 'voice';
    final bc = layout['bubble'] as Map? ?? {};
    final selfColor = bc['selfColor'] as String?;
    final otherColor = bc['otherColor'] as String?;
    final radius = (bc['radius'] as num?)?.toDouble() ?? 20;
    final selfBg = selfColor != null ? Color(int.parse(selfColor.replaceAll('#', '0xFF'))) : null;
    final otherBg = otherColor != null ? Color(int.parse(otherColor.replaceAll('#', '0xFF'))) : null;
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          gradient: isMe && selfBg == null ? LinearGradient(colors: theme.gradientPrimary) : null,
          color: isMe ? selfBg : (otherBg ?? theme.surface.withValues(alpha: 0.5)),
          borderRadius: BorderRadius.circular(radius).copyWith(
            bottomRight: isMe ? const Radius.circular(4) : null,
            bottomLeft: !isMe ? const Radius.circular(4) : null,
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!isVoice)
            Text(message['text'] ?? '', style: TextStyle(color: isMe ? Colors.white : theme.textPrimary, fontSize: 14))
          else
            GestureDetector(
              onTap: onPlayVoice,
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.play_arrow, color: isMe ? Colors.white : theme.primary, size: 20),
                const SizedBox(width: 6),
                Text('语音', style: TextStyle(color: isMe ? Colors.white : theme.textPrimary, fontSize: 14)),
              ]),
            ),
          const SizedBox(height: 4),
          Text(message['time'] ?? '', style: TextStyle(color: isMe ? Colors.white.withValues(alpha: 0.7) : theme.textTertiary, fontSize: 10)),
        ]),
      ),
    );
  }
}
