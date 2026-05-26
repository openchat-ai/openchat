import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';

class TaskDetailScreen extends ConsumerStatefulWidget {
  final String agentId;
  const TaskDetailScreen({super.key, required this.agentId});

  @override
  ConsumerState<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends ConsumerState<TaskDetailScreen> {
  Map<String, dynamic>? _sduiLayout;

  @override
  void initState() {
    super.initState();
    QiniuDirectClient.fetchConfigFile('oc/config/ui_task_detail.json')
        .then((m) { if (mounted && m is Map) setState(() => _sduiLayout = Map<String, dynamic>.from(m)); });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final t = _sduiLayout ?? {};
    final title = t['title'] as String? ?? '任务详情';
    final statusLabel = t['statusLabel'] as String? ?? '状态';
    final infoLabel = t['infoLabel'] as String? ?? '基本信息';
    final resultLabel = t['resultLabel'] as String? ?? '执行结果';

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
                      '代码审查任务 #$agentId',
                      style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '创建于2024-01-15',
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
            '对项目代码进行全面审查，检查潜在的安全漏洞和性能问题，并提供优化建议。',
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '任务状态',
          style: TextStyle(
            color: theme.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(
              color: theme.textTertiary.withValues(alpha: 0.1),
              width: 1,
            ),
          ),
          child: Column(
            children: [
              _buildStatusItem('分析代码', '已完成', theme.success, theme),
              const SizedBox(height: 12),
              _buildStatusItem('检测漏洞', '已完成', theme.success, theme),
              const SizedBox(height: 12),
              _buildStatusItem('性能评估', '进行中', theme.warning, theme),
              const SizedBox(height: 12),
              _buildStatusItem('生成报告', '待开始', theme.textTertiary, theme),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStatusItem(String label, String status, Color color, AppTheme theme) {
    final isCompleted = status == '已完成';
    return Row(
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: isCompleted ? color : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isCompleted ? color : theme.textTertiary,
              width: 2,
            ),
          ),
          child: isCompleted
              ? const Icon(Icons.check, color: Colors.white, size: 16)
              : null,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: theme.textPrimary,
              fontSize: 14,
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            status,
            style: TextStyle(
              color: color,
              fontSize: 11,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildInfoSection(AppTheme theme) {
    final infoLabel = _sduiLayout?['infoLabel'] as String? ?? '基本信息';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(infoLabel, style: TextStyle(
            color: theme.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(
              color: theme.textTertiary.withValues(alpha: 0.1),
              width: 1,
            ),
          ),
          child: Column(
            children: [
              _buildInfoRow('执行者', 'AI Agent', theme),
              const SizedBox(height: 10),
              _buildInfoRow('优先级', '高', theme),
              const SizedBox(height: 10),
              _buildInfoRow('预计耗时', '15 分钟', theme),
              const SizedBox(height: 10),
              _buildInfoRow('截止日期', '2024-01-20', theme),
            ],
          ),
        ),
      ],
    );
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '初步结果',
          style: TextStyle(
            color: theme.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(
              color: theme.textTertiary.withValues(alpha: 0.1),
              width: 1,
            ),
          ),
          child: Column(
            children: [
              _buildResultStat('发现问题', '3', theme.error, theme),
              const SizedBox(height: 12),
              _buildResultStat('警告', '7', theme.warning, theme),
              const SizedBox(height: 12),
              _buildResultStat('建议优化', '12', theme.info, theme),
              const SizedBox(height: 12),
              _buildResultStat('代码质量评分', '85', theme.success, theme),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildResultStat(String label, String value, Color color, AppTheme theme) {
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(4),
            boxShadow: theme.useGlow ? [
              BoxShadow(
                color: color.withValues(alpha: 0.5),
                blurRadius: 8,
                spreadRadius: 1,
              ),
            ] : null,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: theme.textSecondary,
              fontSize: 13,
            ),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }

  Widget _buildActions(AppTheme theme) {
    return Row(
      children: [
        Expanded(
          child: GestureDetector(
            onTap: () {},
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                color: theme.surface.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(theme.radiusMedium),
                border: Border.all(
                  color: theme.textTertiary.withValues(alpha: 0.2),
                  width: 1,
                ),
              ),
              child: Center(
                child: Text(
                  '暂停任务',
                  style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: GestureDetector(
            onTap: () {},
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 14),
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(theme.radiusMedium),
                boxShadow: theme.useGlow ? [
                  BoxShadow(
                    color: theme.primary.withValues(alpha: 0.4),
                    blurRadius: 15,
                    spreadRadius: 2,
                  ),
                ] : null,
              ),
              child: const Center(
                child: Text(
                  '查看报告',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
