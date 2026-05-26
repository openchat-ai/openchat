import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../providers/theme_provider.dart';
import '../../providers/feed_provider.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> with SduiPageState {
  @override
  String get sduiPage => 'home';

  IconData _iconForType(String type) {
    switch (type) {
      case 'born': return Icons.celebration_outlined;
      case 'awake': return Icons.wb_sunny_outlined;
      case 'sleeping': return Icons.nights_stay_outlined;
      case 'task_assigned': return Icons.assignment_outlined;
      case 'task_done': return Icons.task_alt_rounded;
      case 'task_failed': return Icons.error_outline_rounded;
      case 'collab_started': return Icons.connect_without_contact_rounded;
      case 'collab_done': return Icons.handshake_outlined;
      case 'sage_ask': return Icons.help_outline;
      case 'sage_answer': return Icons.reply_rounded;
      case 'sage_guide': return Icons.auto_awesome_outlined;
      case 'sage_praise': return Icons.favorite_outline;
      default: return Icons.circle_outlined;
    }
  }

  Color _colorForType(String type, AppTheme theme) {
    switch (type) {
      case 'born': return theme.gradientPrimary[0];
      case 'awake': return Colors.orangeAccent;
      case 'sleeping': return Colors.indigoAccent;
      case 'task_assigned': return theme.primary;
      case 'task_done': return theme.success;
      case 'task_failed': return theme.error;
      case 'collab_started': return Colors.teal;
      case 'collab_done': return Colors.deepOrangeAccent;
      case 'sage_ask': return Colors.amber;
      case 'sage_answer': return Colors.green;
      case 'sage_guide': return Colors.purpleAccent;
      case 'sage_praise': return Colors.pinkAccent;
      default: return theme.textTertiary;
    }
  }

  String _timeAgo(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inSeconds < 60) return '刚刚';
    if (diff.inMinutes < 60) return '${diff.inMinutes} 分钟前';
    if (diff.inHours < 24) return '${diff.inHours} 小时前';
    return '${diff.inDays} 天前';
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final feedAsync = ref.watch(feedProvider);
    final title = sduiLayout['title'] as String? ?? '社区动态';

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 24,
          fontWeight: FontWeight.bold, letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 1)),
        actions: [
          _buildIconButton(Icons.refresh_rounded, theme, () => ref.read(feedProvider.notifier).refresh()),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: feedAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => _buildEmptyState(theme, sduiLayout['errorState'] as Map? ?? {'icon': 'people', 'title': 'OpenChat', 'subtitle': '切换到 好友 标签'}),
            data: (feed) {
              if (feed.isEmpty) {
                return _buildEmptyState(theme, sduiLayout['emptyState'] as Map?);
              }
              final feedItems = feed.map((item) => {
                'name': item.residentName,
                'role': item.agentRole ?? '',
                'message': item.message,
                'summary': item.summary ?? '',
                'timeAgo': _timeAgo(item.timestamp),
                'typeIcon': sduiLayout['icons'] is Map ? (sduiLayout['icons'] as Map)[item.type] as String? ?? 'circle' : 'circle',
                'typeColor': item.type == 'born' ? '#7C4DFF' :
                  item.type == 'awake' ? '#FF9800' :
                  item.type == 'task_done' ? '#4CAF50' :
                  item.type == 'task_failed' ? '#F44336' : '#7C4DFF',
                'showRole': item.agentRole != null && item.agentRole != 'custom',
              }).toList();
              final layout = sduiLayout['feedLayout'] as Map?;
              if (layout != null) {
                final parser = SduiParser(onAction: null, vars: {'items': feedItems});
                final widget = parser.parse(layout);
                if (widget != null) {
                  return SingleChildScrollView(padding: const EdgeInsets.all(16), child: widget);
                }
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: feed.length,
                itemBuilder: (context, index) => _buildFeedItem(context, theme, feed[index]),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(AppTheme theme, Map? state) {
    if (state == null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.inbox_outlined, color: theme.textTertiary, size: 64),
        const SizedBox(height: 16),
        Text('社区还很安静', style: TextStyle(color: theme.textSecondary, fontSize: 16)),
      ]));
    }
    final parser = SduiParser(vars: {}, onAction: null);
    final node = {
      'type': 'column', 'center': true, 'children': [
        {'type': 'padding', 'padding': 32, 'child': {'type': 'icon', 'icon': state['icon'] ?? 'inbox', 'size': 64}},
        if (state['title'] != null) {'type': 'text', 'content': state['title'], 'style': {'size': 16}, 'pad': 8},
        if (state['subtitle'] != null) {'type': 'text', 'content': state['subtitle'], 'style': {'size': 13, 'color': '#9E9E9E'}},
      ],
    };
    return Center(child: parser.parse(node));
  }

  Widget _buildIconButton(IconData icon, AppTheme theme, VoidCallback onTap) {
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

  Widget _buildFeedItem(BuildContext context, AppTheme theme, FeedItem item) {
    final color = _colorForType(item.type, theme);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusLarge),
          border: Border.all(color: theme.textTertiary.withValues(alpha: 0.06))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 40, height: 40,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
            child: Icon(_iconForType(item.type), color: color, size: 20)),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(item.residentName, style: TextStyle(color: theme.textPrimary, fontWeight: FontWeight.w600, fontSize: 14)),
              if (item.agentRole != null && item.agentRole != 'custom') ...[
                const SizedBox(width: 6),
                Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(4)),
                  child: Text(item.agentRole!, style: TextStyle(color: color, fontSize: 10))),
              ],
            ]),
            const SizedBox(height: 4),
            Text(item.message, style: TextStyle(color: theme.textSecondary, fontSize: 13),
              maxLines: 2, overflow: TextOverflow.ellipsis),
            if (item.summary != null && item.summary!.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(item.summary!.replaceAll('\n', ' '), style: TextStyle(color: theme.textTertiary, fontSize: 11),
                maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 4),
            Text(_timeAgo(item.timestamp), style: TextStyle(color: theme.textTertiary, fontSize: 11)),
          ])),
        ]),
      ),
    );
  }
}
