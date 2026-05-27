import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/sdui_config.dart';

class TaskDetailScreen extends ConsumerStatefulWidget {
  final String agentId;
  const TaskDetailScreen({super.key, required this.agentId});

  @override
  ConsumerState<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends ConsumerState<TaskDetailScreen> with SduiPageState {
  @override
  String get sduiPage => 'task_detail';

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final t = sduiLayout;
    final title = sduiStr('title', 'Task Detail');
    final statusLabel = sduiStr('statusLabel', 'Status');
    final infoLabel = sduiStr('infoLabel', 'Info');
    final resultLabel = sduiStr('resultLabel', 'Results');

    return Scaffold(
      backgroundColor: theme.background,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(title, style: TextStyle(
            color: theme.textPrimary,
            fontSize: 20,
            fontWeight: FontWeight.w600,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.share_outlined, color: theme.textSecondary),
            onPressed: () {},
          ),
          IconButton(
            icon: Icon(Icons.more_vert, color: theme.textSecondary),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [theme.background, theme.surface],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHeader(theme),
                const SizedBox(height: 24),
                _buildStatusSection(theme),
                const SizedBox(height: 24),
                _buildInfoSection(theme),
                const SizedBox(height: 24),
                _buildResultSection(theme),
                const SizedBox(height: 24),
                _buildActions(theme),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(AppTheme theme) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.gradientPrimary[0].withValues(alpha: 0.2),
            theme.gradientPrimary[1].withValues(alpha: 0.1),
          ],
        ),
        borderRadius: BorderRadius.circular(theme.radiusLarge),
        border: Border.all(
          color: theme.gradientPrimary[0].withValues(alpha: 0.3),
          width: 1,
        ),
        boxShadow: theme.useGlow ? [
          BoxShadow(
            color: theme.primary.withValues(alpha: 0.15),
            blurRadius: 25,
            spreadRadius: -5,
          ),
        ] : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: theme.gradientPrimary),
                  borderRadius: BorderRadius.circular(theme.radiusMedium - 4),
                  boxShadow: theme.useGlow ? [
                    BoxShadow(
                      color: theme.primary.withValues(alpha: 0.4),
                      blurRadius: 15,
                      spreadRadius: 2,
                    ),
                  ] : null,
                ),
                child: const Icon(
                  Icons.task_alt,
                  color: Colors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Code Review #${widget.agentId}',
                      style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '鍒涘缓浜?024-01-15',
                      style: TextStyle(
                        color: theme.textTertiary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Review project code for security vulnerabilities and performance issues.',
            style: TextStyle(
              color: theme.textSecondary,
              fontSize: 14,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusSection(AppTheme theme) {
    final label = sduiStr('statusLabel', 'Status');
    final items = (sduiLayout['statusItems'] as List?)?.map((e) {
      if (e is! Map) return <String, String>{};
      return {'label': e['label'] as String? ?? '', 'status': e['status'] as String? ?? '', 'color': _statusColor(e['status'] as String? ?? '')};
    }).toList() ?? [
      {'label': 'Analyze code', 'status': 'Completed', 'color': '#4CAF50'},
      {'label': 'Scan vulns', 'status': 'Completed', 'color': '#4CAF50'},
      {'label': 'Performance', 'status': 'In Progress', 'color': '#FF9800'},
      {'label': 'Generate report', 'status': 'Pending', 'color': '#9E9E9E'},
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
      const SizedBox(height: 12),
      Container(padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(theme.radiusMedium), border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1))),
        child: _buildForEach(items, (item, _) => _buildStatusItem(item, theme)),
      ),
    ]);
  }

  String _statusColor(String status) => status == 'Completed' ? '#4CAF50' : status == 'In Progress' ? '#FF9800' : '#9E9E9E';

  Widget _buildForEach(List<Map<String, String>> items, Widget Function(Map<String, String>, int) builder) {
    return Column(children: items.asMap().entries.map((e) {
      final sep = e.key > 0 ? const SizedBox(height: 12) : const SizedBox();
      return Column(children: [sep, builder(e.value, e.key)]);
    }).toList());
  }

  Widget _buildStatusItem(Map<String, String> item, AppTheme theme) {
    final isCompleted = item['status'] == 'Completed';
    final color = _hexOr(item['color'], isCompleted ? theme.success : theme.textTertiary);
    return Row(children: [
      Container(width: 24, height: 24,
        decoration: BoxDecoration(color: isCompleted ? color : Colors.transparent, borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isCompleted ? color : theme.textTertiary, width: 2)),
        child: isCompleted ? const Icon(Icons.check, color: Colors.white, size: 16) : null),
      const SizedBox(width: 12),
      Expanded(child: Text(item['label'] ?? '', style: TextStyle(color: theme.textPrimary, fontSize: 14))),
      Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
        child: Text(item['status'] ?? '', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w500))),
    ]);
  }

  Color _hexOr(String? hex, Color fallback) {
    if (hex == null) return fallback;
    try { return Color(int.parse(hex.replaceAll('#', '0xFF'))); } catch (_) { return fallback; }
  }

  Widget _buildInfoSection(AppTheme theme) {
    final infoLabel = sduiLayout['infoLabel'] as String? ?? '基本信息';
    final items = (sduiLayout['infoItems'] as List?)?.map((e) {
      if (e is! Map) return ['', ''];
      return [(e['label'] as String? ?? ''), (e['value'] as String? ?? '')];
    }).toList() ?? [
      ['Executor', 'AI Agent'], ['Priority', 'High'], ['Time', '15 min'], ['Deadline', '2024-01-20'],
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(infoLabel, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
      const SizedBox(height: 12),
      Container(padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(theme.radiusMedium), border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1))),
        child: Column(children: items.asMap().entries.map((e) {
          final sep = e.key > 0 ? const SizedBox(height: 10) : const SizedBox();
          return Column(children: [sep, _buildInfoRow(e.value[0], e.value[1], theme)]);
        }).toList()),
      ),
    ]);
  }

  Widget _buildInfoRow(String label, String value, AppTheme theme) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            color: theme.textSecondary,
            fontSize: 13,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: theme.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  Widget _buildResultSection(AppTheme theme) {
    final label = sduiStr('resultLabel', 'Results');
    final items = (sduiLayout['resultItems'] as List?)?.map((e) {
      if (e is! Map) return <String, String>{};
      return {'label': e['label'] as String? ?? '', 'value': e['value'] as String? ?? '', 'color': e['color'] as String? ?? '#9E9E9E'};
    }).toList() ?? [
      {'label': 'Issues', 'value': '3', 'color': '#F44336'},
      {'label': 'Warnings', 'value': '7', 'color': '#FF9800'},
      {'label': 'Suggestions', 'value': '12', 'color': '#2196F3'},
      {'label': '浠ｇ爜璐ㄩ噺璇勫垎', 'value': '85', 'color': '#4CAF50'},
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
      const SizedBox(height: 12),
      Container(padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(theme.radiusMedium), border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1))),
        child: Column(children: items.asMap().entries.map((e) {
          final sep = e.key > 0 ? const SizedBox(height: 12) : const SizedBox();
          return Column(children: [sep, _buildResultStatRow(e.value, theme)]);
        }).toList()),
      ),
    ]);
  }

  Widget _buildResultStatRow(Map<String, String> item, AppTheme theme) {
    final color = _hexOr(item['color'], theme.textTertiary);
    return Row(children: [
      Container(width: 8, height: 8, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4))),
      const SizedBox(width: 12),
      Expanded(child: Text(item['label'] ?? '', style: TextStyle(color: theme.textSecondary, fontSize: 13))),
      Text(item['value'] ?? '', style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.bold)),
    ]);
  }

  Widget _buildActions(AppTheme theme) {
    final actions = (sduiLayout['actions'] as List?)?.map((e) {
      if (e is! Map) return <String, String>{};
      return {'label': e['label'] as String? ?? '', 'color': e['color'] as String? ?? '', 'primary': (e['primary'] == true).toString()};
    }).toList() ?? [
      {'label': '鏆傚仠浠诲姟', 'color': '', 'primary': 'false'},
      {'label': '鏌ョ湅鎶ュ憡', 'color': '', 'primary': 'true'},
    ];
    return Row(children: actions.asMap().entries.map((e) {
      final item = e.value;
      final isPrimary = item['primary'] == 'true';
      final isLast = e.key < actions.length - 1;
      return Expanded(child: Padding(
        padding: EdgeInsets.only(right: isLast ? 12 : 0),
        child: GestureDetector(
          onTap: () {},
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              gradient: isPrimary ? LinearGradient(colors: theme.gradientPrimary) : null,
              color: isPrimary ? null : theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
              border: isPrimary ? null : Border.all(color: theme.textTertiary.withValues(alpha: 0.2), width: 1)),
            child: Center(child: Text(item['label'] ?? '', style: TextStyle(color: isPrimary ? Colors.white : theme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600))),
          )),
      ));
    }).toList());
  }
}
