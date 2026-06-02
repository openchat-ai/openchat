import 'package:flutter/material.dart';
import 'breakpoints.dart';

class AdaptiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double spacing;
  final double runSpacing;
  final EdgeInsets padding;

  const AdaptiveGrid({
    super.key,
    required this.children,
    this.spacing = 12,
    this.runSpacing = 12,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    final deviceType = getDeviceType(context);
    final crossAxisCount = switch (deviceType) {
      DeviceType.desktop => 4,
      DeviceType.tablet => 3,
      DeviceType.mobile => 2,
    };

    return GridView.builder(
      padding: padding,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        crossAxisSpacing: spacing,
        mainAxisSpacing: runSpacing,
        childAspectRatio: 1,
      ),
      itemCount: children.length,
      itemBuilder: (context, index) => children[index],
    );
  }
}
