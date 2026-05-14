/**
 * Audio Level Visualizer
 *
 * 实时音频级别可视�? * - 波形显示
 * - 音频级别指示�? */

import 'dart:async';
import 'package:flutter/material.dart';

class AudioLevelVisualizer extends StatefulWidget {
  final Stream<double> audioLevelStream;
  final Color color;
  final double height;

  const AudioLevelVisualizer({
    super.key,
    required this.audioLevelStream,
    this.color = Colors.green,
    this.height = 60,
  });

  @override
  State<AudioLevelVisualizer> createState() => _AudioLevelVisualizerState();
}

class _AudioLevelVisualizerState extends State<AudioLevelVisualizer> {
  final List<double> _levels = List.filled(20, 0);
  StreamSubscription<double>? _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = widget.audioLevelStream.listen((level) {
      if (mounted) {
        setState(() {
          _levels.removeAt(0);
          _levels.add(level.clamp(0, 1));
        });
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(_levels.length, (index) {
          return AnimatedContainer(
            duration: const Duration(milliseconds: 80),
            margin: const EdgeInsets.symmetric(horizontal: 2),
            width: 6,
            height: 8 + (_levels[index] * (widget.height - 16)).clamp(0, widget.height - 16),
            decoration: BoxDecoration(
              color: _getBarColor(_levels[index]),
              borderRadius: BorderRadius.circular(3),
            ),
          );
        }),
      ),
    );
  }

  Color _getBarColor(double level) {
    if (level > 0.7) return Colors.red;
    if (level > 0.4) return Colors.orange;
    return widget.color;
  }
}

class AudioLevelIndicator extends StatelessWidget {
  final double level;
  final double size;

  const AudioLevelIndicator({
    super.key,
    required this.level,
    this.size = 80,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // 外圈 (背景)
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: 1,
              strokeWidth: 4,
              valueColor: AlwaysStoppedAnimation(Colors.grey.shade300),
            ),
          ),
          // 内圈 (级别)
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: level.clamp(0, 1),
              strokeWidth: 4,
              valueColor: AlwaysStoppedAnimation(_getColor(level)),
              backgroundColor: Colors.transparent,
            ),
          ),
          // 图标
          Icon(
            level > 0.1 ? Icons.mic : Icons.mic_off,
            color: _getColor(level),
            size: size * 0.4,
          ),
        ],
      ),
    );
  }

  Color _getColor(double level) {
    if (level > 0.7) return Colors.red;
    if (level > 0.4) return Colors.orange;
    return Colors.green;
  }
}

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
