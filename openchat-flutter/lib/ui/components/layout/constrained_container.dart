import 'package:flutter/material.dart';

class ConstrainedContainer extends StatelessWidget {
  final Widget child;
  final double maxWidth;
  final Alignment alignment;

  const ConstrainedContainer({
    super.key,
    required this.child,
    this.maxWidth = 1200,
    this.alignment = Alignment.center,
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: alignment,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: child,
      ),
    );
  }
}
