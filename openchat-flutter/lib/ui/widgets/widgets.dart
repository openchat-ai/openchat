import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/models/agent_model.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api/base_client.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui_config.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../screens/screens.dart';

// ===== code_item.dart =====
class CodeItem {
  final String name;
  final String type;
  final int line;
  CodeItem(this.name, this.type, this.line);
}

// ===== code_block.dart =====
class CodeBlock extends StatelessWidget {
  final List<Map<String, dynamic>> lines;
  final Map<String, List<CodeItem>> codeItems;
  final Function(String name, String type, int line) onItemTap;

  const CodeBlock({
    super.key,
    required this.lines,
    required this.codeItems,
    required this.onItemTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF1E1E2E),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: lines.length,
        itemBuilder: (context, i) {
          final line = lines[i];
          final lineNum = i + 1;
          final allItems = codeItems['all'] ?? [];
          final lineItems = allItems.where((item) => item.line == lineNum).toList();
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 40,
                child: Text('$lineNum', style: const TextStyle(color: Colors.grey, fontSize: 13, fontFamily: 'monospace')),
              ),
              Expanded(
                child: _buildLineWithLinks(line['text'] as String, line['color'] as Color, lineItems),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildLineWithLinks(String text, Color baseColor, List<CodeItem> items) {
    if (items.isEmpty) {
      return Text(text, style: TextStyle(color: baseColor, fontSize: 13, fontFamily: 'monospace', height: 1.6));
    }
    final spans = <TextSpan>[];
    int lastEnd = 0;
    for (final item in items) {
      final idx = text.indexOf(item.name, lastEnd);
      if (idx >= 0 && idx >= lastEnd) {
        if (idx > lastEnd) {
          spans.add(TextSpan(text: text.substring(lastEnd, idx), style: TextStyle(color: baseColor)));
        }
        spans.add(TextSpan(
          text: item.name,
          style: TextStyle(
            color: _getTypeColor(item.type),
            decoration: TextDecoration.underline,
            decorationColor: _getTypeColor(item.type).withValues(alpha: 0.5),
          ),
        ));
        lastEnd = idx + item.name.length;
      }
    }
    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd), style: TextStyle(color: baseColor)));
    }
    return RichText(
      text: TextSpan(
        style: TextStyle(fontSize: 13, fontFamily: 'monospace', height: 1.6),
        children: spans,
      ),
    );
  }

  Color _getTypeColor(String type) {
    switch (type) {
      case 'class': return Colors.purple;
      case 'function': return Colors.green;
      case 'method': return Colors.cyan;
      case 'variable': return Colors.orange;
      case 'import': return Colors.cyan;
      default: return Colors.white;
    }
  }
}

// ===== code_navigator_bar.dart =====
class CodeNavigatorBar extends StatelessWidget {
  final String currentPath;
  final List<String> pathParts;
  final Function(String) onPathTap;

  const CodeNavigatorBar({
    super.key,
    required this.currentPath,
    required this.pathParts,
    required this.onPathTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      color: const Color(0xFF2D2D3F),
      child: Row(
        children: [
          const Icon(Icons.folder, color: Colors.amber, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (int i = 0; i < pathParts.length; i++) ...[
                    GestureDetector(
                      onTap: () => onPathTap(pathParts.sublist(0, i + 1).join('/')),
                      child: Text(
                        pathParts[i],
                        style: TextStyle(
                          color: i == pathParts.length - 1 ? Colors.white : Colors.cyan,
                          fontFamily: 'monospace',
                          fontSize: 13,
                        ),
                      ),
                    ),
                    if (i < pathParts.length - 1)
                      const Text(' / ', style: TextStyle(color: Colors.grey, fontFamily: 'monospace')),
                  ],
                ],
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.arrow_drop_down, color: Colors.white70, size: 20),
            onPressed: () {},
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }
}

// ===== outline_panel.dart =====
class OutlinePanel extends StatelessWidget {
  final List<CodeItem> items;
  final Function(String name, String type, int line) onItemTap;

  const OutlinePanel({
    super.key,
    required this.items,
    required this.onItemTap,
  });

  @override
  Widget build(BuildContext context) {
    final grouped = <String, List<CodeItem>>{};
    for (final item in items) {
      grouped.putIfAbsent(item.type, () => []).add(item);
    }
    return Container(
      width: 200,
      color: const Color(0xFF252536),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            color: const Color(0xFF2D2D3F),
            child: const Row(
              children: [
                Icon(Icons.account_tree, color: Colors.green, size: 16),
                SizedBox(width: 8),
                Text('大纲', style: TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              children: grouped.entries.expand((entry) => [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                  child: Text(
                    _getTypeName(entry.key),
                    style: TextStyle(color: _getTypeColor(entry.key), fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                ),
                ...entry.value.map((item) => ListTile(
                  dense: true,
                  leading: Icon(_getTypeIcon(item.type), color: _getTypeColor(item.type), size: 16),
                  title: Text(item.name, style: const TextStyle(color: Colors.white70, fontSize: 12, fontFamily: 'monospace')),
                  trailing: Text('${item.line}', style: const TextStyle(color: Colors.grey, fontSize: 10)),
                  onTap: () => onItemTap(item.name, item.type, item.line),
                )),
              ]).toList(),
            ),
          ),
        ],
      ),
    );
  }

  String _getTypeName(String type) {
    switch (type) {
      case 'class': return '类 (Classes)';
      case 'function': return '函数 (Functions)';
      case 'method': return '方法 (Methods)';
      case 'variable': return '变量 (Variables)';
      case 'import': return '导入 (Imports)';
      default: return type;
    }
  }

  Color _getTypeColor(String type) {
    switch (type) {
      case 'class': return Colors.purple;
      case 'function': return Colors.green;
      case 'method': return Colors.cyan;
      case 'variable': return Colors.orange;
      case 'import': return Colors.cyan;
      default: return Colors.grey;
    }
  }

  IconData _getTypeIcon(String type) {
    switch (type) {
      case 'class': return Icons.class_;
      case 'function': return Icons.functions;
      case 'method': return Icons.build;
      case 'variable': return Icons.data_object;
      case 'import': return Icons.download;
      default: return Icons.code;
    }
  }
}

// ===== app_card.dart =====
enum CardVariant {
  filled,
  outlined,
  elevated,
  gradient,
  glass,
}

class AppCard extends ConsumerWidget {
  final Widget child;
  final CardVariant variant;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;
  final List<Color>? gradientColors;
  final bool isSelected;

  const AppCard({
    super.key,
    required this.child,
    this.variant = CardVariant.filled,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.width,
    this.height,
    this.borderRadius,
    this.gradientColors,
    this.isSelected = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    Widget card = Container(
      width: width,
      height: height,
      padding: padding,
      decoration: _buildDecoration(theme),
      child: child,
    );
    if (onTap != null) {
      card = GestureDetector(
        onTap: onTap,
        child: AnimatedScale(
          scale: 1.0,
          duration: const Duration(milliseconds: 150),
          child: card,
        ),
      );
    }
    return card;
  }

  BoxDecoration _buildDecoration(AppTheme theme) {
    final radius = borderRadius ?? BorderRadius.circular(theme.radiusMedium);
    switch (variant) {
      case CardVariant.filled:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: radius,
          border: Border.all(
            color: isSelected
              ? theme.primary.withValues(alpha: 0.5)
              : theme.textTertiary.withValues(alpha: 0.1),
            width: isSelected ? 2 : 1,
          ),
        );
      case CardVariant.outlined:
        return BoxDecoration(
          color: Colors.transparent,
          borderRadius: radius,
          border: Border.all(
            color: isSelected
              ? theme.primary
              : theme.textTertiary.withValues(alpha: 0.2),
            width: isSelected ? 2 : 1,
          ),
        );
      case CardVariant.elevated:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.8),
          borderRadius: radius,
          boxShadow: theme.shadows,
        );
      case CardVariant.gradient:
        return BoxDecoration(
          gradient: LinearGradient(
            colors: gradientColors ?? theme.gradientPrimary,
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: radius,
          boxShadow: theme.useGlow ? [
            BoxShadow(
              color: (gradientColors ?? theme.gradientPrimary)[0].withValues(alpha: 0.4),
              blurRadius: 20,
              spreadRadius: 2,
            ),
          ] : null,
        );
      case CardVariant.glass:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.3),
          borderRadius: radius,
          border: Border.all(color: Colors.white.withValues(alpha: 0.1), width: 1),
        );
    }
  }
}

// ===== action_card.dart =====
class ActionCard extends ConsumerWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Color? color;

  const ActionCard({
    super.key,
    required this.icon,
    required this.label,
    this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final actionColor = color ?? theme.gradientPrimary[0];
    return AppCard(
      variant: CardVariant.filled,
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  actionColor.withValues(alpha: 0.2),
                  actionColor.withValues(alpha: 0.05),
                ],
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: actionColor, size: 28),
          ),
          const SizedBox(height: 10),
          Text(label, style: TextStyle(color: theme.textSecondary, fontSize: 12)),
        ],
      ),
    );
  }
}

// ===== image_card.dart =====
class ImageCard extends ConsumerWidget {
  final String? imageUrl;
  final String title;
  final String? subtitle;
  final double aspectRatio;
  final VoidCallback? onTap;

  const ImageCard({
    super.key,
    this.imageUrl,
    required this.title,
    this.subtitle,
    this.aspectRatio = 16 / 9,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    return AppCard(
      variant: CardVariant.filled,
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: aspectRatio,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    theme.gradientPrimary[0].withValues(alpha: 0.3),
                    theme.gradientPrimary[1].withValues(alpha: 0.1),
                  ],
                ),
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(theme.radiusMedium),
                ),
              ),
              child: imageUrl != null
                ? ClipRRect(
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(theme.radiusMedium),
                    ),
                    child: Image.network(imageUrl!, fit: BoxFit.cover),
                  )
                : Center(
                    child: Icon(Icons.image, color: theme.textTertiary, size: 40),
                  ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    style: TextStyle(color: theme.textSecondary, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ===== list_card.dart =====
class ListCard extends ConsumerWidget {
  final Widget? leading;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showDivider;
  final Color? leadingColor;

  const ListCard({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.showDivider = false,
    this.leadingColor,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    return Column(
      children: [
        AppCard(
          variant: CardVariant.filled,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          onTap: onTap,
          child: Row(
            children: [
              if (leading != null) ...[
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        (leadingColor ?? theme.gradientPrimary[0]).withValues(alpha: 0.2),
                        (leadingColor ?? theme.gradientPrimary[0]).withValues(alpha: 0.05),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(child: leading),
                ),
                const SizedBox(width: 14),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        subtitle!,
                        style: TextStyle(color: theme.textSecondary, fontSize: 13),
                      ),
                    ],
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
        ),
        if (showDivider)
          Divider(
            indent: 72,
            endIndent: 16,
            color: theme.textTertiary.withValues(alpha: 0.1),
            height: 1,
          ),
      ],
    );
  }
}

// ===== stat_card.dart =====
class StatCard extends ConsumerWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? color;
  final VoidCallback? onTap;

  const StatCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final cardColor = color ?? theme.gradientPrimary[0];
    return AppCard(
      variant: CardVariant.filled,
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  cardColor.withValues(alpha: 0.2),
                  cardColor.withValues(alpha: 0.05),
                ],
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: cardColor, size: 20),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              color: theme.textPrimary,
              fontSize: 28,
              fontWeight: FontWeight.bold,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 4),
          Text(label, style: TextStyle(color: theme.textSecondary, fontSize: 12)),
        ],
      ),
    );
  }
}

// ===== audio_level_indicator.dart =====
class AudioLevelIndicator extends StatelessWidget {
  final double level;
  final double size;

  const AudioLevelIndicator({
    super.key,
    required this.level,
    this.size = 80,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: 1,
              strokeWidth: 4,
              valueColor: AlwaysStoppedAnimation(Colors.grey.shade300),
            ),
          ),
          SizedBox(
            width: size,
            height: size,
            child: CircularProgressIndicator(
              value: level.clamp(0, 1),
              strokeWidth: 4,
              valueColor: AlwaysStoppedAnimation(_getColor(level)),
              backgroundColor: Colors.transparent,
            ),
          ),
          Icon(
            level > 0.1 ? Icons.mic : Icons.mic_off,
            color: _getColor(level),
            size: size * 0.4,
          ),
        ],
      ),
    );
  }

  Color _getColor(double level) {
    if (level > 0.7) return Colors.red;
    if (level > 0.4) return Colors.orange;
    return Colors.green;
  }
}

// ===== audio_level_visualizer.dart =====
class AudioLevelVisualizer extends StatefulWidget {
  final Stream<double> audioLevelStream;
  final Color color;
  final double height;

  const AudioLevelVisualizer({
    super.key,
    required this.audioLevelStream,
    this.color = Colors.green,
    this.height = 60,
  });

  @override
  State<AudioLevelVisualizer> createState() => _AudioLevelVisualizerState();
}

class _AudioLevelVisualizerState extends State<AudioLevelVisualizer> {
  final List<double> _levels = List.filled(20, 0);
  StreamSubscription<double>? _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = widget.audioLevelStream.listen((level) {
      if (mounted) {
        setState(() {
          _levels.removeAt(0);
          _levels.add(level.clamp(0, 1));
        });
      }
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(_levels.length, (index) {
          return AnimatedContainer(
            duration: const Duration(milliseconds: 80),
            margin: const EdgeInsets.symmetric(horizontal: 2),
            width: 6,
            height: 8 + (_levels[index] * (widget.height - 16)).clamp(0, widget.height - 16),
            decoration: BoxDecoration(
              color: _getBarColor(_levels[index]),
              borderRadius: BorderRadius.circular(3),
            ),
          );
        }),
      ),
    );
  }

  Color _getBarColor(double level) {
    if (level > 0.7) return Colors.red;
    if (level > 0.4) return Colors.orange;
    return widget.color;
  }
}

// ===== speaking_indicator.dart =====
class SpeakingIndicator extends StatefulWidget {
  final bool isSpeaking;
  final double size;

  const SpeakingIndicator({
    super.key,
    required this.isSpeaking,
    this.size = 24,
  });

  @override
  State<SpeakingIndicator> createState() => _SpeakingIndicatorState();
}

class _SpeakingIndicatorState extends State<SpeakingIndicator>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    if (widget.isSpeaking) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(SpeakingIndicator oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isSpeaking && !oldWidget.isSpeaking) {
      _controller.repeat(reverse: true);
    } else if (!widget.isSpeaking && oldWidget.isSpeaking) {
      _controller.stop();
      _controller.reset();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isSpeaking) {
      return SizedBox(width: widget.size, height: widget.size);
    }
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Container(
          width: widget.size * (1 + _controller.value * 0.3),
          height: widget.size * (1 + _controller.value * 0.3),
          decoration: BoxDecoration(
            color: Colors.green.withValues(alpha: 0.3 * (1 - _controller.value)),
            shape: BoxShape.circle,
          ),
          child: Icon(
            Icons.volume_up,
            color: Colors.green,
            size: widget.size * 0.7,
          ),
        );
      },
    );
  }
}

// ===== agent_task_card.dart =====
class AgentTaskCard extends ConsumerWidget {
  final Agent agent;

  const AgentTaskCard({super.key, required this.agent});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusColor = _getStatusColor(agent.status);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        title: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              agent.name,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            _buildStatusBadge(agent.status, statusColor),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Text(
              "Role: ${agent.role}",
              style: TextStyle(color: Colors.grey[600], fontSize: 13),
            ),
            if (agent.task != null) ...[
              const SizedBox(height: 4),
              Text(
                agent.task!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14),
              ),
            ],
          ],
        ),
        trailing: IconButton(
          icon: const Icon(Icons.chevron_right),
          onPressed: () => _navigateToDetail(context, agent.id),
        ),
      ),
    );
  }

  Widget _buildStatusBadge(AgentStatus status, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color, width: 1),
      ),
      child: Text(
        status.name.toUpperCase(),
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }

  Color _getStatusColor(AgentStatus status) {
    switch (status) {
      case AgentStatus.initializing: return Colors.blue;
      case AgentStatus.running: return Colors.orange;
      case AgentStatus.completed: return Colors.green;
      case AgentStatus.failed: return Colors.red;
      case AgentStatus.terminated: return Colors.grey;
    }
  }

  void _navigateToDetail(BuildContext context, String agentId) {
    Navigator.pushNamed(context, '/agent-detail', arguments: agentId);
  }
}

// ===== bridge_url_tile.dart =====
class BridgeUrlTile extends ConsumerStatefulWidget {
  final AppTheme theme;
  const BridgeUrlTile({super.key, required this.theme});

  @override
  ConsumerState<BridgeUrlTile> createState() => _BridgeUrlTileState();
}

class _BridgeUrlTileState extends ConsumerState<BridgeUrlTile> {
  late TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(configProvider).baseUrl);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(configProvider);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Bridge 地址', style: TextStyle(color: widget.theme.textSecondary, fontSize: 13)),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: TextField(
            controller: _controller,
            style: TextStyle(color: widget.theme.textPrimary),
            decoration: InputDecoration(
              hintText: 'http://192.168.1.100:3800',
              hintStyle: TextStyle(color: widget.theme.textTertiary),
              filled: true, fillColor: widget.theme.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: widget.theme.textTertiary.withValues(alpha: 0.2))),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
          )),
          const SizedBox(width: 8),
          TextButton(onPressed: () {
            ref.read(configProvider.notifier).setBaseUrl(_controller.text);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Address updated'), duration: Duration(seconds: 2)));
          }, child: const Text('Save')),
        ]),
        const SizedBox(height: 4),
        Text('Current: ${config.baseUrl}', style: TextStyle(color: widget.theme.textTertiary, fontSize: 11)),
      ]),
    );
  }
}

// ===== connection_banner.dart =====
class ConnectionBanner extends ConsumerWidget {
  const ConnectionBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final info = ref.watch(bridgeConnectionProvider);
    final theme = ref.watch(currentThemeProvider);

    return info.when(
      data: (data) {
        final state = data.state;
        if (state == WsConnectionState.connected) {
          return const SizedBox.shrink();
        }
        if (state == WsConnectionState.connecting) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: Colors.blue.shade700,
            child: const Row(
              children: [
                SizedBox(
                  width: 14, height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                ),
                SizedBox(width: 8),
                Text('正在连接...', style: TextStyle(color: Colors.white, fontSize: 13)),
              ],
            ),
          );
        }
        if (state == WsConnectionState.reconnecting) {
          final retryIn = data.nextRetrySeconds;
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: Colors.orange.shade800,
            child: Row(
              children: [
                const Icon(Icons.sync, color: Colors.white, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    retryIn != null ? '重连中 ($retryIn秒后重试)' : '重连中...',
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                  ),
                ),
              ],
            ),
          );
        }
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: theme.error.withValues(alpha: 0.9),
          child: Row(
            children: [
              const Icon(Icons.cloud_off, color: Colors.white, size: 16),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Bridge 未连接',
                  style: TextStyle(color: Colors.white, fontSize: 13),
                ),
              ),
              TextButton(
                onPressed: () {
                  ref.read(bridgeWsProvider).connect();
                },
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  foregroundColor: Colors.white,
                ),
                child: const Text('重试', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        );
      },
      loading: () => const SizedBox.shrink(),
      error: (_, __) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        color: Colors.orange.shade800,
        child: const Row(
          children: [
            Icon(Icons.error_outline, color: Colors.white, size: 16),
            SizedBox(width: 8),
            Text('连接异常', style: TextStyle(color: Colors.white, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}

// ===== expandable_list_item.dart =====
class ExpandableListItem extends ConsumerStatefulWidget {
  final Widget header;
  final Widget content;
  final bool initiallyExpanded;

  const ExpandableListItem({
    super.key,
    required this.header,
    required this.content,
    this.initiallyExpanded = false,
  });

  @override
  ConsumerState<ExpandableListItem> createState() => _ExpandableListItemState();
}

class _ExpandableListItemState extends ConsumerState<ExpandableListItem>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  bool _isExpanded = false;

  @override
  void initState() {
    super.initState();
    _isExpanded = widget.initiallyExpanded;
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    _animation = CurvedAnimation(parent: _controller, curve: Curves.easeInOut);
    if (_isExpanded) _controller.value = 1.0;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() {
      _isExpanded = !_isExpanded;
      if (_isExpanded) {
        _controller.forward();
      } else {
        _controller.reverse();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1),
      ),
      child: Column(
        children: [
          GestureDetector(
            onTap: _toggle,
            child: Container(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(child: widget.header),
                  AnimatedRotation(
                    turns: _isExpanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 300),
                    child: Icon(Icons.expand_more, color: theme.textTertiary),
                  ),
                ],
              ),
            ),
          ),
          SizeTransition(
            sizeFactor: _animation,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: widget.content,
            ),
          ),
        ],
      ),
    );
  }
}

// ===== grouped_list.dart =====
class GroupedList<T> extends ConsumerWidget {
  final List<T> items;
  final String Function(T) groupBy;
  final Widget Function(T) itemBuilder;
  final Widget Function(String)? groupHeaderBuilder;
  final EdgeInsets padding;

  const GroupedList({
    super.key,
    required this.items,
    required this.groupBy,
    required this.itemBuilder,
    this.groupHeaderBuilder,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final groups = <String, List<T>>{};
    for (final item in items) {
      final key = groupBy(item);
      groups.putIfAbsent(key, () => []).add(item);
    }
    return ListView.builder(
      padding: padding,
      itemCount: groups.length,
      itemBuilder: (context, index) {
        final groupKey = groups.keys.elementAt(index);
        final groupItems = groups[groupKey]!;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            groupHeaderBuilder?.call(groupKey) ??
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
              child: Text(
                groupKey.toUpperCase(),
                style: TextStyle(
                  color: theme.textTertiary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 2,
                ),
              ),
            ),
            ...groupItems.map((item) => itemBuilder(item)),
          ],
        );
      },
    );
  }
}

// ===== load_more_list.dart =====
class LoadMoreList extends ConsumerStatefulWidget {
  final List<Widget> items;
  final Future<void> Function() onLoadMore;
  final bool hasMore;
  final EdgeInsets padding;

  const LoadMoreList({
    super.key,
    required this.items,
    required this.onLoadMore,
    required this.hasMore,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  ConsumerState<LoadMoreList> createState() => _LoadMoreListState();
}

class _LoadMoreListState extends ConsumerState<LoadMoreList> {
  final ScrollController _controller = ScrollController();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onScroll);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_controller.position.pixels >=
        _controller.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    if (_isLoading || !widget.hasMore) return;
    setState(() => _isLoading = true);
    await widget.onLoadMore();
    setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    return ListView(
      controller: _controller,
      padding: widget.padding,
      children: [
        ...widget.items,
        if (_isLoading)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator(color: theme.primary)),
          ),
        if (!widget.hasMore && widget.items.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: Text('已经到底了',
                style: TextStyle(color: theme.textTertiary, fontSize: 12)),
            ),
          ),
      ],
    );
  }
}

// ===== people_dialogs.dart =====
class PeopleDialogs {
  static Future<void> showSdui(
    BuildContext context,
    Map layout,
    Map<String, dynamic> vars, {
    List<Map<String, String>>? actions,
    void Function(String)? onAction,
  }) {
    final parser = SduiParser(vars: vars, onAction: onAction);
    return showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        content: SizedBox(width: double.maxFinite, child: parser.parse(layout)),
        actions: actions?.map((a) => TextButton(
          onPressed: () => onAction?.call(a['action'] ?? ''),
          child: Text(a['label'] ?? '', style: a['color'] != null ? TextStyle(color: Color(int.parse(a['color']!.replaceAll('#', '0xFF')))) : null),
        )).toList() ?? [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  static Future<void> showRoomDialog(BuildContext context) async {
    final controller = TextEditingController(text: 'room_${DateTime.now().millisecondsSinceEpoch}');
    await showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('加入语音房间'),
      content: TextField(
        controller: controller,
        decoration: const InputDecoration(labelText: '房间 ID', hintText: '输入房间 ID 或使用默认'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
        TextButton(onPressed: () {
          Navigator.pop(ctx);
          Navigator.pushNamed(context, '/room', arguments: controller.text.trim());
        }, child: const Text('加入', style: TextStyle(color: Color(0xFF7C4DFF)))),
      ],
    ));
  }

  static Future<void> showAudioFiles(BuildContext context, QiniuDirectClient client, Map? uiConfig) async {
    final keys = await client.listFiles('oc/audio/');
    final items = keys.map((k) => <String, dynamic>{'key': k, 'size': 0}).toList();
    if (!context.mounted) return;
    final layout = uiConfig?['audioFilesLayout'];
    final parser = SduiParser(vars: {
      'files': items.map((f) => {
        'name': (f['key'] as String? ?? '').split('/').last,
        'size': () {
          final s = f['size'] as int? ?? 0;
          return s >= 1024 ? '${(s / 1024).toStringAsFixed(1)}KB' : '${s}B';
        }(),
      }).toList(),
    }, onAction: null);
    final body = layout is Map
      ? parser.parse(layout)
      : parser.parse({
          'type': 'column', 'children': [
            {'type': 'for_each', 'items': '{{files}}', 'template': {
              'type': 'column', 'children': [
                {'type': 'divider'},
                {'type': 'row', 'children': [
                  {'type': 'text', 'content': '{{item.name}}', 'pad': 8},
                  {'type': 'spacer'},
                  {'type': 'text', 'content': '{{item.size}}', 'style': {'color': '#9E9E9E', 'size': 12}, 'pad': 8},
                ]},
              ],
            }},
          ],
        });
    if (!context.mounted) return;
    showDialog(context: context, builder: (ctx) => AlertDialog(
      content: SizedBox(width: double.maxFinite, child: body),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }

  static void showDeviceInfo(BuildContext context, QiniuDirectClient client) {
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Device Info'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Peer ID: ${client.peerId}'),
        const SizedBox(height: 8),
        Text('Poll: ${client.pollIntervalMs}ms'),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }
}

// ===== people_error_view.dart =====
class PeopleErrorView extends StatelessWidget {
  final String? error;
  final AppTheme theme;
  final VoidCallback onRetry;

  const PeopleErrorView({
    super.key,
    required this.error,
    required this.theme,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final err = error ?? '';
    String type, hint;
    if (err.contains('Timeout') || err.contains('timed out')) {
      type = 'Network timeout';
      hint = 'Check your internet connection\nQiniu may be blocked by your ISP';
    } else if (err.contains('401') || err.contains('bad token') || err.contains('BadToken')) {
      type = 'Auth failed';
      hint = 'Upload token invalid\nRebuild APK to refresh token';
    } else if (err.contains('403') || err.contains('Signature')) {
      type = 'Signature mismatch';
      hint = 'S3 signing algorithm mismatch\nContact developer';
    } else if (err.contains('SocketException') || err.contains('Connection refused')) {
      type = 'Connection failed';
      hint = 'Cannot reach Qiniu server\nCheck firewall or try different network';
    } else if (err.contains('DNS')) {
      type = 'DNS resolution failed';
      hint = 'Cannot resolve qiniu.com\nCheck DNS settings';
    } else if (err.contains('InvalidAccessKeyId')) {
      type = 'Access key invalid';
      hint = 'Qiniu access key rejected\n$err';
    } else {
      type = 'Unknown error';
      hint = err;
    }
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, color: theme.warning, size: 48),
            const SizedBox(height: 16),
            Text(type, style: TextStyle(color: theme.error, fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text(hint, style: TextStyle(color: theme.textSecondary, fontSize: 13), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.surface.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(err, style: TextStyle(color: theme.textTertiary, fontSize: 10), textAlign: TextAlign.center),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

// ===== people_fallback_view.dart =====
class PeopleFallbackView extends StatelessWidget {
  final bool loading;
  final String? error;
  final List<Map<String, dynamic>> users;
  final QiniuDirectClient? client;
  final AppTheme theme;
  final Future<void> Function() onRefresh;
  final VoidCallback onSpawnDemo;
  final void Function(String peerId) onCall;

  const PeopleFallbackView({
    super.key,
    required this.loading,
    required this.error,
    required this.users,
    required this.client,
    required this.theme,
    required this.onRefresh,
    required this.onSpawnDemo,
    required this.onCall,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('People', style: TextStyle(color: theme.textPrimary)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: onRefresh, color: theme.textSecondary)],
      ),
      body: loading
          ? Center(child: CircularProgressIndicator(color: theme.accent))
          : error != null
              ? PeopleErrorView(error: error, theme: theme, onRetry: onRefresh)
              : users.isEmpty
                  ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.person_outline, color: theme.textTertiary, size: 48),
                      const SizedBox(height: 16),
                      Text('No one online', style: TextStyle(color: theme.textSecondary)),
                      const SizedBox(height: 8),
                      Text('Tap Demo to test with a simulated user',
                          style: TextStyle(color: theme.textTertiary, fontSize: 12)),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: client == null ? null : onSpawnDemo,
                        icon: const Icon(Icons.smart_toy_outlined, size: 16),
                        label: const Text('Demo'),
                      ),
                    ]))
                  : RefreshIndicator(
                      onRefresh: onRefresh,
                      child: ListView.builder(
                        itemCount: users.length,
                        itemBuilder: (ctx, i) {
                          final user = users[i];
                          final peerId = user['peerId'] as String? ?? 'unknown';
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: theme.accent.withValues(alpha: 0.2),
                              child: Icon(Icons.person, color: theme.accent),
                            ),
                            title: Text(peerId, style: TextStyle(color: theme.textPrimary)),
                            subtitle: Text('Online', style: TextStyle(color: theme.success, fontSize: 12)),
                            trailing: IconButton(
                              icon: Icon(Icons.call, color: theme.gradientAccent[0]),
                              onPressed: () => onCall(peerId),
                            ),
                            onTap: () => onCall(peerId),
                          );
                        },
                      ),
                    ),
    );
  }
}

// ===== people_file_actions.dart =====
class PeopleFileActions {
  static void handle(BuildContext context, String action, QiniuDirectClient client) {
    final qIdx = action.indexOf('?');
    final params = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1)) : <String, String>{};
    if (action.startsWith('file:list?')) {
      client.listFiles(params['prefix'] ?? '').then((files) {
        if (!context.mounted) return;
        PeopleDialogs.showSdui(context,
          {'type': 'column', 'children': [
            {'type': 'text', 'content': 'Files: ${params['prefix'] ?? ""}', 'style': {'bold': true}, 'pad': 8},
            {'type': 'for_each', 'items': 'files', 'template': {'type': 'list_tile', 'title': '{{name}}'}}
          ]},
          {'files': files.map((f) => {'name': f.split('/').last}).toList()});
      });
    } else if (action.startsWith('file:delete?')) {
      final key = params['key'] ?? '';
      if (key.isEmpty) return;
      PeopleDialogs.showSdui(context,
        {'type': 'column', 'children': [
          {'type': 'text', 'content': 'Delete?', 'style': {'bold': true}, 'pad': 8},
          {'type': 'text', 'content': key, 'pad': 8}
        ]},
        {},
        actions: [
          {'action': 'cancel', 'label': 'Cancel'},
          {'action': 'del', 'label': 'Delete', 'color': '#F44336'}
        ],
        onAction: (a) {
          if (a == 'cancel') Navigator.of(context).pop();
          if (a == 'del') { client.deleteFile(key); Navigator.of(context).pop(); }
        });
    } else if (action.startsWith('file:get?')) {
      final qIdx = action.indexOf('?');
      final key = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1))['key'] ?? '' : '';
      if (key.isEmpty) return;
      client.getBinary(key).then((data) {
        if (!context.mounted) return;
        final content = String.fromCharCodes(data);
        PeopleDialogs.showSdui(context,
          {'type': 'column', 'children': [
            {'type': 'text', 'content': key.split('/').last, 'style': {'bold': true}, 'pad': 8},
            {'type': 'text', 'content': content, 'style': {'size': 10}}
          ]},
          {});
      });
    } else if (action.startsWith('file:write?')) {
      final qIdx = action.indexOf('?');
      if (qIdx < 0) return;
      final params = Uri.splitQueryString(action.substring(qIdx + 1));
      final key = params['key'] ?? '';
      final value = params['value'] ?? '';
      if (key.isEmpty || value.isEmpty) return;
      client.writeFile(key, value).then((ok) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(ok ? 'Written: $key' : 'Write failed: $key')));
      });
    } else if (action.startsWith('config:set?')) {
      _handleConfigSet(context, action);
    }
  }

  static Future<void> _handleConfigSet(BuildContext context, String action) async {
    final qIdx = action.indexOf('?');
    if (qIdx < 0) return;
    final params = Uri.splitQueryString(action.substring(qIdx + 1));
    final key = params['key'];
    final value = params['value'];
    if (key == null || value == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Config set: $key=$value')));
  }

  static Future<void> showConfig(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    final keys = ['peerId', 'bridge_url', 'theme_mode'].where((k) => prefs.containsKey(k));
    final items = keys.map((k) => '$k: ${prefs.get(k)}').join('\n');
    PeopleDialogs.showSdui(context,
      {'type': 'column', 'children': [
        {'type': 'text', 'content': items.isEmpty ? '(no config)' : items, 'style': {'size': 13}}
      ]},
      {});
  }

  static void restartApp(BuildContext context) {
    PeopleDialogs.showSdui(context,
      {'type': 'column', 'children': [
        {'type': 'text', 'content': 'Restart app for changes to take effect', 'pad': 8}
      ]},
      {},
      actions: [
        {'action': 'cancel', 'label': 'Cancel'},
        {'action': 'restart', 'label': 'Restart', 'color': '#7C4DFF'}
      ],
      onAction: (a) {
        if (a == 'cancel') Navigator.of(context).pop();
        if (a == 'restart') {
          Navigator.pop(context);
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
            (r) => false);
          Future.delayed(const Duration(milliseconds: 100), () => Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const MainScreen()),
            (r) => false));
        }
      });
  }
}

// ===== people_action_dispatcher.dart =====
class SduiActionContext {
  final BuildContext context;
  final List<Map<String, dynamic>> users;
  final QiniuDirectClient? client;
  final Map? uiConfig;
  final VoidCallback onPollUsers;
  final void Function(String peerId) onCall;

  const SduiActionContext({
    required this.context,
    required this.users,
    required this.client,
    required this.uiConfig,
    required this.onPollUsers,
    required this.onCall,
  });
}

class PeopleActionDispatcher {
  static void handle(String action, SduiActionContext ctx) {
    for (final u in ctx.users) {
      if (action == 'call:${u['peerId']}') {
        ctx.onCall(u['peerId'] as String);
        return;
      }
    }
    final client = ctx.client;
    if (client == null) return;
    SduiActions.handle(ctx.context, action,
      onRefresh: ctx.onPollUsers,
      onDemo: () => client.spawnDemoPeer().then((_) => ctx.onPollUsers()),
      custom: {
        'settings': () => Navigator.pushNamed(ctx.context, '/theme'),
        'self_test': () => Navigator.pushNamed(ctx.context, '/voice', arguments: {
          'selfTest': 'true',
          'client': client,
          'targetPeerId': client.peerId,
        }),
        'room:open': () => PeopleDialogs.showRoomDialog(ctx.context),
        'audio_files': () => PeopleDialogs.showAudioFiles(ctx.context, client, ctx.uiConfig),
        'device:info': () => PeopleDialogs.showDeviceInfo(ctx.context, client),
        'config:get': () => PeopleFileActions.showConfig(ctx.context),
        'app:restart': () => PeopleFileActions.restartApp(ctx.context),
      },
    );
    PeopleFileActions.handle(ctx.context, action, client);
  }
}

// ===== people_sdui_view.dart =====
class PeopleSduiView extends StatelessWidget {
  final List<Map<String, dynamic>> users;
  final Map<String, dynamic> uiConfig;
  final QiniuDirectClient client;
  final AppTheme theme;
  final VoidCallback onRefresh;
  final void Function(String action) onAction;

  const PeopleSduiView({
    super.key,
    required this.users,
    required this.uiConfig,
    required this.client,
    required this.theme,
    required this.onRefresh,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final parser = SduiParser(
      vars: {'peerId': client.peerId, 'userCount': users.length},
      onAction: onAction,
    );
    if (uiConfig['children'] is List) {
      for (int i = 0; i < (uiConfig['children'] as List).length; i++) {
        final child = (uiConfig['children'] as List)[i];
        if (child is Map && child['type'] == 'users_list') {
          (uiConfig['children'] as List)[i] = {
            'type': 'column', 'children': users.map((u) => {
              'type': 'list_tile',
              'leadingIcon': 'person',
              'title': u['peerId'],
              'subtitle': 'Online',
              'trailingIcon': 'call',
              'trailingAction': 'call:${u['peerId']}',
              'action': 'call:${u['peerId']}',
            }).toList(),
          };
        }
      }
    }
    final rendered = parser.parse(uiConfig);
    if (rendered == null) {
      throw StateError('SDUI parse returned null');
    }
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('People', style: TextStyle(color: theme.textPrimary)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: onRefresh, color: theme.textSecondary)],
      ),
      body: rendered,
    );
  }
}

// ===== settings_profile_header.dart =====
class SettingsProfileHeader extends StatelessWidget {
  final AppTheme theme;
  const SettingsProfileHeader({super.key, required this.theme});

  @override
  Widget build(BuildContext context) {
    return SliverToBoxAdapter(
      child: Container(
        margin: const EdgeInsets.all(20), padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [
            theme.gradientPrimary[0].withValues(alpha: 0.2),
            theme.gradientPrimary[1].withValues(alpha: 0.1),
          ]),
          borderRadius: BorderRadius.circular(theme.radiusLarge + 4),
          border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1),
        ),
        child: Row(children: [
          Container(
            width: 72, height: 72,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: theme.gradientPrimary),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
            ),
            child: const Icon(Icons.person, color: Colors.white, size: 36),
          ),
          const SizedBox(width: 20),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Developer', style: TextStyle(color: theme.textPrimary, fontSize: 22, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text('ID: 88888888', style: TextStyle(color: theme.textTertiary, fontSize: 13)),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10)),
              child: const Text('VIP', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ])),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium - 4)),
            child: Icon(Icons.qr_code, color: theme.textPrimary, size: 22),
          ),
        ]),
      ),
    );
  }
}

// ===== settings_theme_preview.dart =====
class SettingsThemePreview extends ConsumerWidget {
  final AppTheme previewTheme;
  final String name;

  const SettingsThemePreview({
    super.key,
    required this.previewTheme,
    required this.name,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentTheme = ref.watch(currentThemeProvider);
    final sel = previewTheme.style == currentTheme.style;
    final idx = AppTheme.all.indexWhere((t) => t.style == previewTheme.style);
    return GestureDetector(
      onTap: () { if (idx >= 0) ref.read(currentThemeIndexProvider.notifier).state = idx; },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200), padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: sel ? previewTheme.gradientPrimary[0].withValues(alpha: 0.1) : currentTheme.background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: sel ? previewTheme.gradientPrimary[0] : currentTheme.textTertiary.withValues(alpha: 0.2),
            width: sel ? 2 : 1)),
        child: Row(children: [
          Row(children: [
            _colorDot(previewTheme.gradientPrimary[0]),
            _colorDot(previewTheme.gradientPrimary[1]),
            _colorDot(previewTheme.accent),
          ]),
          const SizedBox(width: 12),
          Expanded(child: Text(name, style: TextStyle(color: currentTheme.textPrimary, fontSize: 13,
            fontWeight: sel ? FontWeight.w600 : FontWeight.normal))),
          if (sel) Icon(Icons.check_circle, color: previewTheme.gradientPrimary[0], size: 20),
        ]),
      ),
    );
  }

  Widget _colorDot(Color c) => Container(
    margin: const EdgeInsets.only(right: 4), width: 16, height: 16,
    decoration: BoxDecoration(color: c, shape: BoxShape.circle,
      border: Border.all(color: Colors.white.withValues(alpha: 0.2), width: 1)),
  );
}

// ===== settings_theme_section.dart =====
class SettingsThemeSection extends ConsumerWidget {
  final AppTheme theme;
  final ThemeModeSetting themeMode;

  const SettingsThemeSection({
    super.key,
    required this.theme,
    required this.themeMode,
  });

  static const _modeLabels = {
    ThemeModeSetting.auto: '跟随系统',
    ThemeModeSetting.light: '浅色模式',
    ThemeModeSetting.dark: '深色模式',
    ThemeModeSetting.manual: '手动选择',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SliverToBoxAdapter(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
          child: Text('外观'.toUpperCase(), style: TextStyle(color: theme.textTertiary, fontSize: 11,
            fontWeight: FontWeight.w600, letterSpacing: 2)),
        ),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('主题模式', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: ThemeModeSetting.values.map((mode) {
              final sel = mode == themeMode;
              return GestureDetector(
                onTap: () => ref.read(themeModeProvider.notifier).state = mode,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    gradient: sel ? LinearGradient(colors: theme.gradientPrimary) : null,
                    color: sel ? null : theme.background,
                    borderRadius: BorderRadius.circular(20),
                    border: sel ? null : Border.all(color: theme.textTertiary.withValues(alpha: 0.2), width: 1),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(_modeIcon(mode), color: sel ? Colors.white : theme.textSecondary, size: 16),
                    const SizedBox(width: 6),
                    Text(_modeLabels[mode]!, style: TextStyle(
                      color: sel ? Colors.white : theme.textSecondary, fontSize: 12,
                      fontWeight: sel ? FontWeight.w600 : FontWeight.normal)),
                  ]),
                ),
              );
            }).toList()),
          ]),
        ),
        if (themeMode == ThemeModeSetting.manual) ...[
          const SizedBox(height: 12),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
              border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('选择主题', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
              const SizedBox(height: 12),
              for (final t in [
                {'theme': AppTheme.glassmorphism, 'name': 'Glass'},
                {'theme': AppTheme.minimalZen, 'name': 'Zen'},
                {'theme': AppTheme.natureOrganic, 'name': 'Nature'},
                {'theme': AppTheme.retroWave, 'name': 'Retro'},
                {'theme': AppTheme.corporatePro, 'name': 'Corporate'},
              ]) ...[
                SettingsThemePreview(previewTheme: t['theme'] as AppTheme, name: t['name'] as String),
                const SizedBox(height: 8),
              ],
            ]),
          ),
        ],
        const SizedBox(height: 8),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.gradientPrimary[0].withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1)),
          child: Row(children: [
            Container(width: 40, height: 40,
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10))),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('当前主题', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
              const SizedBox(height: 2),
              Text(theme.name, style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w600)),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: theme.gradientPrimary[0].withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8)),
              child: Text(_modeLabels[themeMode]!, style: TextStyle(color: theme.gradientPrimary[0],
                fontSize: 11, fontWeight: FontWeight.w500)),
            ),
          ]),
        ),
      ]),
    );
  }

  IconData _modeIcon(ThemeModeSetting mode) {
    switch (mode) {
      case ThemeModeSetting.auto: return Icons.brightness_auto;
      case ThemeModeSetting.light: return Icons.brightness_5;
      case ThemeModeSetting.dark: return Icons.brightness_2;
      case ThemeModeSetting.manual: return Icons.palette_outlined;
    }
  }
}

// ===== settings_hardcoded_view.dart =====
class SettingsHardcodedView extends StatelessWidget {
  final AppTheme theme;
  final ThemeModeSetting themeMode;

  const SettingsHardcodedView({
    super.key,
    required this.theme,
    required this.themeMode,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('SETTINGS',
          style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold,
            letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 2)),
        actions: [
          _buildActionButton(Icons.more_vert, theme), const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: CustomScrollView(
            slivers: [
              SettingsProfileHeader(theme: theme),
              SettingsThemeSection(theme: theme, themeMode: themeMode),
              _buildSection('General', [
                _buildSettingItem(Icons.language_outlined, 'Language', 'Chinese', theme.info, theme),
                _buildSettingItem(Icons.notifications_outlined, 'Notifications', 'Enabled', theme.success, theme),
              ], theme),
              _buildSection('Account', [
                _buildSettingItem(Icons.person_outlined, 'Profile', '', theme.gradientPrimary[0], theme),
                _buildSettingItem(Icons.security_outlined, 'Security', '', theme.warning, theme),
                _buildSettingItem(Icons.link_outlined, 'Linked Accounts', '', theme.accent, theme),
              ], theme),
              _buildSection('Connection', [
                BridgeUrlTile(theme: theme),
              ], theme),
              _buildSection('Other', [
                _buildSettingItem(Icons.storage_outlined, 'Storage', '2.4 GB', theme.gradientAccent[0], theme),
                _buildSettingItem(Icons.help_outline, 'Help', '', theme.gradientAccent[1], theme),
                _buildSettingItem(Icons.info_outlined, 'About', 'v1.0.0', theme.textSecondary, theme),
              ], theme),
              const SliverPadding(padding: EdgeInsets.only(bottom: 100)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActionButton(IconData icon, AppTheme theme) {
    return Container(
      margin: const EdgeInsets.only(right: 8), padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1),
      ),
      child: Icon(icon, color: theme.textSecondary, size: 20),
    );
  }

  Widget _buildSection(String title, List<Widget> items, AppTheme theme) {
    return SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
        child: Text(title.toUpperCase(), style: TextStyle(color: theme.textTertiary, fontSize: 11,
          fontWeight: FontWeight.w600, letterSpacing: 2))),
      ...items,
    ]));
  }

  Widget _buildSettingItem(IconData icon, String title, String value, Color color, AppTheme theme, {VoidCallback? onTap}) {
    return ListTile(
      leading: Container(
        width: 40, height: 40,
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 15)),
      subtitle: value.isNotEmpty ? Text(value, style: TextStyle(color: theme.textSecondary, fontSize: 12)) : null,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
      onTap: onTap,
    );
  }
}

// ===== settings_sdui_view.dart =====
IconData _sduiIcon(String name) => SduiParser.icons[name] ?? Icons.circle_outlined;

class SettingsSduiView extends StatelessWidget {
  final Map<String, dynamic> layout;
  final AppTheme theme;
  final void Function(String action) onAction;

  const SettingsSduiView({
    super.key,
    required this.layout,
    required this.theme,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final sections = layout['sections'] as List;
    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(layout['title'] as String? ?? 'SETTINGS',
          style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold)),
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: ListView(
            children: [
              for (final sec in sections) ...[
                if (sec is Map) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
                    child: Text((sec['title'] as String? ?? '').toUpperCase(),
                      style: TextStyle(color: theme.textTertiary, fontSize: 11,
                        fontWeight: FontWeight.w600, letterSpacing: 2)),
                  ),
                  if (sec['items'] is List)
                    for (final item in sec['items'])
                      if (item is Map) _buildItem(theme, item),
                ],
              ],
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Text('版本: $appVersion',
                  style: TextStyle(color: theme.textTertiary, fontSize: 11)),
              ),
              const Padding(padding: EdgeInsets.only(bottom: 100)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildItem(AppTheme theme, Map item) {
    final iconName = item['icon'] as String?;
    final label = item['label'] as String? ?? '';
    final value = item['value'] as String?;
    final action = item['action'] as String?;
    final colorStr = item['color'] as String?;
    final color = colorStr != null
        ? Color(int.parse(colorStr.replaceAll('#', '0xFF')))
        : theme.gradientPrimary[0];
    return ListCard(
      leading: iconName != null ? Icon(_sduiIcon(iconName), color: color, size: 20) : null,
      leadingColor: color,
      title: label,
      subtitle: value,
      onTap: action != null ? () => onAction(action) : null,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
    );
  }
}

// ===== slidable_list_item.dart =====
class SlidableAction {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const SlidableAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });
}

class SlidableListItem extends ConsumerWidget {
  final Widget child;
  final List<SlidableAction> actions;
  final VoidCallback? onTap;

  const SlidableListItem({
    super.key,
    required this.child,
    required this.actions,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    return Dismissible(
      key: UniqueKey(),
      background: Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: theme.success.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
        ),
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.only(left: 20),
        child: Icon(Icons.archive, color: theme.success),
      ),
      secondaryBackground: Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: theme.error.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
        ),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        child: Icon(Icons.delete, color: theme.error),
      ),
      child: GestureDetector(onTap: onTap, child: child),
    );
  }
}

// ===== timeline_list.dart =====
class TimelineList<T> extends ConsumerWidget {
  final List<T> items;
  final Widget Function(T, int) itemBuilder;
  final bool isReversed;

  const TimelineList({
    super.key,
    required this.items,
    required this.itemBuilder,
    this.isReversed = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final displayItems = isReversed ? items.reversed.toList() : items;
    return ListView.builder(
      itemCount: displayItems.length,
      itemBuilder: (context, index) {
        final isLast = index == displayItems.length - 1;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: theme.primary,
                    shape: BoxShape.circle,
                    border: Border.all(color: theme.background, width: 2),
                  ),
                ),
                if (!isLast)
                  Container(
                    width: 2,
                    height: 50,
                    color: theme.textTertiary.withValues(alpha: 0.2),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(child: itemBuilder(displayItems[index], index)),
          ],
        );
      },
    );
  }
}
