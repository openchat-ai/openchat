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
