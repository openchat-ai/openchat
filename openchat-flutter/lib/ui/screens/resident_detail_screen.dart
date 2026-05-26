import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../core/models/agent_model.dart';
import '../../providers/theme_provider.dart';
import '../../providers/resident_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../providers/sage_provider.dart';
import '../../core/models/sage_model.dart';

class ResidentDetailScreen extends ConsumerStatefulWidget {
  final int residentId;

  const ResidentDetailScreen({super.key, required this.residentId});

  @override
  ConsumerState<ResidentDetailScreen> createState() =>
      _ResidentDetailScreenState();
}

class _ResidentDetailScreenState extends ConsumerState<ResidentDetailScreen> {
  Map<String, dynamic>? _sduiLayout;
  Resident? _resident;
  List<Agent> _agents = [];
  List<ChildSummary> _children = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    QiniuDirectClient.fetchConfigFile('oc/config/ui_resident_detail.json')
        .then((m) { if (mounted && m is Map) setState(() => _sduiLayout = Map<String, dynamic>.from(m)); });
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final notifier = ref.read(residentProvider.notifier);
      final resident = await notifier.getDetail(widget.residentId);
      final agents = await notifier.getAgents(widget.residentId);
      final children = await notifier.getChildren(widget.residentId);
      // 加载师徒对话
      ref.read(sageProvider.notifier).loadConversation(widget.residentId);
      if (mounted) {
        setState(() {
          _resident = resident;
          _agents = agents;
          _children = children;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showCreateAgentDialog() {
    final roleController = TextEditingController(text: 'custom');
    final nameController = TextEditingController();
    final taskController = TextEditingController();
    final theme = ref.read(currentThemeProvider);

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('派出 Agent', style: TextStyle(color: theme.textPrimary)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _dialogField(theme, '角色', roleController,
                hint: 'security_auditor / test_engineer / custom'),
            const SizedBox(height: 12),
            _dialogField(theme, '名称（可选）', nameController),
            const SizedBox(height: 12),
            _dialogField(theme, '任务描述', taskController,
                hint: '审计登录模块安全性'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('取消', style: TextStyle(color: theme.textSecondary)),
          ),
          TextButton(
            onPressed: () async {
              final notifier = ref.read(residentProvider.notifier);
              await notifier.createAgent(
                residentId: widget.residentId,
                role: roleController.text.trim(),
                name: nameController.text.trim().isEmpty
                    ? null
                    : nameController.text.trim(),
                task: taskController.text.trim().isEmpty
                    ? null
                    : taskController.text.trim(),
              );
              Navigator.pop(ctx);
              _load();
            },
            child: Text('派出', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );
  }

  Widget _dialogField(AppTheme theme, String label, TextEditingController ctrl,
      {String? hint}) {
    return TextField(
      controller: ctrl,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        labelStyle: TextStyle(color: theme.textSecondary),
        hintStyle: TextStyle(color: theme.textTertiary),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide:
              BorderSide(color: theme.textTertiary.withValues(alpha: 0.2)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: theme.primary),
        ),
      ),
      style: TextStyle(color: theme.textPrimary),
    );
  }

  void _showCreateChildDialog() {
    final nameController = TextEditingController();
    final theme = ref.read(currentThemeProvider);

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('繁衍后代', style: TextStyle(color: theme.textPrimary)),
        content: TextField(
          controller: nameController,
          autofocus: true,
          decoration: InputDecoration(
            hintText: '给孩子取个名字（留空自动生成）',
            hintStyle: TextStyle(color: theme.textTertiary),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide:
                  BorderSide(color: theme.textTertiary.withValues(alpha: 0.2)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: theme.primary),
            ),
          ),
          style: TextStyle(color: theme.textPrimary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child:
                Text('取消', style: TextStyle(color: theme.textSecondary)),
          ),
          TextButton(
            onPressed: () async {
              final notifier = ref.read(residentProvider.notifier);
              final name = nameController.text.trim();
              await notifier.create(
                name: name.isEmpty ? null : name,
                parentId: widget.residentId,
              );
              Navigator.pop(ctx);
              _load();
            },
            child: Text('出生', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        backgroundColor: theme.background,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          title: Text(
            _resident?.name ?? '居民档案',
            style: TextStyle(
              color: theme.textPrimary,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          actions: [
            if (_resident != null && _resident!.isActive) ...[
              IconButton(
                icon: Icon(Icons.auto_awesome_outlined, color: Colors.amberAccent),
                onPressed: _showWisdomDialog,
                tooltip: '智者点拨',
              ),
              IconButton(
                icon: Icon(Icons.add_task_rounded, color: theme.primary),
                onPressed: _showCreateAgentDialog,
                tooltip: '派出 Agent',
              ),
            ],
          ],
          bottom: _resident != null
              ? TabBar(
                  indicatorColor: theme.primary,
                  labelColor: theme.primary,
                  unselectedLabelColor: theme.textTertiary,
                  tabs: const [
                    Tab(text: '时间线'),
                    Tab(text: '师徒对话'),
                  ],
                )
              : null,
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _resident == null
                ? Center(
                    child: Text('居民不存在',
                        style: TextStyle(color: theme.textSecondary)))
                : Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [theme.background, theme.surface],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                    ),
                    child: SafeArea(
                      child: TabBarView(
                        children: [
                          // Tab 1 — 时间线
                          CustomScrollView(
                            slivers: [
                              _buildProfile(theme, _resident!),
                              _buildFamily(theme, _resident!),
                              _buildActiveAgents(theme),
                              _buildTimeline(theme, _resident!.activities),
                            ],
                          ),
                          // Tab 2 — 师徒对话
                          _buildMentorDialogue(theme),
                        ],
                      ),
                    ),
                  ),
        floatingActionButton: _resident != null && _resident!.isActive
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                FloatingActionButton.small(
                  heroTag: 'child',
                  onPressed: _showCreateChildDialog,
                  backgroundColor: theme.success.withValues(alpha: 0.8),
                  child: const Icon(Icons.family_restroom_rounded,
                      color: Colors.white),
                ),
                const SizedBox(height: 12),
                FloatingActionButton.extended(
                  heroTag: 'agent',
                  onPressed: _showCreateAgentDialog,
                  backgroundColor: theme.primary,
                  icon: const Icon(Icons.add_task_rounded, color: Colors.white),
                  label: const Text('派出 Agent',
                      style: TextStyle(color: Colors.white)),
                ),
              ],
            )
          : null,
    ));
  }

  // ==================== 个人档案 ====================

  Widget _buildProfile(AppTheme theme, Resident resident) {
    final days = DateTime.now().difference(resident.createdAt).inDays;
    final tags = resident.traitLabels;

    return SliverToBoxAdapter(
      child: Container(
        margin: const EdgeInsets.all(20),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusLarge),
          border: Border.all(
            color: resident.isActive
                ? theme.gradientPrimary[0].withValues(alpha: 0.3)
                : theme.textTertiary.withValues(alpha: 0.08),
          ),
        ),
        child: Column(
          children: [
            // 头像
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(20),
                boxShadow: theme.useGlow
                    ? [
                        BoxShadow(
                          color: theme.primary.withValues(alpha: 0.3),
                          blurRadius: 20,
                          spreadRadius: 2,
                        ),
                      ]
                    : null,
              ),
              child: Center(
                child: Text(
                  resident.name.isNotEmpty ? resident.name[0] : '?',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 32,
                      fontWeight: FontWeight.bold),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(resident.name,
                style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _chip('ID: ${resident.id}', theme.textTertiary, theme),
                const SizedBox(width: 8),
                _chip(resident.home, theme.gradientPrimary[0], theme),
                if (!resident.isActive) ...[
                  const SizedBox(width: 8),
                  _chip('已注销', theme.textTertiary, theme),
                ],
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '出生 ${resident.createdAt.toLocal().toString().substring(0, 10)} · 已存活 $days 天',
              style: TextStyle(color: theme.textTertiary, fontSize: 13),
            ),

            // 性格标签
            if (tags.isNotEmpty) ...[
              const SizedBox(height: 14),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: tags.map((t) {
                  return Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(colors: [
                        theme.primary.withValues(alpha: 0.2),
                        theme.gradientPrimary[0].withValues(alpha: 0.1),
                      ]),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: theme.primary.withValues(alpha: 0.2),
                      ),
                    ),
                    child: Text(t,
                        style: TextStyle(
                            color: theme.primary,
                            fontSize: 12,
                            fontWeight: FontWeight.w500)),
                  );
                }).toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _chip(String text, Color color, AppTheme theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text,
          style: TextStyle(
              color: color, fontSize: 11, fontWeight: FontWeight.w500)),
    );
  }

  // ==================== 家庭信息 ====================

  Widget _buildFamily(AppTheme theme, Resident resident) {
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
        child: Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(theme.radiusLarge),
            border: Border.all(
                color: theme.textTertiary.withValues(alpha: 0.06)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 父居民
              if (resident.parentName != null) ...[
                Text('父居民',
                    style: TextStyle(
                        color: theme.textTertiary, fontSize: 12)),
                const SizedBox(height: 6),
                GestureDetector(
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ResidentDetailScreen(
                            residentId: resident.parentId!),
                      ),
                    );
                  },
                  child: Row(
                    children: [
                      Icon(Icons.person, color: theme.primary, size: 18),
                      const SizedBox(width: 6),
                      Text(resident.parentName!,
                          style: TextStyle(
                              color: theme.primary,
                              fontSize: 15,
                              fontWeight: FontWeight.w600)),
                      const SizedBox(width: 4),
                      Icon(Icons.chevron_right,
                          color: theme.primary.withValues(alpha: 0.5),
                          size: 18),
                    ],
                  ),
                ),
                const Divider(height: 24),
              ],

              // 子女列表
              Row(
                children: [
                  Text('后代',
                      style: TextStyle(
                          color: theme.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w600)),
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: theme.primary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text('${_children.length}',
                        style: TextStyle(
                            color: theme.primary,
                            fontSize: 12,
                            fontWeight: FontWeight.w600)),
                  ),
                  const Spacer(),
                  if (resident.isActive)
                    GestureDetector(
                      onTap: _showCreateChildDialog,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: theme.success.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.add, color: theme.success, size: 16),
                            const SizedBox(width: 4),
                            Text('繁衍',
                                style: TextStyle(
                                    color: theme.success,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              if (_children.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Row(
                    children: [
                      Icon(Icons.family_restroom_rounded,
                          color: theme.textTertiary, size: 20),
                      const SizedBox(width: 8),
                      Text('尚无后代',
                          style:
                              TextStyle(color: theme.textTertiary, fontSize: 13)),
                    ],
                  ),
                )
              else
                ..._children.map((c) => _buildChildTile(theme, c)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildChildTile(AppTheme theme, ChildSummary child) {
    final indent = (child.depth - 1) * 20.0;
    final isDirectChild = child.depth == 1;

    return GestureDetector(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ResidentDetailScreen(residentId: child.id),
          ),
        );
      },
      child: Container(
        margin: EdgeInsets.only(left: indent, bottom: 6),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
          border: Border.all(
              color: theme.textTertiary.withValues(alpha: 0.06)),
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: child.isActive
                    ? theme.gradientPrimary[0].withValues(alpha: 0.2)
                    : theme.textTertiary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Center(
                child: Text(
                  child.name.isNotEmpty ? child.name[0] : '?',
                  style: TextStyle(
                    color: child.isActive ? theme.gradientPrimary[0] : theme.textTertiary,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(child.name,
                          style: TextStyle(
                              color: theme.textPrimary,
                              fontWeight: FontWeight.w600,
                              fontSize: 14)),
                      if (child.isActive) ...[
                        const SizedBox(width: 6),
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: theme.success,
                            borderRadius: BorderRadius.circular(3),
                          ),
                        ),
                      ],
                    ],
                  ),
                  Text(
                    isDirectChild ? '子女' : '第 ${child.depth} 代',
                    style:
                        TextStyle(color: theme.textTertiary, fontSize: 11),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right,
                color: theme.textTertiary.withValues(alpha: 0.4), size: 18),
          ],
        ),
      ),
    );
  }

  // ==================== 活跃 Agent ====================

  Widget _buildActiveAgents(AppTheme theme) {
    final active = _agents
        .where((a) =>
            a.status == AgentStatus.running ||
            a.status == AgentStatus.initializing)
        .toList();

    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('活跃 Agent',
                    style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w600)),
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text('${active.length}',
                      style: TextStyle(
                          color: theme.primary,
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (active.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: theme.surface.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(theme.radiusMedium),
                ),
                child: Column(
                  children: [
                    Icon(Icons.inbox_outlined,
                        color: theme.textTertiary, size: 32),
                    const SizedBox(height: 8),
                    Text('当前没有活跃 Agent',
                        style:
                            TextStyle(color: theme.textTertiary, fontSize: 13)),
                  ],
                ),
              )
            else
              ...active.map((agent) => _buildAgentTile(theme, agent)),
          ],
        ),
      ),
    );
  }

  Widget _buildAgentTile(AppTheme theme, Agent agent) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.08)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: theme.primary.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(Icons.smart_toy_rounded, color: theme.primary, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(agent.name,
                    style: TextStyle(
                        color: theme.textPrimary,
                        fontWeight: FontWeight.w600,
                        fontSize: 14)),
                if (agent.task != null)
                  Text(agent.task!,
                      style:
                          TextStyle(color: theme.textTertiary, fontSize: 12)),
              ],
            ),
          ),
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: theme.success,
              borderRadius: BorderRadius.circular(4),
              boxShadow: theme.useGlow
                  ? [
                      BoxShadow(
                          color: theme.success.withValues(alpha: 0.6),
                          blurRadius: 8)
                    ]
                  : null,
            ),
          ),
        ],
      ),
    );
  }

  // ==================== 时间线 / 履历 ====================

  Widget _buildTimeline(AppTheme theme, List<ResidentActivity> activities) {
    if (activities.isEmpty) {
      return const SliverToBoxAdapter(child: SizedBox.shrink());
    }

    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 100),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('履历',
                style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            ...activities.map((act) => _buildTimelineItem(theme, act)),
          ],
        ),
      ),
    );
  }

  Widget _buildTimelineItem(AppTheme theme, ResidentActivity activity) {
    IconData icon;
    Color color;
    switch (activity.type) {
      case 'born':
        icon = Icons.celebration_outlined;
        color = theme.gradientPrimary[0];
        break;
      case 'agent_created':
        icon = Icons.play_circle_outline;
        color = theme.success;
        break;
      case 'agent_completed':
        icon = Icons.check_circle_outline;
        color = theme.info;
        break;
      case 'awake':
        icon = Icons.wb_sunny_outlined;
        color = Colors.orangeAccent;
        break;
      case 'sleeping':
        icon = Icons.nights_stay_outlined;
        color = Colors.indigoAccent;
        break;
      case 'task_assigned':
        icon = Icons.assignment_outlined;
        color = theme.primary;
        break;
      case 'task_done':
        icon = Icons.task_alt_rounded;
        color = theme.success;
        break;
      case 'task_failed':
        icon = Icons.error_outline_rounded;
        color = theme.error;
        break;
      case 'sage_ask':
        icon = Icons.help_outline;
        color = Colors.amber;
        break;
      case 'sage_answer':
        icon = Icons.reply_rounded;
        color = Colors.green;
        break;
      case 'sage_guide':
        icon = Icons.auto_awesome_outlined;
        color = Colors.purpleAccent;
        break;
      case 'sage_praise':
        icon = Icons.favorite_outline;
        color = Colors.pinkAccent;
        break;
      case 'collab_started':
        icon = Icons.connect_without_contact_rounded;
        color = Colors.teal;
        break;
      case 'collab_done':
        icon = Icons.handshake_outlined;
        color = Colors.deepOrangeAccent;
        break;
      default:
        icon = Icons.circle_outlined;
        color = theme.textTertiary;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 16),
              ),
              Container(
                  width: 2,
                  height: 30,
                  color: theme.textTertiary.withValues(alpha: 0.08)),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(activity.message,
                    style:
                        TextStyle(color: theme.textPrimary, fontSize: 14)),
                if (activity.summary != null && activity.summary!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    activity.summary!.replaceAll('\n', ' '),
                    style: TextStyle(color: theme.textTertiary, fontSize: 11),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                const SizedBox(height: 2),
                Text(
                  activity.timestamp.toLocal().toString().substring(0, 19),
                  style: TextStyle(color: theme.textTertiary, fontSize: 11),
                ),
                if (activity.agentRole != null &&
                    activity.agentRole != 'custom') ...[
                  const SizedBox(height: 2),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(activity.agentRole!,
                        style: TextStyle(color: color, fontSize: 10)),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ==================== 智者点拨对话框 ====================

  void _showWisdomDialog() {
    final contentController = TextEditingController();
    final theme = ref.read(currentThemeProvider);
    String selectedType = 'guide';

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: theme.surface,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Row(
            children: [
              Icon(Icons.auto_awesome_outlined, color: Colors.amberAccent, size: 20),
              const SizedBox(width: 8),
              Text('智者点拨', style: TextStyle(color: theme.textPrimary)),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 类型选择
              Row(
                children: [
                  _typeChip(theme, '指导', 'guide', selectedType == 'guide',
                      () => setDialogState(() => selectedType = 'guide')),
                  const SizedBox(width: 8),
                  _typeChip(theme, '鼓励', 'praise', selectedType == 'praise',
                      () => setDialogState(() => selectedType = 'praise')),
                ],
              ),
              const SizedBox(height: 16),
              TextField(
                controller: contentController,
                autofocus: true,
                maxLines: 4,
                decoration: InputDecoration(
                  hintText: selectedType == 'guide'
                      ? '对孩子说一句指点的话……'
                      : '给孩子一些鼓励……',
                  hintStyle: TextStyle(color: theme.textTertiary),
                  filled: true,
                  fillColor: theme.background,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                ),
                style: TextStyle(color: theme.textPrimary),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('取消', style: TextStyle(color: theme.textSecondary)),
            ),
            TextButton(
              onPressed: () async {
                final text = contentController.text.trim();
                if (text.isEmpty) return;
                final notifier = ref.read(sageProvider.notifier);
                await notifier.guide(widget.residentId, text, selectedType);
                Navigator.pop(ctx);
                _load();
              },
              child: Text('发送', style: TextStyle(color: theme.primary)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _typeChip(AppTheme theme, String label, String value, bool selected, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? theme.primary.withValues(alpha: 0.2) : theme.textTertiary.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? theme.primary : Colors.transparent,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? theme.primary : theme.textSecondary,
            fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
          ),
        ),
      ),
    );
  }

  // ==================== 师徒对话 Tab ====================

  Widget _buildMentorDialogue(AppTheme theme) {
    final sageAsync = ref.watch(sageProvider);

    return sageAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Text('加载失败', style: TextStyle(color: theme.textSecondary)),
      ),
      data: (records) {
        if (records.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.chat_outlined, color: theme.textTertiary, size: 48),
                const SizedBox(height: 12),
                Text('尚无师徒对话',
                    style: TextStyle(color: theme.textTertiary, fontSize: 14)),
                const SizedBox(height: 4),
                Text('居民会在需要时向智者求助',
                    style: TextStyle(color: theme.textTertiary.withValues(alpha: 0.6), fontSize: 12)),
              ],
            ),
          );
        }

        // 筛选：全部 / 求助(ask) / 点拨(guide+praise)
        final filterTabs = ['全部', '求助', '点拨'];
        return DefaultTabController(
          length: 3,
          child: Column(
            children: [
              // 子筛选栏
              Container(
                margin: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                decoration: BoxDecoration(
                  color: theme.surface.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: TabBar(
                  indicatorSize: TabBarIndicatorSize.tab,
                  indicator: BoxDecoration(
                    color: theme.primary.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  labelColor: theme.primary,
                  unselectedLabelColor: theme.textTertiary,
                  labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  tabs: filterTabs.map((t) => Tab(text: t)).toList(),
                ),
              ),
              // 书信列表
              Expanded(
                child: TabBarView(
                  children: filterTabs.map((filter) {
                    Iterable<SageRecord> filtered = records;
                    if (filter == '求助') {
                      filtered = records.where((r) => r.type == 'ask');
                    } else if (filter == '点拨') {
                      filtered = records.where((r) => r.type == 'guide' || r.type == 'praise');
                    }

                    if (filtered.isEmpty) {
                      return Center(
                        child: Text('暂无记录',
                            style: TextStyle(color: theme.textTertiary)),
                      );
                    }

                    return ListView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
                      itemCount: filtered.length,
                      itemBuilder: (ctx, i) {
                        final record = filtered.elementAt(i);
                        return _buildMentorCard(theme, record);
                      },
                    );
                  }).toList(),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildMentorCard(AppTheme theme, SageRecord record) {
    final isFromResident = record.isFromResident;
    final isUnanswered = record.isQuestion;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 信纸头
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isFromResident
                  ? theme.primary.withValues(alpha: 0.08)
                  : Colors.amber.withValues(alpha: 0.08),
              borderRadius: BorderRadius.vertical(
                top: const Radius.circular(12),
                bottom: Radius.zero,
              ),
              border: Border(
                left: BorderSide(
                  color: isFromResident ? theme.primary : Colors.amber,
                  width: 3,
                ),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 署名行
                Row(
                  children: [
                    Icon(
                      isFromResident ? Icons.person_outline : Icons.auto_awesome,
                      color: isFromResident ? theme.primary : Colors.amber,
                      size: 16,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      isFromResident ? _resident?.name ?? '居民' : '智者',
                      style: TextStyle(
                        color: isFromResident ? theme.primary : Colors.amber,
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    if (isUnanswered) ...[
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.red.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text('待回复',
                            style: TextStyle(color: Colors.red, fontSize: 10)),
                      ),
                    ],
                    if (!isFromResident && record.type == 'praise') ...[
                      const Spacer(),
                      Icon(Icons.favorite, color: Colors.pinkAccent, size: 14),
                    ],
                  ],
                ),
                const SizedBox(height: 10),
                // 内容
                Text(
                  record.content,
                  style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 14,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 8),
                // 时间戳
                Text(
                  record.createdAt.toLocal().toString().substring(0, 19),
                  style: TextStyle(color: theme.textTertiary, fontSize: 11),
                ),
              ],
            ),
          ),
          // 未回答的问题 → 回复按钮
          if (isUnanswered)
            Container(
              width: double.infinity,
              decoration: BoxDecoration(
                color: theme.surface.withValues(alpha: 0.3),
                borderRadius: const BorderRadius.vertical(bottom: Radius.circular(12)),
                border: Border(
                  left: BorderSide(color: theme.primary, width: 3),
                ),
              ),
              child: InkWell(
                onTap: () => _showReplyDialog(theme, record),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      Icon(Icons.reply_rounded, color: theme.primary, size: 16),
                      const SizedBox(width: 6),
                      Text('回复 TA',
                          style: TextStyle(
                              color: theme.primary,
                              fontSize: 13,
                              fontWeight: FontWeight.w500)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  void _showReplyDialog(AppTheme theme, SageRecord record) {
    final replyController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('回复 ${_resident?.name ?? "居民"}',
            style: TextStyle(color: theme.textPrimary)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.primary.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(8),
                border: Border(left: BorderSide(color: theme.primary, width: 2)),
              ),
              child: Text(record.content,
                  style: TextStyle(color: theme.textSecondary, fontSize: 13)),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: replyController,
              autofocus: true,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: '写下你的指点……',
                hintStyle: TextStyle(color: theme.textTertiary),
                filled: true,
                fillColor: theme.background,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
              style: TextStyle(color: theme.textPrimary),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('取消', style: TextStyle(color: theme.textSecondary)),
          ),
          TextButton(
            onPressed: () async {
              final text = replyController.text.trim();
              if (text.isEmpty) return;
              final notifier = ref.read(sageProvider.notifier);
              await notifier.answer(widget.residentId, record.id, text);
              Navigator.pop(ctx);
              _load();
            },
            child: Text('发送', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );
  }
}
