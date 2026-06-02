import 'package:flutter/material.dart';
import 'breakpoints.dart';

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
