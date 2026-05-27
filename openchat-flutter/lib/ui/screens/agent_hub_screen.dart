import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../providers/theme_provider.dart';
import '../../providers/resident_provider.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import 'resident_detail_screen.dart';

class AgentHubScreen extends ConsumerStatefulWidget {
  const AgentHubScreen({super.key});

  @override
  ConsumerState<AgentHubScreen> createState() => _AgentHubScreenState();
}

class _AgentHubScreenState extends ConsumerState<AgentHubScreen> with SduiPageState {
  @override
  String get sduiPage => 'agent';

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final residentsAsync = ref.watch(residentProvider);
    final title = sduiStr('title', 'AI Residents');

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
            error: (e, _) => _buildEmptyState(theme, sduiLayout['errorState'] as Map? ?? {'icon': 'error', 'title': '加载失败'}),
            data: (residents) {
              final residentItems = residents.map((r) => {
                'id': r.id.toString(),
                'name': r.name,
                'status': r.status,
                'home': r.home,
                'isActive': r.isActive.toString(),
                'isDeleted': r.isDeleted.toString(),
                'daysSince': _daysSince(r.createdAt).toString(),
                'avatar': r.name.isNotEmpty ? r.name[0] : '?',
              }).toList();
              final listLayout = sduiLayout['listLayout'] as Map?;
              if (listLayout != null) {
                final sl = sduiLayout['stats'] as Map?;
                final active = residents.where((r) => r.isActive).length;
                final sleeping = residents.where((r) => r.status == 'sleeping').length;
                final deleted = residents.where((r) => r.isDeleted).length;
                final parser = SduiParser(onAction: (a) {
                  if (a == 'create') _showCreateDialog(context, theme);
                  else if (a.startsWith('navigate:')) Navigator.push(context, MaterialPageRoute(
                    builder: (_) => ResidentDetailScreen(residentId: a.substring(9))));
                  else if (a.startsWith('delete:')) {
                    final id = a.substring(7);
                    final r = residents.where((x) => x.id.toString() == id).firstOrNull;
                    if (r != null) _confirmDelete(context, r);
                  }
                }, vars: {
                  'items': residentItems,
                  'active': active.toString(),
                  'sleeping': sleeping.toString(),
                  'deleted': deleted.toString(),
                  'sectionTitle': sduiStr('sectionTitle', 'Residents'),
                  'statsIcon1': sl?['icon1'] ?? 'active',
                  'statsLabel1': sl?['label1'] ?? 'Active',
                  'statsIcon2': sl?['icon2'] ?? 'sleep',
                  'statsLabel2': sl?['label2'] ?? '浼戠湢',
                  'statsIcon3': sl?['icon3'] ?? 'check',
                  'statsLabel3': sl?['label3'] ?? '宸叉敞閿€',
                });
                final widget = parser.parse(listLayout);
                if (widget != null) {
                  return SingleChildScrollView(child: widget);
                }
              }
              return _buildFallbackList(theme, residents);
            },
          ),
        ),
      ),
      floatingActionButton: _buildCreateButton(theme),
    );
  }

  Widget _buildEmptyState(AppTheme theme, Map? state) {
    if (state == null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.person_outline, color: theme.textTertiary, size: 64),
        const SizedBox(height: 16),
        Text('杩樻病鏈?AI 灞呮皯', style: TextStyle(color: theme.textSecondary, fontSize: 16)),
      ]));
    }
    final parser = SduiParser(vars: {}, onAction: null);
    final node = {
      'type': 'column', 'center': true, 'children': [
        {'type': 'padding', 'padding': 32, 'child': {'type': 'icon', 'icon': state['icon'] ?? 'person', 'size': 64}},
        if (state['title'] != null) {'type': 'text', 'content': state['title'], 'style': {'size': 16}, 'pad': 8},
        if (state['subtitle'] != null) {'type': 'text', 'content': state['subtitle'], 'style': {'size': 13, 'color': '#9E9E9E'}},
      ],
    };
    return Center(child: parser.parse(node));
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

  Widget _buildFallbackList(AppTheme theme, List<Resident> residents) {
    if (residents.isEmpty) return _buildEmptyState(theme, sduiLayout['emptyState'] as Map?);
    return ListView(padding: const EdgeInsets.all(16), children: residents.map((r) {
      final isActive = r.isActive;
      return Container(
        margin: const EdgeInsets.only(bottom: 16), padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusLarge),
          border: Border.all(color: isActive ? theme.gradientPrimary[0].withValues(alpha: 0.4)
            : theme.textTertiary.withValues(alpha: 0.08), width: 1)),
        child: Row(children: [
          Text(r.name.isNotEmpty ? r.name[0] : '?',
            style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.name, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
            Text('ID: ${r.id} 路 ${r.home}', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
          ])),
        ]),
      );
    }).toList());
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
        label: const Text('New Resident', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
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
        title: Text(sduiLayout['createTitle'] as String? ?? 'Create AI Resident', style: TextStyle(color: theme.textPrimary)),
        content: TextField(
          controller: controller, autofocus: true,
          decoration: InputDecoration(
            hintText: sduiLayout['createHint'] as String? ?? 'Name (leave empty for auto)',
            hintStyle: TextStyle(color: theme.textTertiary),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: theme.textTertiary.withValues(alpha: 0.2))),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: theme.primary))),
          style: TextStyle(color: theme.textPrimary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: theme.textSecondary))),
          TextButton(onPressed: () {
            final name = controller.text.trim();
            ref.read(residentProvider.notifier).create(name: name.isEmpty ? null : name);
            Navigator.pop(ctx);
          }, child: Text('Create', style: TextStyle(color: theme.primary))),
        ],
      ),
    );
  }

  void _confirmDelete(BuildContext context, Resident resident) {
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Confirm Delete'), content: Text('Delete "${resident.name}"?'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        TextButton(onPressed: () { ref.read(residentProvider.notifier).delete(resident.id); Navigator.pop(ctx); },
          child: const Text('Delete', style: TextStyle(color: Colors.red))),
      ],
    ));
  }

  int _daysSince(DateTime date) => DateTime.now().difference(date).inDays;
}
