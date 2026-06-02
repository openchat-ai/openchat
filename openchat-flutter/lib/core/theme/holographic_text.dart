import 'package:flutter/material.dart';
import 'glass_constants.dart';

class HolographicText extends StatelessWidget {
  final String text;
  final double fontSize;
  final FontWeight fontWeight;
  final List<Color> colors;

  const HolographicText({
    super.key,
    required this.text,
    this.fontSize = 24,
    this.fontWeight = FontWeight.bold,
    this.colors = const [neonCyan, neonPurple, neonPink],
  });

  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      shaderCallback: (bounds) {
        return LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ).createShader(bounds);
      },
      child: Text(
        text,
        style: TextStyle(
          fontSize: fontSize,
          fontWeight: fontWeight,
          color: Colors.white,
          letterSpacing: 1,
        ),
      ),
    );
  }
}
