import 'package:flutter/material.dart';

// ===== breakpoints.dart =====
class Breakpoints {
  static const double mobile = 375;
  static const double mobileLg = 414;
  static const double tablet = 768;
  static const double desktop = 1024;
}

enum DeviceType { mobile, tablet, desktop }

DeviceType getDeviceType(BuildContext context) {
  final width = MediaQuery.of(context).size.width;
  if (width >= Breakpoints.desktop) return DeviceType.desktop;
  if (width >= Breakpoints.tablet) return DeviceType.tablet;
  return DeviceType.mobile;
}

// ===== responsive_builder.dart =====
class ResponsiveBuilder extends StatelessWidget {
  final Widget mobile;
  final Widget? tablet;
  final Widget? desktop;
  const ResponsiveBuilder({super.key, required this.mobile, this.tablet, this.desktop});

  @override
  Widget build(BuildContext context) {
    final deviceType = getDeviceType(context);
    switch (deviceType) {
      case DeviceType.desktop: return desktop ?? tablet ?? mobile;
      case DeviceType.tablet: return tablet ?? mobile;
      case DeviceType.mobile: return mobile;
    }
  }
}

// ===== adaptive_grid.dart =====
class AdaptiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double spacing;
  final double runSpacing;
  final EdgeInsets padding;
  const AdaptiveGrid({super.key, required this.children, this.spacing = 12, this.runSpacing = 12, this.padding = const EdgeInsets.all(16)});

  @override
  Widget build(BuildContext context) {
    final crossAxisCount = switch (getDeviceType(context)) {
      DeviceType.desktop => 4, DeviceType.tablet => 3, DeviceType.mobile => 2,
    };
    return GridView.builder(
      padding: padding,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount, crossAxisSpacing: spacing, mainAxisSpacing: runSpacing, childAspectRatio: 1,
      ),
      itemCount: children.length, itemBuilder: (context, index) => children[index],
    );
  }
}

// ===== split_layout.dart =====
class SplitLayout extends StatelessWidget {
  final Widget master;
  final Widget? detail;
  final double masterWidth;
  final bool showDetail;
  const SplitLayout({super.key, required this.master, this.detail, this.masterWidth = 320, this.showDetail = false});

  @override
  Widget build(BuildContext context) {
    if (getDeviceType(context) == DeviceType.mobile) return master;
    return Row(children: [
      SizedBox(width: masterWidth, child: master),
      const VerticalDivider(width: 1),
      Expanded(child: detail ?? const Center(child: Text('选择一项查看详情'))),
    ]);
  }
}

// ===== adaptive_sheet.dart =====
class AdaptiveSheet extends StatelessWidget {
  final Widget child;
  final double? height;
  final bool isDismissible;
  const AdaptiveSheet({super.key, required this.child, this.height, this.isDismissible = true});

  static Future<T?> show<T>({required BuildContext context, required WidgetBuilder builder, double? height, bool isDismissible = true}) {
    if (getDeviceType(context) == DeviceType.mobile) {
      return showModalBottomSheet<T>(
        context: context, isDismissible: isDismissible, backgroundColor: Colors.transparent,
        builder: (context) => Container(
          height: height ?? MediaQuery.of(context).size.height * 0.7,
          decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
          child: builder(context),
        ),
      );
    }
    return showDialog<T>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: Colors.transparent,
        child: Container(
          width: 400, height: height ?? 600,
          decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.all(Radius.circular(16))),
          child: builder(context),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => child;
}

// ===== safe_area_wrapper.dart =====
class SafeAreaWrapper extends StatelessWidget {
  final Widget child;
  final bool top;
  final bool bottom;
  final bool left;
  final bool right;
  final EdgeInsets margin;
  const SafeAreaWrapper({super.key, required this.child, this.top = true, this.bottom = true, this.left = true, this.right = true, this.margin = EdgeInsets.zero});

  @override
  Widget build(BuildContext context) => SafeArea(top: top, bottom: bottom, left: left, right: right, minimum: margin, child: child);
}

// ===== constrained_container.dart =====
class ConstrainedContainer extends StatelessWidget {
  final Widget child;
  final double maxWidth;
  final Alignment alignment;
  const ConstrainedContainer({super.key, required this.child, this.maxWidth = 1200, this.alignment = Alignment.center});

  @override
  Widget build(BuildContext context) => Align(alignment: alignment, child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: child));
}
