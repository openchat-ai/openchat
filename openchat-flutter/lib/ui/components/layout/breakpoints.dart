import 'package:flutter/material.dart';

class Breakpoints {
  static const double mobile = 375;
  static const double mobileLg = 414;
  static const double tablet = 768;
  static const double desktop = 1024;
}

enum DeviceType {
  mobile,
  tablet,
  desktop,
}

DeviceType getDeviceType(BuildContext context) {
  final width = MediaQuery.of(context).size.width;
  if (width >= Breakpoints.desktop) return DeviceType.desktop;
  if (width >= Breakpoints.tablet) return DeviceType.tablet;
  return DeviceType.mobile;
}
