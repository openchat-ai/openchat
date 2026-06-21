import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../../core/sdui_config.dart';

class PlanScreen extends ConsumerStatefulWidget {
  const PlanScreen({super.key});

  @override
  ConsumerState<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends ConsumerState<PlanScreen> with SduiPageState {
  @override
  String get sduiPage => 'plan';

  final _controller = TextEditingController();
  String _spec = '';
  bool _loading = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _generatePlan() async {
    final msg = _controller.text.trim();
    if (msg.isEmpty) return;
    setState(() { _loading = true; _spec = ''; });

    try {
      final config = ref.read(configProvider);
      final dio = Dio(BaseOptions(
        baseUrl: config.baseUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 120),
      ));
      final res = await dio.post('/api/plan', data: {
        'message': msg,
        'workspace': 'plan_${DateTime.now().millisecondsSinceEpoch}'
      });
      setState(() => _spec = res.data['spec'] as String? ?? '(empty)');
    } catch (e) {
      setState(() => _spec = 'Error: $e');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final title = sduiStr('title', 'Plan');

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 22, fontWeight: FontWeight.bold)),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: InputDecoration(
                      hintText: 'Describe what to build...',
                      filled: true,
                      fillColor: theme.surface,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    ),
                    style: TextStyle(color: theme.textPrimary),
                    maxLines: 3,
                  ),
                ),
                const SizedBox(width: 12),
                ElevatedButton(
                  onPressed: _loading ? null : _generatePlan,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: theme.primary,
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: _loading
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.auto_awesome, color: Colors.white),
                ),
              ],
            ),
          ),
          if (_spec.isNotEmpty)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: SingleChildScrollView(
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: theme.surface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: SelectableText(_spec, style: TextStyle(color: theme.textPrimary, fontFamily: 'monospace', fontSize: 13)),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
