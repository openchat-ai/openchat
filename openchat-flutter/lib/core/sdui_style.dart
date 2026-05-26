import 'package:flutter/material.dart';
import 'api/qiniu_direct_client.dart';
import 'theme/app_theme.dart';

class SduiStyle {
  static double sp(String key, [double d = 12]) => QiniuDirectClient.spacing(key, d);
  static double rd(String key, [double d = 12]) => QiniuDirectClient.radius(key, d);

  static Widget sectionHeader(String text, AppTheme theme) {
    final size = QiniuDirectClient.globalStyle['sectionHeaderSize'] as num? ?? 16;
    return Text(text, style: TextStyle(color: theme.textPrimary, fontSize: size.toDouble(), fontWeight: FontWeight.w600));
  }

  static Widget bodyText(String text, AppTheme theme, {double size = 13}) {
    return Text(text, style: TextStyle(color: theme.textSecondary, fontSize: size));
  }

  static Widget caption(String text, AppTheme theme, {double size = 11}) {
    return Text(text, style: TextStyle(color: theme.textTertiary, fontSize: size));
  }

  static Container sectionContainer(Widget child, AppTheme theme) {
    final pad = sp('md', 16);
    final r = rd('md', 12);
    return Container(
      padding: EdgeInsets.all(pad),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(r),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1)),
      ),
      child: child,
    );
  }

  static EdgeInsets sectionPadding = EdgeInsets.fromLTRB(20, 8, 20, 8);

  static double vGap(String key, [double d = 12]) => sp(key, d);
}
