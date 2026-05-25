import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../providers/config_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui.dart';
import '../components/cards/app_cards.dart';
import '../../core/version.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  Map? _uiConfig;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final cfg = await QiniuDirectClient.fetchConfigFile('oc/config/ui_settings.json');
    if (mounted) setState(() => _uiConfig = cfg);
  }

  IconData _icon(String name) => SduiParser.icons[name] ?? Icons.circle_outlined;

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final themeMode = ref.watch(themeModeProvider);

    // If remote config has sections, use SDUI-driven layout
    if (_uiConfig?['sections'] is List) {
      return _buildSdui(theme, themeMode);
    }

    return _buildHardcoded(theme, themeMode);
  }

  Widget _buildSdui(AppTheme theme, ThemeModeSetting themeMode) {
    final sections = _uiConfig!['sections'] as List;
    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(_uiConfig!['title'] as String? ?? 'SETTINGS',
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
                      if (item is Map) _buildSduiItem(theme, item),
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

  Widget _buildSduiItem(AppTheme theme, Map item) {
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
      onTap: action != null ? () => _handleAction(action) : null,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
    );
  }

  void _handleAction(String action) {
    if (action == 'theme') {
      Navigator.pushNamed(context, '/theme');
    } else if (action.startsWith('navigate:')) {
      Navigator.pushNamed(context, action.substring(9));
    }
  }

  Widget _buildHardcoded(AppTheme theme, ThemeModeSetting themeMode) {
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
              _buildProfileHeader(theme),
              _buildThemeSection(theme, themeMode, ref),
              _buildSection('通用', [
                _buildSettingItem(Icons.language_outlined, '语言', '简体中文', theme.info, theme),
                _buildSettingItem(Icons.notifications_outlined, '通知', '已开启', theme.success, theme),
              ], theme),
              _buildSection('账号', [
                _buildSettingItem(Icons.person_outlined, '个人资料', '', theme.gradientPrimary[0], theme),
                _buildSettingItem(Icons.security_outlined, '安全设置', '', theme.warning, theme),
                _buildSettingItem(Icons.link_outlined, '绑定账号', '', theme.accent, theme),
              ], theme),
              _buildSection('连接', [
                _BridgeUrlTile(theme: theme),
              ], theme),
              _buildSection('其他', [
                _buildSettingItem(Icons.storage_outlined, '存储空间', '2.4 GB', theme.gradientAccent[0], theme),
                _buildSettingItem(Icons.help_outline, '帮助与反馈', '', theme.gradientAccent[1], theme),
                _buildSettingItem(Icons.info_outlined, '关于', 'v1.0.0', theme.textSecondary, theme),
              ], theme),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Text('版本: $appVersion',
                    style: TextStyle(color: theme.textTertiary, fontSize: 11)),
                ),
              ),
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

  Widget _buildProfileHeader(AppTheme theme) {
    return SliverToBoxAdapter(
      child: Container(
        margin: const EdgeInsets.all(20), padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [
            theme.gradientPrimary[0].withValues(alpha: 0.2),
            theme.gradientPrimary[1].withValues(alpha: 0.1),
          ]),
          borderRadius: BorderRadius.circular(theme.radiusLarge + 4),
          border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1),
        ),
        child: Row(children: [
          Container(
            width: 72, height: 72,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: theme.gradientPrimary),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
            ),
            child: const Icon(Icons.person, color: Colors.white, size: 36),
          ),
          const SizedBox(width: 20),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('开发者', style: TextStyle(color: theme.textPrimary, fontSize: 22, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text('ID: 88888888', style: TextStyle(color: theme.textTertiary, fontSize: 13)),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10)),
              child: const Text('VIP', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ])),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium - 4)),
            child: Icon(Icons.qr_code, color: theme.textPrimary, size: 22),
          ),
        ]),
      ),
    );
  }

  Widget _buildThemeSection(AppTheme theme, ThemeModeSetting currentMode, WidgetRef ref) {
    final modeLabels = {
      ThemeModeSetting.auto: '跟随系统', ThemeModeSetting.light: '浅色模式',
      ThemeModeSetting.dark: '深色模式', ThemeModeSetting.manual: '手动选择',
    };
    return SliverToBoxAdapter(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
          child: Text('外观'.toUpperCase(), style: TextStyle(color: theme.textTertiary, fontSize: 11,
            fontWeight: FontWeight.w600, letterSpacing: 2)),
        ),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('主题模式', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: ThemeModeSetting.values.map((mode) {
              final sel = mode == currentMode;
              return GestureDetector(
                onTap: () => ref.read(themeModeProvider.notifier).state = mode,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    gradient: sel ? LinearGradient(colors: theme.gradientPrimary) : null,
                    color: sel ? null : theme.background,
                    borderRadius: BorderRadius.circular(20),
                    border: sel ? null : Border.all(color: theme.textTertiary.withValues(alpha: 0.2), width: 1),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(_getModeIcon(mode), color: sel ? Colors.white : theme.textSecondary, size: 16),
                    const SizedBox(width: 6),
                    Text(modeLabels[mode]!, style: TextStyle(
                      color: sel ? Colors.white : theme.textSecondary, fontSize: 12,
                      fontWeight: sel ? FontWeight.w600 : FontWeight.normal)),
                  ]),
                ),
              );
            }).toList()),
          ]),
        ),
        if (currentMode == ThemeModeSetting.manual) ...[
          const SizedBox(height: 12),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
              border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('选择主题', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
              const SizedBox(height: 12),
              for (final t in [
                {'theme': AppTheme.glassmorphism, 'name': '赛博霓虹'},
                {'theme': AppTheme.minimalZen, 'name': '极简禅意'},
                {'theme': AppTheme.natureOrganic, 'name': '自然有机'},
                {'theme': AppTheme.retroWave, 'name': '复古蒸汽波'},
                {'theme': AppTheme.corporatePro, 'name': '商务专业'},
              ]) ...[
                _buildThemePreview(t['theme'] as AppTheme, t['name'] as String, theme, ref),
                const SizedBox(height: 8),
              ],
            ]),
          ),
        ],
        const SizedBox(height: 8),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.gradientPrimary[0].withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1)),
          child: Row(children: [
            Container(width: 40, height: 40,
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10))),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('当前主题', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
              const SizedBox(height: 2),
              Text(theme.name, style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w600)),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: theme.gradientPrimary[0].withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8)),
              child: Text(modeLabels[currentMode]!, style: TextStyle(color: theme.gradientPrimary[0],
                fontSize: 11, fontWeight: FontWeight.w500)),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _buildThemePreview(AppTheme previewTheme, String name, AppTheme currentTheme, WidgetRef ref) {
    final sel = previewTheme.style == currentTheme.style;
    final idx = AppTheme.all.indexWhere((t) => t.style == previewTheme.style);
    return GestureDetector(
      onTap: () { if (idx >= 0) ref.read(currentThemeIndexProvider.notifier).state = idx; },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200), padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: sel ? previewTheme.gradientPrimary[0].withValues(alpha: 0.1) : currentTheme.background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: sel ? previewTheme.gradientPrimary[0] : currentTheme.textTertiary.withValues(alpha: 0.2),
            width: sel ? 2 : 1)),
        child: Row(children: [
          Row(children: [
            _buildColorDot(previewTheme.gradientPrimary[0]),
            _buildColorDot(previewTheme.gradientPrimary[1]),
            _buildColorDot(previewTheme.accent),
          ]),
          const SizedBox(width: 12),
          Expanded(child: Text(name, style: TextStyle(color: currentTheme.textPrimary, fontSize: 13,
            fontWeight: sel ? FontWeight.w600 : FontWeight.normal))),
          if (sel) Icon(Icons.check_circle, color: previewTheme.gradientPrimary[0], size: 20),
        ]),
      ),
    );
  }

  Widget _buildColorDot(Color c) => Container(
    margin: const EdgeInsets.only(right: 4), width: 16, height: 16,
    decoration: BoxDecoration(color: c, shape: BoxShape.circle,
      border: Border.all(color: Colors.white.withValues(alpha: 0.2), width: 1)),
  );

  IconData _getModeIcon(ThemeModeSetting mode) {
    switch (mode) {
      case ThemeModeSetting.auto: return Icons.brightness_auto;
      case ThemeModeSetting.light: return Icons.brightness_5;
      case ThemeModeSetting.dark: return Icons.brightness_2;
      case ThemeModeSetting.manual: return Icons.palette_outlined;
    }
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
    return ListCard(
      leading: Icon(icon, color: color, size: 20), leadingColor: color,
      title: title, subtitle: value.isNotEmpty ? value : null,
      onTap: onTap,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
    );
  }
}

class _BridgeUrlTile extends ConsumerStatefulWidget {
  final AppTheme theme;
  const _BridgeUrlTile({required this.theme});

  @override
  ConsumerState<_BridgeUrlTile> createState() => _BridgeUrlTileState();
}

class _BridgeUrlTileState extends ConsumerState<_BridgeUrlTile> {
  late TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(configProvider).baseUrl);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(configProvider);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Bridge 地址', style: TextStyle(color: widget.theme.textSecondary, fontSize: 13)),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: TextField(
            controller: _controller,
            style: TextStyle(color: widget.theme.textPrimary),
            decoration: InputDecoration(
              hintText: 'http://192.168.1.100:3800',
              hintStyle: TextStyle(color: widget.theme.textTertiary),
              filled: true, fillColor: widget.theme.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: widget.theme.textTertiary.withValues(alpha: 0.2))),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
          )),
          const SizedBox(width: 8),
          TextButton(onPressed: () {
            ref.read(configProvider.notifier).setBaseUrl(_controller.text);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('地址已更新'), duration: Duration(seconds: 2)));
          }, child: const Text('保存')),
        ]),
        const SizedBox(height: 4),
        Text('当前: ${config.baseUrl}', style: TextStyle(color: widget.theme.textTertiary, fontSize: 11)),
      ]),
    );
  }
}
