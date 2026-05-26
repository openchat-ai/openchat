import 'package:flutter/material.dart';

/// Utility for consistent spacing / radius across SDUI pages.
/// Values can be overridden by the app's global config.
class SduiStyle {
  SduiStyle._();

  static Map<String, dynamic> _global = const {};
  static final Map<String, double> _spacing = {};
  static final Map<String, double> _radius = {};

  /// Initialize from a global config map.
  static void init(Map<String, dynamic> global) {
    _global = global;
    if (global['spacing'] is Map) {
      for (final e in (global['spacing'] as Map).entries) _spacing[e.key.toString()] = (e.value as num).toDouble();
    }
    if (global['radius'] is Map) {
      for (final e in (global['radius'] as Map).entries) _radius[e.key.toString()] = (e.value as num).toDouble();
    }
  }

  /// Get spacing value by token name (xs/sm/md/lg/xl/xxl).
  static double sp(String key, [double d = 12]) => _spacing[key] ?? d;

  /// Get radius value by token name (sm/md/lg/xl).
  static double rd(String key, [double d = 12]) => _radius[key] ?? d;

  /// Render a section header.
  static Widget sectionHeader(String text, TextStyle base) {
    final size = _global['sectionHeaderSize'] as num? ?? 16;
    return Text(text, style: base.copyWith(fontSize: size.toDouble(), fontWeight: FontWeight.w600));
  }

  /// Render a section container.
  static Widget sectionContainer(Widget child, Color surface, {Color? borderColor}) {
    return Container(
      padding: EdgeInsets.all(sp('md', 16)),
      decoration: BoxDecoration(
        color: surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(rd('md', 12)),
        border: Border.all(color: borderColor ?? surface.withValues(alpha: 0.1)),
      ),
      child: child,
    );
  }
}
