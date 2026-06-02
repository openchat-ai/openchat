import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/sdui_config.dart';
import '../../core/version.dart';
import '../components/cards/app_cards.dart';

class SettingsSduiView extends StatelessWidget {
  final Map<String, dynamic> layout;
  final AppTheme theme;
  final void Function(String action) onAction;

  const SettingsSduiView({
    super.key,
    required this.layout,
    required this.theme,
    required this.onAction,
  });

  IconData _icon(String name) => SduiParser.icons[name] ?? Icons.circle_outlined;

  @override
  Widget build(BuildContext context) {
    final sections = layout['sections'] as List;
    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(layout['title'] as String? ?? 'SETTINGS',
          style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold)),
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: ListView(
            children: [
              for (final sec in sections) ...[
                if (sec is Map) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
                    child: Text((sec['title'] as String? ?? '').toUpperCase(),
                      style: TextStyle(color: theme.textTertiary, fontSize: 11,
                        fontWeight: FontWeight.w600, letterSpacing: 2)),
                  ),
                  if (sec['items'] is List)
                    for (final item in sec['items'])
                      if (item is Map) _buildItem(theme, item),
                ],
              ],
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Text('版本: $appVersion',
                    style: TextStyle(color: theme.textTertiary, fontSize: 11)),
                ),
              ),
              const Padding(padding: EdgeInsets.only(bottom: 100)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildItem(AppTheme theme, Map item) {
    final iconName = item['icon'] as String?;
    final label = item['label'] as String? ?? '';
    final value = item['value'] as String?;
    final action = item['action'] as String?;
    final colorStr = item['color'] as String?;
    final color = colorStr != null
        ? Color(int.parse(colorStr.replaceAll('#', '0xFF')))
        : theme.gradientPrimary[0];
    return ListCard(
      leading: iconName != null ? Icon(_icon(iconName), color: color, size: 20) : null,
      leadingColor: color,
      title: label,
      subtitle: value,
      onTap: action != null ? () => onAction(action) : null,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
    );
  }
}
