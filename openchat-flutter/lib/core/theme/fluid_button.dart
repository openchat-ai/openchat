import 'package:flutter/material.dart';
import 'glass_constants.dart';

class FluidButton extends StatefulWidget {
  final Widget child;
  final VoidCallback onPressed;
  final List<Color> gradientColors;
  final double height;
  final bool isOutlined;

  const FluidButton({
    super.key,
    required this.child,
    required this.onPressed,
    this.gradientColors = const [neonCyan, neonPurple],
    this.height = 56,
    this.isOutlined = false,
  });

  @override
  State<FluidButton> createState() => _FluidButtonState();
}

class _FluidButtonState extends State<FluidButton> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _glowAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    )..repeat(reverse: true);
    _glowAnimation = Tween<double>(begin: 0.3, end: 0.6).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _glowAnimation,
      builder: (context, child) {
        return GestureDetector(
          onTap: widget.onPressed,
          child: Container(
            height: widget.height,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: widget.isOutlined ? null : LinearGradient(colors: widget.gradientColors),
              border: widget.isOutlined ? Border.all(
                color: widget.gradientColors[0],
                width: 2,
              ) : null,
              boxShadow: [
                BoxShadow(
                  color: widget.gradientColors[0].withValues(alpha: _glowAnimation.value),
                  blurRadius: 20,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: Center(
              child: DefaultTextStyle(
                style: TextStyle(
                  color: widget.isOutlined ? widget.gradientColors[0] : Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
                child: widget.child,
              ),
            ),
          ),
        );
      },
    );
  }
}
