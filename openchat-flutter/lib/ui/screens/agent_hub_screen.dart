import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../providers/theme_provider.dart';
import '../../providers/resident_provider.dart';
import '../../core/sdui_config.dart';
import 'resident_detail_screen.dart';
import '../components/cards/app_cards.dart';

class AgentHubScreen extends ConsumerStatefulWidget {
  const AgentHubScreen({super.key});

  @override
  ConsumerState<AgentHubScreen> createState() => _AgentHubScreenState();
}

class _AgentHubScreenState extends ConsumerState<AgentHubScreen> {
  Map? _uiConfig;
  Timer? _configTimer;

  @override
  void initState() {
    super.initState();
    _loadConfig();
    _configTimer = Timer.periodic(const Duration(seconds: 30), (_) => _loadConfig());
  }

  @override
  void dispose() {
    _configTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadConfig() async {
    final cfg = await SduiConfig.load('oc/config/ui_agent.json');
    if (mounted) setState(() => _uiConfig = cfg);
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final residentsAsync = ref.watch(residentProvider);
    final title = _uiConfig?['title'] as String? ?? 'AI 居民';

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 24,
          fontWeight: FontWeight.bold, letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 2)),
        actions: [
          _buildActionButton(Icons.refresh_rounded, theme, () => ref.read(residentProvider.notifier).refresh()),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: residentsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.error_outline, color: theme.error, size: 48),
              const SizedBox(height: 16),
              Text('加载失败', style: TextStyle(color: theme.textSecondary)),
            ])),
            data: (residents) => CustomScrollView(
              slivers: [
                _buildStatsHeader(theme, residents),
                _buildSectionTitle(theme, '居民名单', residents.length),
                _buildResidentList(theme, residents),
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: _buildCreateButton(theme),
    );
  }

  Widget _buildActionButton(IconData icon, AppTheme theme, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 8), padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
          border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
        child: Icon(icon, color: theme.textSecondary, size: 20),
      ),
    );
  }

  Widget _buildStatsHeader(AppTheme theme, List<Resident> residents) {
    final active = residents.where((r) => r.isActive).length;
    final sleeping = residents.where((r) => r.status == 'sleeping').length;
    final deleted = residents.where((r) => r.isDeleted).length;
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(children: [
          Expanded(child: StatCard(label: '活跃', value: '$active', icon: Icons.play_circle_outline,
            color: theme.success, onTap: () {})),
          const SizedBox(width: 12),
          Expanded(child: StatCard(label: '休眠', value: '$sleeping', icon: Icons.pending_outlined,
            color: theme.warning, onTap: () {})),
          const SizedBox(width: 12),
          Expanded(child: StatCard(label: '已注销', value: '$deleted', icon: Icons.check_circle_outline,
            color: theme.info, onTap: () {})),
        ]),
      ),
    );
  }

  Widget _buildSectionTitle(AppTheme theme, String title, int count) {
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
        child: Row(children: [
          Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 18, fontWeight: FontWeight.w600)),
          const SizedBox(width: 8),
          Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(color: theme.primary.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
            child: Text('$count', style: TextStyle(color: theme.primary, fontSize: 12, fontWeight: FontWeight.w600))),
        ]),
      ),
    );
  }

  Widget _buildResidentList(AppTheme theme, List<Resident> residents) {
    if (residents.isEmpty) {
      final ec = _uiConfig?['emptyState'] as Map?;
      return SliverToBoxAdapter(
        child: Container(
          padding: const EdgeInsets.all(60),
          child: Column(children: [
            Icon(_remoteIcon(ec?['icon'] as String?) ?? Icons.person_outline,
              color: theme.textTertiary, size: 64),
            const SizedBox(height: 16),
            Text(ec?['title'] as String? ?? '还没有 AI 居民',
              style: TextStyle(color: theme.textSecondary, fontSize: 16)),
            if (ec?['subtitle'] != null) ...[
              const SizedBox(height: 8),
              Text(ec!['subtitle'] as String, style: TextStyle(color: theme.textTertiary, fontSize: 13)),
            ],
          ]),
        ),
      );
    }
    return SliverPadding(
      padding: const EdgeInsets.all(16),
      sliver: SliverList(delegate: SliverChildBuilderDelegate(
        (context, index) => _buildResidentCard(context, theme, residents[index]),
        childCount: residents.length,
      )),
    );
  }

  IconData? _remoteIcon(String? name) {
    if (name == null) return null;
    final icons = {
      'person': Icons.person_outline, 'inbox': Icons.inbox_outlined,
      'smart_toy': Icons.smart_toy_outlined, 'error': Icons.error_outline,
    };
    return icons[name];
  }

  Widget _buildResidentCard(BuildContext context, AppTheme theme, Resident resident) {
    final isActive = resident.isActive;
    return GestureDetector(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ResidentDetailScreen(residentId: resident.id))),
      child: Container(
        margin: const EdgeInsets.only(bottom: 16), padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusLarge),
          border: Border.all(color: isActive ? theme.gradientPrimary[0].withValues(alpha: 0.4)
            : theme.textTertiary.withValues(alpha: 0.08), width: 1)),
        child: Row(children: [
          _buildResidentAvatar(theme, resident),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(resident.name, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
              if (isActive) ...[
                const SizedBox(width: 8),
                Container(width: 8, height: 8,
                  decoration: BoxDecoration(color: theme.success, borderRadius: BorderRadius.circular(4))),
              ],
              if (resident.isDeleted) ...[
                const SizedBox(width: 8),
                Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: theme.textTertiary.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(4)),
                  child: Text('已注销', style: TextStyle(color: theme.textTertiary, fontSize: 10))),
              ],
            ]),
            const SizedBox(height: 6),
            Text('ID: ${resident.id} · ${resident.home}', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
            const SizedBox(height: 10),
            Row(children: [
              _buildTag(resident.status, theme.gradientPrimary[0], theme),
              const SizedBox(width: 6),
              _buildTag('${_daysSince(resident.createdAt)} 天', theme.gradientPrimary[1], theme),
            ]),
          ])),
          if (!resident.isDeleted)
            GestureDetector(
              onTap: () => _confirmDelete(context, resident),
              child: Icon(Icons.delete_outline_rounded, color: theme.textTertiary, size: 20)),
        ]),
      ),
    );
  }

  Widget _buildResidentAvatar(AppTheme theme, Resident resident) {
    final colors = [
      theme.gradientPrimary,
      [theme.success, theme.success.withValues(alpha: 0.7)],
      [theme.warning, theme.warning.withValues(alpha: 0.7)],
      [theme.info, theme.info.withValues(alpha: 0.7)],
      [Colors.purple, Colors.purple.withValues(alpha: 0.7)],
    ];
    final palette = colors[resident.id % colors.length];
    return Container(
      width: 60, height: 60,
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: palette),
        borderRadius: BorderRadius.circular(theme.radiusMedium - 4)),
      child: Center(child: Text(resident.name.isNotEmpty ? resident.name[0] : '?',
        style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold))),
    );
  }

  Widget _buildTag(String text, Color color, AppTheme theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.3), width: 1)),
      child: Text(text, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w500)),
    );
  }

  Widget _buildCreateButton(AppTheme theme) {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: theme.gradientPrimary),
        borderRadius: BorderRadius.circular(theme.radiusMedium - 4)),
      child: FloatingActionButton.extended(
        onPressed: () => _showCreateDialog(context, theme),
        backgroundColor: Colors.transparent, elevation: 0,
        icon: const Icon(Icons.person_add_rounded, color: Colors.white),
        label: const Text('新居民', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      ),
    );
  }

  void _showCreateDialog(BuildContext context, AppTheme theme) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('创建 AI 居民', style: TextStyle(color: theme.textPrimary)),
        content: TextField(
          controller: controller, autofocus: true,
          decoration: InputDecoration(
            hintText: '输入名字（留空自动生成）',
            hintStyle: TextStyle(color: theme.textTertiary),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: theme.textTertiary.withValues(alpha: 0.2))),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: theme.primary))),
          style: TextStyle(color: theme.textPrimary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx),
            child: Text('取消', style: TextStyle(color: theme.textSecondary))),
          TextButton(onPressed: () {
            final name = controller.text.trim();
            ref.read(residentProvider.notifier).create(name: name.isEmpty ? null : name);
            Navigator.pop(ctx);
          }, child: Text('创建', style: TextStyle(color: theme.primary))),
        ],
      ),
    );
  }

  void _confirmDelete(BuildContext context, Resident resident) {
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('确认注销'), content: Text('确定要注销「${resident.name}」吗？'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
        TextButton(onPressed: () { ref.read(residentProvider.notifier).delete(resident.id); Navigator.pop(ctx); },
          child: const Text('注销', style: TextStyle(color: Colors.red))),
      ],
    ));
  }

  int _daysSince(DateTime date) => DateTime.now().difference(date).inDays;
}
