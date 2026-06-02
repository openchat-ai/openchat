import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import 'settings_profile_header.dart';
import 'settings_theme_section.dart';
import 'bridge_url_tile.dart';

class SettingsHardcodedView extends StatelessWidget {
  final AppTheme theme;
  final ThemeModeSetting themeMode;

  const SettingsHardcodedView({
    super.key,
    required this.theme,
    required this.themeMode,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('SETTINGS',
          style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold,
            letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 2)),
        actions: [
          _buildActionButton(Icons.more_vert, theme), const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: CustomScrollView(
            slivers: [
              SettingsProfileHeader(theme: theme),
              SettingsThemeSection(theme: theme, themeMode: themeMode),
              _buildSection('General', [
                _buildSettingItem(Icons.language_outlined, 'Language', 'Chinese', theme.info, theme),
                _buildSettingItem(Icons.notifications_outlined, 'Notifications', 'Enabled', theme.success, theme),
              ], theme),
              _buildSection('Account', [
                _buildSettingItem(Icons.person_outlined, 'Profile', '', theme.gradientPrimary[0], theme),
                _buildSettingItem(Icons.security_outlined, 'Security', '', theme.warning, theme),
                _buildSettingItem(Icons.link_outlined, 'Linked Accounts', '', theme.accent, theme),
              ], theme),
              _buildSection('Connection', [
                BridgeUrlTile(theme: theme),
              ], theme),
              _buildSection('Other', [
                _buildSettingItem(Icons.storage_outlined, 'Storage', '2.4 GB', theme.gradientAccent[0], theme),
                _buildSettingItem(Icons.help_outline, 'Help', '', theme.gradientAccent[1], theme),
                _buildSettingItem(Icons.info_outlined, 'About', 'v1.0.0', theme.textSecondary, theme),
              ], theme),
              const SliverPadding(padding: EdgeInsets.only(bottom: 100)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActionButton(IconData icon, AppTheme theme) {
    return Container(
      margin: const EdgeInsets.only(right: 8), padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1),
      ),
      child: Icon(icon, color: theme.textSecondary, size: 20),
    );
  }

  Widget _buildSection(String title, List<Widget> items, AppTheme theme) {
    return SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
        child: Text(title.toUpperCase(), style: TextStyle(color: theme.textTertiary, fontSize: 11,
          fontWeight: FontWeight.w600, letterSpacing: 2))),
      ...items,
    ]));
  }

  Widget _buildSettingItem(IconData icon, String title, String value, Color color, AppTheme theme, {VoidCallback? onTap}) {
    return ListTile(
      leading: Container(
        width: 40, height: 40,
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 15)),
      subtitle: value.isNotEmpty ? Text(value, style: TextStyle(color: theme.textSecondary, fontSize: 12)) : null,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
      onTap: onTap,
    );
  }
}
