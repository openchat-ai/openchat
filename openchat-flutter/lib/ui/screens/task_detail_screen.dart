import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../../core/sdui_config.dart';
import 'task_detail_header.dart';
import 'task_detail_status.dart';
import 'task_detail_info.dart';
import 'task_detail_results.dart';
import 'task_detail_actions.dart';

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
    final title = sduiStr('title', 'Task Detail');

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
                TaskDetailHeader(agentId: widget.agentId, theme: theme),
                const SizedBox(height: 24),
                TaskStatusSection(layout: sduiLayout, theme: theme),
                const SizedBox(height: 24),
                TaskInfoSection(layout: sduiLayout, theme: theme),
                const SizedBox(height: 24),
                TaskResultSection(layout: sduiLayout, theme: theme),
                const SizedBox(height: 24),
                TaskActionRow(layout: sduiLayout, theme: theme),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
