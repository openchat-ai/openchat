import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/providers/bridge_provider.dart';
import 'package:openchat/ui/theme/colors.dart';
import 'package:openchat/ui/screens/settings/provider_settings_screen.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          _buildSection(
            title: 'Account',
            children: [
              _buildTile(
                icon: Icons.person,
                title: 'Edit Profile',
                onTap: () => Navigator.pushNamed(context, '/profile/edit'),
              ),
              _buildTile(
                icon: Icons.qr_code,
                title: 'My QR Code',
                onTap: () => Navigator.pushNamed(context, '/profile/my-qr'),
              ),
              _buildTile(
                icon: Icons.security,
                title: 'Privacy & Security',
                onTap: () {},
              ),
            ],
          ),
          _buildSection(
            title: 'AI Settings',
            children: [
              _buildTile(
                icon: Icons.api,
                title: 'AI 服务商',
                subtitle: ref.watch(currentProviderProvider) ?? '未配置',
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const ProviderSettingsScreen()),
                ),
              ),
              _buildTile(
                icon: Icons.smart_toy,
                title: 'AI List',
                onTap: () => Navigator.pushNamed(context, '/ai/list'),
              ),
              _buildTile(
                icon: Icons.computer,
                title: 'Bridge Status',
                onTap: () => Navigator.pushNamed(context, '/bridge/status'),
              ),
            ],
          ),
          _buildSection(
            title: 'Appearance',
            children: [
              _buildTile(
                icon: Icons.dark_mode,
                title: 'Theme',
                trailing: DropdownButton<ThemeMode>(
                  value: ThemeMode.dark,
                  underline: const SizedBox(),
                  items: const [
                    DropdownMenuItem(
                      value: ThemeMode.system,
                      child: Text('System'),
                    ),
                    DropdownMenuItem(
                      value: ThemeMode.light,
                      child: Text('Light'),
                    ),
                    DropdownMenuItem(
                      value: ThemeMode.dark,
                      child: Text('Dark'),
                    ),
                  ],
                  onChanged: (value) {},
                ),
              ),
            ],
          ),
          _buildSection(
            title: 'About',
            children: [
              _buildTile(
                icon: Icons.info,
                title: 'About OpenChat',
                onTap: () => _showAbout(context),
              ),
              _buildTile(
                icon: Icons.description,
                title: 'Terms of Service',
                onTap: () {},
              ),
              _buildTile(
                icon: Icons.privacy_tip,
                title: 'Privacy Policy',
                onTap: () {},
              ),
            ],
          ),
          const SizedBox(height: 24),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ElevatedButton(
              onPressed: () => _showLogoutDialog(context),
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
              child: const Text('Log Out'),
            ),
          ),
          const SizedBox(height: 48),
        ],
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required List<Widget> children,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
          child: Text(
            title.toUpperCase(),
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        Container(
          color: AppColors.surfaceDark,
          child: Column(children: children),
        ),
      ],
    );
  }

  Widget _buildTile({
    required IconData icon,
    required String title,
    String? subtitle,
    Widget? trailing,
    VoidCallback? onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: AppColors.primary),
      title: Text(title),
      subtitle: subtitle != null
          ? Text(subtitle, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))
          : null,
      trailing:
          trailing ??
          const Icon(Icons.chevron_right, color: AppColors.textSecondary),
      onTap: onTap,
    );
  }

  void _showAbout(BuildContext context) {
    showAboutDialog(
      context: context,
      applicationName: 'OpenChat',
      applicationVersion: '1.0.0',
      applicationLegalese: 'Decentralized social network + AI platform',
    );
  }

  void _showLogoutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Log Out'),
        content: const Text('Are you sure you want to log out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Log Out'),
          ),
        ],
      ),
    );
  }
}
