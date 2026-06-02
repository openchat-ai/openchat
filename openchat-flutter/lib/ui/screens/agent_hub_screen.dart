import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../providers/theme_provider.dart';
import '../../providers/resident_provider.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import 'resident_detail_screen.dart';
import 'agent_hub_widgets.dart';

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
          AgentHubWidgets.buildActionButton(Icons.refresh_rounded, theme, () => ref.read(residentProvider.notifier).refresh()),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: residentsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => AgentHubWidgets.buildEmptyState(theme, sduiLayout['errorState'] as Map? ?? {'icon': 'error', 'title': '加载失败'}),
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
              return ResidentFallbackList(
                theme: theme,
                residents: residents,
                emptyState: AgentHubWidgets.buildEmptyState(theme, sduiLayout['emptyState'] as Map?),
              );
            },
          ),
        ),
      ),
      floatingActionButton: _buildCreateButton(theme),
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
