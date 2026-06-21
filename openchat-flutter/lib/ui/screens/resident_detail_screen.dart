import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/audio/audio.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../core/models/agent_model.dart';
import '../../providers/client_providers.dart';
import '../../core/sdui_config.dart';
import '../components/resident/resident.dart';

class ResidentDetailScreen extends ConsumerStatefulWidget {
  final String residentId;
  const ResidentDetailScreen({super.key, required this.residentId});

  @override
  ConsumerState<ResidentDetailScreen> createState() => _ResidentDetailScreenState();
}

class _ResidentDetailScreenState extends ConsumerState<ResidentDetailScreen> with SduiPageState {
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
      final id = int.tryParse(widget.residentId) ?? 0;
      final notifier = ref.read(residentProvider.notifier);
      _resident = await notifier.getDetail(id);
      _agents = await notifier.getAgents(id);
      _children = (await notifier.getChildren(id)).whereType<Resident>().toList();
      ref.read(sageProvider.notifier).loadConversation(id);
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  void _showScore() {
    const gap = 0.05;
    const dur = 0.4;
    final midis = [60, 62, 64, 65, 67, 69, 71, 72];
    final notes = List.generate(midis.length, (i) => ScoreNote(midi: midis[i], startSec: i * (dur + gap), durSec: dur));
    showModalBottomSheet(
      context: context,
      backgroundColor: ref.read(currentThemeProvider).surface,
      builder: (_) => ResidentMusicScore(title: 'C Major Scale', notes: notes),
    );
  }

  void _showCreateAgentDialog() {
    final rid = int.tryParse(widget.residentId) ?? 0;
    final rc = TextEditingController(text: 'custom');
    final nc = TextEditingController();
    final tc = TextEditingController();
    showDialog(context: context, builder: (ctx) => AlertDialog(
      backgroundColor: ref.read(currentThemeProvider).surface,
      title: Text(sduiStr('createAgentTitle', 'Spawn Agent')),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: rc, decoration: const InputDecoration(labelText: 'Role', hintText: 'security_auditor / test_engineer / custom'), style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
        const SizedBox(height: 12),
        TextField(controller: nc, decoration: const InputDecoration(labelText: 'Name (optional)'), style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
        const SizedBox(height: 12),
        TextField(controller: tc, decoration: const InputDecoration(labelText: 'Task'), maxLines: 3, style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        TextButton(onPressed: () {
          ref.read(residentProvider.notifier).createAgent(residentId: rid, role: rc.text, name: nc.text.isEmpty ? null : nc.text, task: tc.text);
          Navigator.pop(ctx);
        }, child: Text('Create', style: TextStyle(color: ref.read(currentThemeProvider).primary))),
      ],
    ));
    rc.dispose(); nc.dispose(); tc.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final title = sduiStr('title', _resident?.name ?? 'Resident');
    final tab1 = sduiStr('tab1', 'Timeline');
    final tab2 = sduiStr('tab2', 'Mentor');

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        backgroundColor: theme.background,
        appBar: AppBar(
          backgroundColor: Colors.transparent, elevation: 0,
          title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 20, fontWeight: FontWeight.bold)),
          actions: _resident != null && _resident!.isActive ? [
            IconButton(icon: const Icon(Icons.auto_awesome_outlined, color: Colors.amberAccent), onPressed: _showCreateAgentDialog, tooltip: 'Wisdom'),
            IconButton(icon: Icon(Icons.add_task_rounded, color: theme.primary), onPressed: _showCreateAgentDialog, tooltip: 'Spawn Agent'),
            IconButton(icon: const Icon(Icons.music_note, color: Colors.green), onPressed: _showScore, tooltip: 'Sheet Music'),
          ] : null,
          bottom: _resident != null ? TabBar(indicatorColor: theme.primary, labelColor: theme.primary, unselectedLabelColor: theme.textTertiary, tabs: [Tab(text: tab1), Tab(text: tab2)]) : null,
        ),
        body: _loading ? const Center(child: CircularProgressIndicator())
          : _resident == null ? Center(child: Text('Resident not found', style: TextStyle(color: theme.textSecondary)))
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
      title: const Text('Reply'), content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: 'Enter reply...')), actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        TextButton(onPressed: () { Navigator.pop(ctx); }, child: const Text('Send')),
      ],
    ));
    controller.dispose();
  }
}
