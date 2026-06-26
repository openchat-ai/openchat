import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/experiments_client.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import 'dart:convert' as convert;

/// Agent 页面:用 /api/v1/agent/chat 跟 LLM tool-loop 通信
/// 支持角色(architect/engineer/judge)+ 窄工具集
class AgentPageScreen extends ConsumerStatefulWidget {
  const AgentPageScreen({super.key});
  @override
  ConsumerState<AgentPageScreen> createState() => _AgentPageScreenState();
}

class _ChatMsg {
  final String role; // 'user' | 'agent'
  final String text;
  _ChatMsg(this.role, this.text);
}

class _AgentPageScreenState extends ConsumerState<AgentPageScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  final List<_ChatMsg> _messages = [];
  bool _busy = false;
  String _role = 'engineer';
  bool _showSlash = false;

  static const _roles = ['engineer', 'architect', 'judge', 'reviewer'];

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  ExperimentsClient get _client =>
      ref.read(experimentsClientProvider);

  Future<void> _send() async {
    final text = _inputController.text.trim();
    if (text.isEmpty || _busy) return;
    setState(() {
      _messages.add(_ChatMsg('user', text));
      _inputController.clear();
      _busy = true;
    });
    _scrollToEnd();

    // slash 命令本地解析(避免 LLM 误解)
    if (text.startsWith('/')) {
      final reply = await _runLocalSlash(text);
      setState(() {
        _messages.add(_ChatMsg('agent', reply));
        _busy = false;
      });
      _scrollToEnd();
      return;
    }

    try {
      final reply = await _client.agentChat(text, chatId: 'agent-page', role: _role);
      setState(() => _messages.add(_ChatMsg('agent', reply.isEmpty ? '(empty reply)' : reply)));
    } catch (e) {
      setState(() => _messages.add(_ChatMsg('agent', '[error] $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
      _scrollToEnd();
    }
  }

  Future<String> _runLocalSlash(String text) async {
    final spaceIdx = text.indexOf(' ');
    final cmd = (spaceIdx == -1 ? text : text.substring(0, spaceIdx)).substring(1).toLowerCase();
    final arg = spaceIdx == -1 ? '' : text.substring(spaceIdx + 1).trim();
    try {
      switch (cmd) {
        case 'help':
          return 'slash: /help /status /experiments /projects /goal <desc> /dna <q> /run <id> [json] /role <name> /clear';
        case 'status':
          return await _client.status();
        case 'experiments': {
          final list = await _client.list();
          return '${list.length} experiments:\n' + list
              .where((e) => e.status != 'skeleton')
              .map((e) => '  ${e.id.padRight(10)} [${e.category.padRight(10)}] ${e.name}')
              .join('\n');
        }
        case 'projects':
          return await _client.projects();
        case 'goal': {
          if (arg.isEmpty) return 'usage: /goal <description>';
          final r = await _client.run('goal', inputs: {'description': arg, 'sessionId': 'agent-${Date.now().millisecondsSinceEpoch}'});
          return (r['outputs'] is Map ? r['outputs']['summary']?.toString() ?? r['outputs'].toString() : r.toString());
        }
        case 'dna': {
          if (arg.isEmpty) return 'usage: /dna <question>';
          final r = await _client.run('42', inputs: arg);
          return r['outputs']?.toString() ?? r.toString();
        }
        case 'run': {
          if (arg.isEmpty) return 'usage: /run <id> [json]';
          final m = RegExp(r'^(\S+)\s*([\s\S]*)$').firstMatch(arg);
          if (m == null) return 'usage: /run <id> [json]';
          final inputs = m.group(2)?.trim().isNotEmpty == true ? _tryParseJson(m.group(2)!) : <String, dynamic>{};
          final r = await _client.run(m.group(1)!, inputs: inputs);
          return r.toString();
        }
        case 'role':
          if (arg.isEmpty) return 'current role: $_role (available: ${_roles.join(", ")})';
          if (!_roles.contains(arg)) return 'unknown role: $arg';
          setState(() => _role = arg);
          return 'role set: $arg';
        case 'clear':
          setState(() => _messages.clear());
          return 'cleared';
        default:
          return 'unknown slash: /$cmd (try /help)';
      }
    } catch (e) {
      return '[error] $e';
    }
  }

  Map<String, dynamic> _tryParseJson(String s) {
    try {
      final v = convert.jsonDecode(s);
      return v is Map<String, dynamic> ? v : {'_': v};
    } catch (_) {
      return {'_raw': s};
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(_scrollController.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        title: Row(children: [
          const Text('Agent'),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(color: theme.primary.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(10)),
            child: Text(_role, style: TextStyle(color: theme.primary, fontSize: 11)),
          ),
        ]),
        backgroundColor: theme.surface,
        actions: [
          IconButton(
            icon: Icon(_showSlash ? Icons.code : Icons.code_off),
            tooltip: _showSlash ? 'hide slash' : 'show slash',
            onPressed: () => setState(() => _showSlash = !_showSlash),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(children: [
          if (_showSlash) _slashBar(theme),
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(12),
              itemCount: _messages.length,
              itemBuilder: (_, i) => _bubble(theme, _messages[i]),
            ),
          ),
          if (_busy) const LinearProgressIndicator(minHeight: 2),
          _inputBar(theme),
        ]),
      ),
    );
  }

  Widget _bubble(AppTheme theme, _ChatMsg m) {
    final isUser = m.role == 'user';
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.85),
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: isUser ? theme.primary.withValues(alpha: 0.85) : theme.surface.withValues(alpha: 0.7),
            borderRadius: BorderRadius.circular(12),
          ),
          child: SelectableText(
            m.text,
            style: TextStyle(color: isUser ? Colors.white : theme.textPrimary, fontSize: 13, height: 1.4),
          ),
        ),
      ),
    );
  }

  Widget _inputBar(AppTheme theme) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.1)))),
      child: Row(children: [
        Expanded(
          child: TextField(
            controller: _inputController,
            minLines: 1, maxLines: 4,
            decoration: InputDecoration(
              hintText: 'Ask agent (or /help for slash commands)',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
              filled: true,
              fillColor: theme.surface.withValues(alpha: 0.5),
              isDense: true,
            ),
            onSubmitted: (_) => _send(),
          ),
        ),
        const SizedBox(width: 8),
        IconButton(onPressed: _busy ? null : _send, icon: const Icon(Icons.send), color: theme.primary),
      ]),
    );
  }

  Widget _slashBar(AppTheme theme) {
    final cmds = const ['/help', '/status', '/experiments', '/projects', '/goal ', '/dna ', '/run ', '/role ', '/clear'];
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: cmds.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (_, i) => ActionChip(label: Text(cmds[i], style: const TextStyle(fontSize: 11)), onPressed: () {
          _inputController.text = cmds[i];
          _inputController.selection = TextSelection.collapsed(offset: _inputController.text.length);
        }),
      ),
    );
  }
}
