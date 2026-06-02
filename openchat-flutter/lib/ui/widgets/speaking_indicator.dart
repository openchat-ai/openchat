import 'package:flutter/material.dart';

class SpeakingIndicator extends StatefulWidget {
  final bool isSpeaking;
  final double size;

  const SpeakingIndicator({
    super.key,
    required this.isSpeaking,
    this.size = 24,
  });

  @override
  State<SpeakingIndicator> createState() => _SpeakingIndicatorState();
}

class _SpeakingIndicatorState extends State<SpeakingIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    if (widget.isSpeaking) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(SpeakingIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isSpeaking && !oldWidget.isSpeaking) {
      _controller.repeat(reverse: true);
    } else if (!widget.isSpeaking && oldWidget.isSpeaking) {
      _controller.stop();
      _controller.reset();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isSpeaking) {
      return SizedBox(width: widget.size, height: widget.size);
    }
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          width: widget.size * (1 + _controller.value * 0.3),
          height: widget.size * (1 + _controller.value * 0.3),
          decoration: BoxDecoration(
            color: Colors.green.withValues(alpha: 0.3 * (1 - _controller.value)),
            shape: BoxShape.circle,
          ),
          child: Icon(
            Icons.volume_up,
            color: Colors.green,
            size: widget.size * 0.7,
          ),
        );
      },
    );
  }
}
