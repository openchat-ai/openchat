import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';

class MarkerPoint {
  double x, y;
  Color color;
  String? comment;
  MarkerPoint(this.x, this.y, this.color, [this.comment]);
}

class CodeItem {
  final String name;
  final String type;
  final int line;
  CodeItem(this.name, this.type, this.line);
}

class DevIdeScreen extends ConsumerStatefulWidget {
  const DevIdeScreen({super.key});

  @override
  ConsumerState<DevIdeScreen> createState() => _DevIdeScreenState();
}

class _DevIdeScreenState extends ConsumerState<DevIdeScreen> {
  bool _showPreview = true;
  bool _showOutline = true;
  bool _toolbarExpanded = true;
  int _selectedTab = 0;
  Color _markerColor = Colors.red;
  final List<MarkerPoint> _markers = [];
  String _currentPath = 'lib/main.dart';
  final ScrollController _codeScrollController = ScrollController();
  String? _selectedAgent;
  final TextEditingController _agentInputController = TextEditingController();
  final List<Map<String, String>> _agentMessages = [];

  final List<CodeItem> _codeItems = [
    CodeItem('DevIdeScreen', 'class', 21),
    CodeItem('State', 'class', 22),
    CodeItem('build', 'method', 25),
    CodeItem('_buildToolbar', 'method', 38),
    CodeItem('_buildFileExplorer', 'method', 62),
    CodeItem('_buildCodeEditor', 'method', 91),
    CodeItem('_buildPreview', 'method', 127),
    CodeItem('_buildBottomPanel', 'method', 181),
    CodeItem('Colors', 'import', 1),
    CodeItem('MarkerPoint', 'import', 3),
  ];

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return Scaffold(
      backgroundColor: theme.background,
      appBar: _buildToolbar(theme),
      body: Column(
        children: [
          _buildNavigatorBar(theme),
          Expanded(
            child: Row(
              children: [
                if (_showOutline) _buildOutlinePanel(theme),
                Expanded(flex: 3, child: _buildCodeEditor(theme)),
                if (_showPreview) Expanded(flex: 2, child: _buildPreview(theme)),
              ],
            ),
          ),
          _buildBottomPanel(theme),
        ],
      ),
    );
  }

  Widget _buildNavigatorBar(AppTheme theme) {
    final parts = _currentPath.split('/');
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      color: theme.surface.withValues(alpha: 0.5),
      child: Row(
        children: [
          Icon(Icons.folder, color: theme.warning, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (int i = 0; i < parts.length; i++) ...[
                    GestureDetector(
                      onTap: () {
                        final newPath = parts.sublist(0, i + 1).join('/');
                        setState(() => _currentPath = newPath);
                      },
                      child: Text(
                        parts[i],
                        style: TextStyle(
                          color: i == parts.length - 1 ? theme.textPrimary : theme.info,
                          fontFamily: 'monospace',
                          fontSize: 13,
                        ),
                      ),
                    ),
                    if (i < parts.length - 1)
                      Text(' / ', style: TextStyle(color: theme.textTertiary, fontFamily: 'monospace')),
                  ],
                ],
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: theme.success.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text('已保存', style: TextStyle(color: theme.success, fontSize: 10)),
          ),
        ],
      ),
    );
  }

  Widget _buildOutlinePanel(AppTheme theme) {
    final grouped = <String, List<CodeItem>>{};
    for (final item in _codeItems) {
      grouped.putIfAbsent(item.type, () => []).add(item);
    }

    return Container(
      width: 180,
      color: theme.surface.withValues(alpha: 0.3),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            color: theme.surface.withValues(alpha: 0.5),
            child: Row(
              children: [
                Icon(Icons.account_tree, color: theme.success, size: 14),
                const SizedBox(width: 6),
                Text('大纲', style: TextStyle(color: theme.textSecondary, fontSize: 11)),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              children: grouped.entries.expand((entry) => [
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
                  child: Text(_getTypeName(entry.key), style: TextStyle(color: _getTypeColor(entry.key, theme), fontSize: 10, fontWeight: FontWeight.bold)),
                ),
                ...entry.value.map((item) => ListTile(
                  dense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 10),
                  leading: Icon(_getTypeIcon(item.type), color: _getTypeColor(item.type, theme), size: 14),
                  title: Text(item.name, style: TextStyle(color: theme.textSecondary, fontSize: 11, fontFamily: 'monospace')),
                  trailing: Text('${item.line}', style: TextStyle(color: theme.textTertiary, fontSize: 9)),
                  onTap: () => _scrollToLine(item.line),
                )),
              ]).toList(),
            ),
          ),
        ],
      ),
    );
  }

  void _scrollToLine(int line) {
    const lineHeight = 21.6;
    final offset = (line - 1) * lineHeight;
    _codeScrollController.animateTo(offset, duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
  }

  String _getTypeName(String type) {
    switch (type) {
      case 'class': return '类';
      case 'function': return '函数';
      case 'method': return '方法';
      case 'import': return '导入';
      default: return type;
    }
  }

  Color _getTypeColor(String type, AppTheme theme) {
    switch (type) {
      case 'class': return theme.gradientPrimary[0];
      case 'function': return theme.success;
      case 'method': return theme.info;
      case 'import': return theme.warning;
      default: return theme.textTertiary;
    }
  }

  IconData _getTypeIcon(String type) {
    switch (type) {
      case 'class': return Icons.class_;
      case 'function': return Icons.functions;
      case 'method': return Icons.more_horiz;
      case 'import': return Icons.download;
      default: return Icons.code;
    }
  }

  PreferredSizeWidget _buildToolbar(AppTheme theme) {
    return AppBar(
      backgroundColor: theme.surface.withValues(alpha: 0.5),
      title: Row(
        children: [
          Icon(Icons.code, color: theme.info, size: 22),
          const SizedBox(width: 8),
          Text('Dev IDE', style: TextStyle(color: theme.textPrimary, fontFamily: 'monospace', fontSize: 17)),
          if (_toolbarExpanded) ...[
            const SizedBox(width: 20),
            _buildToolBtn(Icons.play_arrow, '运行', theme.success, theme),
            _buildToolBtn(Icons.save, '保存', theme.info, theme),
            _buildToolBtn(Icons.format_list_bulleted, '格式化', theme.warning, theme),
            _buildToolBtn(Icons.bug_report, '调试', theme.gradientPrimary[0], theme),
            const SizedBox(width: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: theme.gradientPrimary[0].withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: theme.gradientPrimary[0]),
              ),
              child: DropdownButton<String>(
                value: _selectedAgent,
                hint: Text('选择Agent', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                dropdownColor: theme.surface,
                items: ['代码助手', 'Bug猎手', '优化专家', '测试达人'].map((a) => DropdownMenuItem(value: a, child: Text(a, style: TextStyle(color: theme.textPrimary, fontSize: 12)))).toList(),
                onChanged: (v) => setState(() => _selectedAgent = v),
                underline: const SizedBox(),
                icon: Icon(Icons.smart_toy, color: theme.gradientPrimary[0], size: 16),
              ),
            ),
          ],
        ],
      ),
      actions: [
        IconButton(
          icon: Icon(_showOutline ? Icons.account_tree : Icons.account_tree_outlined, color: theme.textSecondary),
          onPressed: () => setState(() => _showOutline = !_showOutline),
          tooltip: '大纲面板',
        ),
        IconButton(
          icon: Icon(_toolbarExpanded ? Icons.unfold_less : Icons.unfold_more, color: theme.textSecondary),
          onPressed: () => setState(() => _toolbarExpanded = !_toolbarExpanded),
          tooltip: '折叠工具栏',
        ),
        IconButton(
          icon: Icon(_showPreview ? Icons.visibility : Icons.visibility_off, color: theme.textSecondary),
          onPressed: () => setState(() => _showPreview = !_showPreview),
          tooltip: '切换预览',
        ),
      ],
    );
  }

  Widget _buildToolBtn(IconData icon, String tip, Color color, AppTheme theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: Tooltip(message: tip, child: IconButton(icon: Icon(icon, color: color, size: 19), onPressed: () {})),
    );
  }

  Widget _buildCodeEditor(AppTheme theme) {
    final codeLines = [
      {'text': "import 'package:flutter/material.dart';", 'color': theme.info},
      {'text': "", 'color': theme.textPrimary},
      {'text': "class DevIdeScreen extends StatefulWidget {", 'color': theme.gradientPrimary[0]},
      {'text': "  const DevIdeScreen({super.key});", 'color': theme.textPrimary},
      {'text': "", 'color': theme.textPrimary},
      {'text': "  @override", 'color': theme.warning},
      {'text': "  State<DevIdeScreen> createState() => _DevIdeScreenState();", 'color': theme.textPrimary},
      {'text': "}", 'color': theme.gradientPrimary[0]},
      {'text': "", 'color': theme.textPrimary},
      {'text': "class _DevIdeScreenState extends State<DevIdeScreen> {", 'color': theme.gradientPrimary[0]},
      {'text': "  bool _showPreview = true;", 'color': theme.warning},
      {'text': "  bool _toolbarExpanded = true;", 'color': theme.warning},
      {'text': "", 'color': theme.textPrimary},
      {'text': "  @override", 'color': theme.warning},
      {'text': "  Widget build(BuildContext context) {", 'color': theme.textPrimary},
      {'text': "    return Scaffold(", 'color': theme.textPrimary},
      {'text': "      backgroundColor: theme.background;", 'color': theme.success},
      {'text': "      appBar: _buildToolbar(),", 'color': theme.textPrimary},
      {'text': "      body: Row(children: [", 'color': theme.textPrimary},
      {'text': "        Expanded(child: _buildCodeEditor()),", 'color': theme.textPrimary},
      {'text': "        if (_showPreview) _buildPreview(),", 'color': theme.textPrimary},
      {'text': "      ]),", 'color': theme.textPrimary},
      {'text': "    );", 'color': theme.textPrimary},
      {'text': "  }", 'color': theme.textPrimary},
      {'text': "", 'color': theme.textPrimary},
      {'text': "  Widget _buildToolbar() {", 'color': theme.info},
      {'text': "    return AppBar(", 'color': theme.textPrimary},
      {'text': "      backgroundColor: theme.surface;", 'color': theme.success},
      {'text': "      // ... toolbar items", 'color': theme.textTertiary},
      {'text': "    );", 'color': theme.textPrimary},
      {'text': "  }", 'color': theme.textPrimary},
      {'text': "}", 'color': theme.gradientPrimary[0]},
    ];
    return Container(
      color: theme.background,
      child: ListView.builder(
        controller: _codeScrollController,
        padding: const EdgeInsets.all(16),
        itemCount: codeLines.length,
        itemBuilder: (context, i) {
          final line = codeLines[i];
          final lineNum = i + 1;
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 36,
                child: GestureDetector(
                  onTap: () => _scrollToLine(lineNum),
                  child: Text('$lineNum', style: TextStyle(color: theme.textTertiary, fontSize: 12, fontFamily: 'monospace')),
                ),
              ),
              Expanded(
                child: GestureDetector(
                  onTap: () => _showLineMenu(lineNum, theme),
                  child: Text(line['text'] as String, style: TextStyle(color: line['color'] as Color, fontSize: 12, fontFamily: 'monospace', height: 1.8)),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  void _showLineMenu(int lineNum, AppTheme theme) {
    showModalBottomSheet(
      context: context,
      backgroundColor: theme.surface,
      builder: (ctx) => Container(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('第 $lineNum 行', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: theme.textPrimary)),
            const SizedBox(height: 12),
            ListTile(leading: Icon(Icons.play_arrow, color: theme.success), title: Text('运行到此处', style: TextStyle(color: theme.textPrimary)), onTap: () {}),
            ListTile(leading: Icon(Icons.add, color: theme.info), title: Text('添加断点', style: TextStyle(color: theme.textPrimary)), onTap: () {}),
            ListTile(leading: Icon(Icons.bookmark, color: theme.warning), title: Text('添加书签', style: TextStyle(color: theme.textPrimary)), onTap: () {}),
          ],
        ),
      ),
    );
  }

  Widget _buildPreview(AppTheme theme) {
    final colors = [Colors.red, Colors.orange, Colors.yellow, Colors.green, Colors.blue, Colors.purple];
    return Container(
      color: theme.surface.withValues(alpha: 0.5),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                const SizedBox(width: 8),
                ...['预览', 'Agent', '控制台', '终端'].asMap().entries.map((e) => GestureDetector(
                  onTap: () => setState(() => _selectedTab = e.key),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: _selectedTab == e.key ? theme.background : Colors.transparent,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                    ),
                    child: Row(
                      children: [
                        if (e.key == 1) ...[
                          Icon(Icons.smart_toy, color: _selectedTab == e.key ? theme.gradientPrimary[0] : theme.textTertiary, size: 12),
                          const SizedBox(width: 4),
                        ],
                        Text(e.value, style: TextStyle(color: _selectedTab == e.key ? theme.textPrimary : theme.textTertiary, fontSize: 11)),
                      ],
                    ),
                  ),
                )),
                const Spacer(),
                if (_selectedTab == 0) ...[
                  Text('颜色:', style: TextStyle(color: theme.textTertiary, fontSize: 10)),
                  const SizedBox(width: 4),
                  ...colors.map((c) => GestureDetector(
                    onTap: () => setState(() => _markerColor = c),
                    child: Container(
                      width: 18, height: 18,
                      margin: const EdgeInsets.symmetric(horizontal: 1),
                      decoration: BoxDecoration(color: c, shape: BoxShape.circle, border: _markerColor == c ? Border.all(color: Colors.white, width: 2) : null),
                    ),
                  )),
                  IconButton(icon: Icon(Icons.delete_outline, color: theme.textTertiary, size: 16), onPressed: () => setState(() => _markers.clear())),
                ],
              ],
            ),
          ),
          Expanded(
            child: _selectedTab == 1
                ? _buildAgentPanel(theme)
                : _selectedTab == 0
                    ? _buildPreviewArea(theme)
                    : _buildConsoleArea(theme),
          ),
        ],
      ),
    );
  }

  Widget _buildAgentPanel(AppTheme theme) {
    return Container(
      color: theme.background,
      child: Column(
        children: [
          if (_selectedAgent != null)
            Container(
              padding: const EdgeInsets.all(8),
              color: theme.gradientPrimary[0].withValues(alpha: 0.2),
              child: Row(
                children: [
                  Icon(Icons.smart_toy, color: theme.gradientPrimary[0], size: 16),
                  const SizedBox(width: 8),
                  Text(_selectedAgent!, style: TextStyle(color: theme.textPrimary, fontSize: 12)),
                  const Spacer(),
                  Text('在线', style: TextStyle(color: theme.success, fontSize: 10)),
                ],
              ),
            ),
          Expanded(
            child: _agentMessages.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.smart_toy, color: theme.gradientPrimary[0], size: 48),
                        const SizedBox(height: 12),
                        Text('选择 Agent 开始编程助手', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
                        const SizedBox(height: 8),
                        Text('可以说：红点位置不好看改改', style: TextStyle(color: theme.textTertiary, fontSize: 11)),
                      ],
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(8),
                    itemCount: _agentMessages.length,
                    itemBuilder: (ctx, i) {
                      final msg = _agentMessages[i];
                      final isAgent = msg['role'] == 'agent';
                      return Align(
                        alignment: isAgent ? Alignment.centerLeft : Alignment.centerRight,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: isAgent ? theme.gradientPrimary[0].withValues(alpha: 0.3) : theme.info.withValues(alpha: 0.3),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(msg['text'] ?? '', style: TextStyle(color: theme.textPrimary, fontSize: 12)),
                        ),
                      );
                    },
                  ),
          ),
          Container(
            padding: const EdgeInsets.all(8),
            color: theme.surface.withValues(alpha: 0.5),
            child: Row(
              children: [
                IconButton(
                  icon: Icon(Icons.location_on, color: Colors.red, size: 18),
                  onPressed: _markers.isEmpty ? null : () {
                    _sendToAgent('请查看 $_markerColor 标记位置的代码');
                  },
                  tooltip: '发送标记给Agent',
                ),
                Expanded(
                  child: TextField(
                    controller: _agentInputController,
                    style: TextStyle(color: theme.textPrimary, fontSize: 12),
                    decoration: InputDecoration(
                      hintText: '输入问题或指令..',
                      hintStyle: TextStyle(color: theme.textTertiary, fontSize: 12),
                      filled: true,
                      fillColor: theme.background,
                      border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(8)), borderSide: BorderSide.none),
                      contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      isDense: true,
                    ),
                    onSubmitted: _sendToAgent,
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.send, color: theme.gradientPrimary[0], size: 18),
                  onPressed: () => _sendToAgent(_agentInputController.text),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _sendToAgent(String text) {
    if (text.isEmpty) return;
    setState(() {
      _agentMessages.add({'role': 'user', 'text': text});
      _agentInputController.clear();
    });
    Future.delayed(const Duration(milliseconds: 500), () {
      setState(() {
        _agentMessages.add({'role': 'agent', 'text': '收到！我来帮你分析这个问题。'});
      });
    });
  }

  Widget _buildPreviewArea(AppTheme theme) {
    return GestureDetector(
      onPanUpdate: (d) => setState(() => _markers.add(MarkerPoint(d.localPosition.dx, d.localPosition.dy, _markerColor))),
      onTapDown: (d) => setState(() => _markers.add(MarkerPoint(d.localPosition.dx, d.localPosition.dy, _markerColor))),
      child: Container(
        color: theme.background,
        child: Stack(
          children: [
            Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.phone_android, color: theme.success, size: 56), const SizedBox(height: 12), Text('移动端预览', style: TextStyle(color: theme.textSecondary, fontSize: 13))])),
            ..._markers.map((m) => Positioned(left: m.x - 8, top: m.y - 8, child: Container(width: 16, height: 16, decoration: BoxDecoration(color: m.color, shape: BoxShape.circle, boxShadow: [BoxShadow(color: m.color.withValues(alpha: 0.5), blurRadius: 8)])))),
          ],
        ),
      ),
    );
  }

  Widget _buildConsoleArea(AppTheme theme) {
    return Container(
      color: theme.background,
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('\$ flutter run', style: TextStyle(color: theme.success, fontFamily: 'monospace', fontSize: 12)),
          const SizedBox(height: 8),
          Text('Launching lib/main.dart on Chrome...', style: TextStyle(color: theme.textSecondary, fontFamily: 'monospace', fontSize: 11)),
          const SizedBox(height: 4),
          Text('✓Built build/web', style: TextStyle(color: theme.info, fontFamily: 'monospace', fontSize: 11)),
        ],
      ),
    );
  }

  Widget _buildBottomPanel(AppTheme theme) {
    return Container(
      height: 36,
      color: theme.surface.withValues(alpha: 0.5),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          Icon(Icons.terminal, color: theme.success, size: 14),
          const SizedBox(width: 8),
          Expanded(child: Text('> flutter run', style: TextStyle(color: theme.textSecondary, fontFamily: 'monospace', fontSize: 11))),
          SizedBox(
            width: 120,
            child: TextField(
              style: TextStyle(color: theme.textPrimary, fontSize: 11, fontFamily: 'monospace'),
              decoration: InputDecoration(
                hintText: '命令...',
                hintStyle: TextStyle(color: theme.textTertiary, fontSize: 11),
                filled: true,
                fillColor: theme.background,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(6), borderSide: BorderSide.none),
                contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                isDense: true,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
