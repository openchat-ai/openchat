import 'package:flutter/material.dart';

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
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: 1,
              strokeWidth: 4,
              valueColor: AlwaysStoppedAnimation(Colors.grey.shade300),
            ),
          ),
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
