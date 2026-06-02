import 'package:flutter/material.dart';
import 'breakpoints.dart';

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
        SizedBox(width: masterWidth, child: master),
        const VerticalDivider(width: 1),
        Expanded(child: detail ?? const Center(child: Text('选择一项查看详情'))),
      ],
    );
  }
}
