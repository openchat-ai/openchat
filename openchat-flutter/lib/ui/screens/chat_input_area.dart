import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class ChatInputArea extends StatelessWidget {
  final AppTheme theme;
  final TextEditingController controller;
  final Map<String, dynamic> layout;
  final bool recording;
  final bool hasText;
  final VoidCallback onSend;
  final VoidCallback onStartRecord;
  final VoidCallback onEndRecord;
  final ValueChanged<String> onTextChanged;

  const ChatInputArea({
    super.key,
    required this.theme,
    required this.controller,
    required this.layout,
    required this.recording,
    required this.hasText,
    required this.onTextChanged,
    required this.onSend,
    required this.onStartRecord,
    required this.onEndRecord,
  });

  @override
  Widget build(BuildContext context) {
    final ia = layout['input'] as Map? ?? {};
    final hint = ia['hint'] as String? ?? '输入消息...';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.1), width: 1))),
      child: SafeArea(child: Row(children: [
        IconButton(icon: Icon(Icons.add_circle_outline, color: theme.textSecondary), onPressed: () {}),
        Expanded(child: TextField(
          controller: controller,
          style: TextStyle(color: theme.textPrimary),
          maxLines: 4,
          minLines: 1,
          textInputAction: TextInputAction.newline,
          keyboardType: TextInputType.multiline,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: theme.textTertiary),
            filled: true, fillColor: theme.background,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
          onChanged: onTextChanged,
        )),
        const SizedBox(width: 4),
        GestureDetector(
          onLongPressStart: (_) => onStartRecord(),
          onLongPressEnd: (_) => onEndRecord(),
          onLongPressCancel: () => onEndRecord(),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: recording ? theme.error.withValues(alpha: 0.3) : null,
              gradient: recording ? null : LinearGradient(colors: theme.gradientPrimary),
              borderRadius: BorderRadius.circular(20)),
            child: Icon(recording ? Icons.mic : Icons.keyboard_voice, color: Colors.white, size: 20)),
        ),
        const SizedBox(width: 4),
        IconButton(
          icon: Icon(Icons.send_rounded, color: hasText ? theme.primary : theme.textTertiary),
          onPressed: hasText ? onSend : null,
        ),
      ])),
    );
  }
}
