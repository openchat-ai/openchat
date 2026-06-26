import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/experiments_client.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';

/// Plan 页面:项目管理 + DNA + goal 拆解
class PlanScreen extends ConsumerStatefulWidget {
  const PlanScreen({super.key});
  @override
  ConsumerState<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends ConsumerState<PlanScreen> {
  String _projects = '';
  String _goalOutput = '';
  bool _loading = false;
  final _goalController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _goalController.dispose();
    super.dispose();
  }

  ExperimentsClient get _client =>
      ref.read(experimentsClientProvider);

  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final p = await _client.projects();
      if (mounted) setState(() => _projects = p);
    } catch (e) {
      if (mounted) setState(() => _projects = '[error] $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _runGoal() async {
    final desc = _goalController.text.trim();
    if (desc.isEmpty) return;
    setState(() {
      _loading = true;
      _goalOutput = '';
    });
    try {
      final r = await _client.run('goal', inputs: {'description': desc, 'sessionId': 'plan-${Date.now().millisecondsSinceEpoch}'});
      _goalOutput = (r['outputs'] is Map ? (r['outputs']['summary']?.toString() ?? r['outputs'].toString()) : r.toString());
    } catch (e) {
      _goalOutput = '[error] $e';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        title: const Text('Plan'),
        backgroundColor: theme.surface,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _refresh,
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _section(theme, 'DNA Projects', _projects.isEmpty ? '(loading)' : _projects),
            const SizedBox(height: 16),
            _section(theme, 'Goal Decompose',
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                TextField(
                  controller: _goalController,
                  maxLines: 2,
                  decoration: InputDecoration(
                    hintText: 'Describe the goal to decompose + execute',
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                    filled: true,
                    fillColor: theme.surface.withValues(alpha: 0.5),
                  ),
                ),
                const SizedBox(height: 8),
                FilledButton.icon(
                  onPressed: _loading ? null : _runGoal,
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Run goal'),
                ),
                if (_goalOutput.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.surface.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: theme.textTertiary.withValues(alpha: 0.2)),
                    ),
                    child: SelectableText(_goalOutput, style: TextStyle(color: theme.textPrimary, fontSize: 12)),
                  ),
                ],
              ]),
            ),
          ],
        ),
      ),
    );
  }

  Widget _section(AppTheme theme, String title, dynamic body) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        if (body is Widget) body,
        if (body is String)
          SelectableText(body, style: TextStyle(color: theme.textSecondary, fontSize: 12, height: 1.4)),
      ]),
    );
  }
}
