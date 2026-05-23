import 'package:flutter/material.dart';

/// 响应式布局断点
class Breakpoints {
  static const double mobile = 375;
  static const double mobileLg = 414;
  static const double tablet = 768;
  static const double desktop = 1024;
}

/// 设备类型
enum DeviceType {
  mobile,      // 手机
  tablet,      // 平板
  desktop,     // 桌面
}

/// 获取设备类型
DeviceType getDeviceType(BuildContext context) {
  final width = MediaQuery.of(context).size.width;
  if (width >= Breakpoints.desktop) return DeviceType.desktop;
  if (width >= Breakpoints.tablet) return DeviceType.tablet;
  return DeviceType.mobile;
}

/// 响应式布局构建器
class ResponsiveBuilder extends StatelessWidget {
  final Widget mobile;
  final Widget? tablet;
  final Widget? desktop;

  const ResponsiveBuilder({
    super.key,
    required this.mobile,
    this.tablet,
    this.desktop,
  });

  @override
  Widget build(BuildContext context) {
    final deviceType = getDeviceType(context);
    
    switch (deviceType) {
      case DeviceType.desktop:
        return desktop ?? tablet ?? mobile;
      case DeviceType.tablet:
        return tablet ?? mobile;
      case DeviceType.mobile:
        return mobile;
    }
  }
}

/// 自适应网格
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

/// 分屏布局（平板/桌面）
class SplitLayout extends StatelessWidget {
  final Widget master;
  final Widget? detail;
  final double masterWidth;
  final bool showDetail;

  const SplitLayout({
    super.key,
    required this.master,
    this.detail,
    this.masterWidth = 320,
    this.showDetail = false,
  });

  @override
  Widget build(BuildContext context) {
    final deviceType = getDeviceType(context);
    
    if (deviceType == DeviceType.mobile) {
      return master;
    }

    return Row(
      children: [
        SizedBox(
          width: masterWidth,
          child: master,
        ),
        const VerticalDivider(width: 1),
        Expanded(
          child: detail ?? const Center(child: Text('选择一项查看详情')),
        ),
      ],
    );
  }
}

/// 底部 Sheet（移动端） 侧边抽屉（平板）
class AdaptiveSheet extends StatelessWidget {
  final Widget child;
  final double? height;
  final bool isDismissible;

  const AdaptiveSheet({
    super.key,
    required this.child,
    this.height,
    this.isDismissible = true,
  });

  static Future<T?> show<T>({
    required BuildContext context,
    required WidgetBuilder builder,
    double? height,
    bool isDismissible = true,
  }) {
    final deviceType = getDeviceType(context);
    
    if (deviceType == DeviceType.mobile) {
      return showModalBottomSheet<T>(
        context: context,
        isDismissible: isDismissible,
        backgroundColor: Colors.transparent,
        builder: (context) => Container(
          height: height ?? MediaQuery.of(context).size.height * 0.7,
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: builder(context),
        ),
      );
    } else {
      return showDialog<T>(
        context: context,
        builder: (context) => Dialog(
          backgroundColor: Colors.transparent,
          child: Container(
            width: 400,
            height: height ?? 600,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
            ),
            child: builder(context),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) => child;
}

/// 安全区域包装器
class SafeAreaWrapper extends StatelessWidget {
  final Widget child;
  final bool top;
  final bool bottom;
  final bool left;
  final bool right;
  final EdgeInsets margin;

  const SafeAreaWrapper({
    super.key,
    required this.child,
    this.top = true,
    this.bottom = true,
    this.left = true,
    this.right = true,
    this.margin = const EdgeInsets.all(0),
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: top,
      bottom: bottom,
      left: left,
      right: right,
      minimum: margin,
      child: child,
    );
  }
}

/// 约束容器（最大宽度限制）
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
