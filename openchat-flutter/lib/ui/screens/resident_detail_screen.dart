import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../core/models/agent_model.dart';
import '../../core/models/sage_model.dart';
import '../../providers/theme_provider.dart';
import '../../providers/resident_provider.dart';
import '../../providers/sage_provider.dart';
import '../../core/sdui_config.dart';
import '../components/resident/resident_profile.dart';
import '../components/resident/resident_family.dart';
import '../components/resident/resident_agents.dart';
import '../components/resident/resident_timeline.dart';
import '../components/resident/resident_mentor.dart';

class ResidentDetailScreen extends ConsumerStatefulWidget {
  final String residentId;
  const ResidentDetailScreen({super.key, required this.residentId});

  @override
  ConsumerState<ResidentDetailScreen> createState() => _ResidentDetailScreenState();
}

class _ResidentDetailScreenState extends ConsumerState<ResidentDetailScreen> with AppSduiPageState {
  @override
  String get sduiPage => 'resident_detail';
  Resident? _resident;
  List<Agent> _agents = [];
  List<Resident> _children = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final notifier = ref.read(residentProvider.notifier);
      _resident = await notifier.getDetail(widget.residentId);
      _agents = await notifier.getAgents(widget.residentId);
      _children = (await notifier.getChildren(widget.residentId)).whereType<Resident>().toList();
      ref.read(sageProvider.notifier).loadConversation(widget.residentId);
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  void _showCreateAgentDialog() {
    final rc = TextEditingController(text: 'custom');
    final nc = TextEditingController();
    final tc = TextEditingController();
    showDialog(context: context, builder: (ctx) => AlertDialog(
      backgroundColor: ref.read(currentThemeProvider).surface,
      title: Text(sduiLayout['createAgentTitle'] as String? ?? '娲惧嚭 Agent'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: rc, decoration: const InputDecoration(labelText: '瑙掕壊', hintText: 'security_auditor / test_engineer / custom'), style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
        const SizedBox(height: 12),
        TextField(controller: nc, decoration: const InputDecoration(labelText: '鍚嶇О锛堝彲閫夛級'), style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
        const SizedBox(height: 12),
        TextField(controller: tc, decoration: const InputDecoration(labelText: '浠诲姟鎻忚堪'), maxLines: 3, style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('鍙栨秷')),
        TextButton(onPressed: () {
          ref.read(residentProvider.notifier).createAgent(role: rc.text, name: nc.text.isEmpty ? null : nc.text, task: tc.text);
          Navigator.pop(ctx);
        }, child: Text('娲惧嚭', style: TextStyle(color: ref.read(currentThemeProvider).primary))),
      ],
    ));
    rc.dispose(); nc.dispose(); tc.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final title = sduiLayout['title'] as String? ?? (_resident?.name ?? '灞呮皯妗ｆ');
    final tab1 = sduiLayout['tab1'] as String? ?? '鏃堕棿绾?;
    final tab2 = sduiLayout['tab2'] as String? ?? '甯堝緬瀵硅瘽';

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        backgroundColor: theme.background,
        appBar: AppBar(
          backgroundColor: Colors.transparent, elevation: 0,
          title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 20, fontWeight: FontWeight.bold)),
          actions: _resident != null && _resident!.isActive ? [
            IconButton(icon: const Icon(Icons.auto_awesome_outlined, color: Colors.amberAccent), onPressed: _showCreateAgentDialog, tooltip: '鏅鸿€呯偣鎷?),
            IconButton(icon: Icon(Icons.add_task_rounded, color: theme.primary), onPressed: _showCreateAgentDialog, tooltip: '娲惧嚭 Agent'),
          ] : null,
          bottom: _resident != null ? TabBar(indicatorColor: theme.primary, labelColor: theme.primary, unselectedLabelColor: theme.textTertiary, tabs: [Tab(text: tab1), Tab(text: tab2)]) : null,
        ),
        body: _loading ? const Center(child: CircularProgressIndicator())
          : _resident == null ? Center(child: Text('灞呮皯涓嶅瓨鍦?, style: TextStyle(color: theme.textSecondary)))
          : Container(
              decoration: BoxDecoration(gradient: LinearGradient(colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
              child: SafeArea(child: TabBarView(children: [
                CustomScrollView(slivers: [
                  ResidentProfile(theme: theme, resident: _resident!),
                  ResidentFamily(theme: theme, resident: _resident!, children: _children),
                  ResidentAgents(theme: theme, agents: _agents),
                  ResidentTimeline(theme: theme, activities: _resident!.activities),
                ]),
                ResidentMentor(theme: theme, conversations: ref.watch(sageProvider).valueOrNull ?? [], onReply: (r) => _showReplyDialog(r), onAskWisdom: _showCreateAgentDialog),
              ])),
            ),
        floatingActionButton: _resident != null && _resident!.isActive
          ? Column(mainAxisSize: MainAxisSize.min, children: [
              FloatingActionButton.small(heroTag: 'child', onPressed: () {}, backgroundColor: theme.success.withValues(alpha: 0.8), child: const Icon(Icons.family_restroom_rounded, color: Colors.white)),
              const SizedBox(height: 12),
              FloatingActionButton.extended(heroTag: 'agent', onPressed: _showCreateAgentDialog, backgroundColor: theme.primary, icon: const Icon(Icons.add_task_rounded, color: Colors.white), label: const Text('娲惧嚭 Agent', style: TextStyle(color: Colors.white))),
            ]) : null,
      ),
    );
  }

  void _showReplyDialog(SageRecord record) {
    final controller = TextEditingController();
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('鍥炲'), content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: '杈撳叆鍥炲...')), actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('鍙栨秷')),
        TextButton(onPressed: () { ref.read(sageProvider.notifier).reply(record.id, controller.text); Navigator.pop(ctx); }, child: const Text('鍙戦€?)),
      ],
    ));
    controller.dispose();
  }
}
