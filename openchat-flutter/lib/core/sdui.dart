import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'sdui_fragment.dart';

class SduiParser {
  final void Function(String action)? onAction;
  final Future<String?> Function(String key)? onReadFile;
  final Map<String, dynamic> _vars;

  SduiParser({this.onAction, this.onReadFile, Map<String, dynamic>? vars})
      : _vars = vars ?? {};

  static const icons = {
    'person': Icons.person,
    'person_outline': Icons.person_outline,
    'call': Icons.call,
    'call_end': Icons.call_end,
    'phone': Icons.phone,
    'refresh': Icons.refresh,
    'settings': Icons.settings,
    'home': Icons.home,
    'search': Icons.search,
    'add': Icons.add,
    'close': Icons.close,
    'delete': Icons.delete,
    'edit': Icons.edit,
    'check': Icons.check,
    'check_circle': Icons.check_circle,
    'arrow_back': Icons.arrow_back,
    'arrow_forward': Icons.arrow_forward,
    'more_vert': Icons.more_vert,
    'info': Icons.info,
    'warning': Icons.warning,
    'error': Icons.error,
    'smart_toy': Icons.smart_toy_outlined,
    'cloud_off': Icons.cloud_off,
    'mic': Icons.mic,
    'mic_off': Icons.mic_off,
    'stop': Icons.stop,
    'play_arrow': Icons.play_arrow,
    'pause': Icons.pause,
    'send': Icons.send,
    'favorite': Icons.favorite,
    'share': Icons.share,
    'menu': Icons.menu,
    'task_alt': Icons.task_alt,
    'add_task': Icons.add_task_rounded,
    'person_add': Icons.person_add_rounded,
    'code': Icons.code,
    'wifi': Icons.wifi,
    'circle': Icons.circle,
    'celebration': Icons.celebration_outlined,
    'nights_stay': Icons.nights_stay_outlined,
    'assignment': Icons.assignment_outlined,
    'connect_without_contact': Icons.connect_without_contact_rounded,
    'handshake': Icons.handshake_outlined,
    'auto_awesome': Icons.auto_awesome_outlined,
    'language': Icons.language_outlined,
    'notifications': Icons.notifications_outlined,
    'security': Icons.security_outlined,
    'storage': Icons.storage_outlined,
    'help': Icons.help_outline,
    'inbox': Icons.inbox_outlined,
    'palette': Icons.palette,
    'brightness_auto': Icons.brightness_auto,
    'brightness_5': Icons.brightness_5,
    'brightness_2': Icons.brightness_2,
    'play_circle': Icons.play_circle_outline,
    'pending': Icons.pending_outlined,
    'folder': Icons.folder,
    'add_circle': Icons.add_circle_outline,
    'emoji_emotions': Icons.emoji_emotions_outlined,
    'phone_outlined': Icons.phone_outlined,
    'videocam': Icons.videocam_outlined,
    'send_outlined': Icons.send_outlined,
    'share_outlined': Icons.share_outlined,
    'psychology': Icons.psychology_outlined,
    'chat_bubble': Icons.chat_bubble_outline,
    'family_restroom': Icons.family_restroom_rounded,
    'arrow_back_ios': Icons.arrow_back_ios,
    'qr_code': Icons.qr_code,
    'celebration_outlined': Icons.celebration_outlined,
  };

  Color? _parseColor(String? s) {
    if (s == null) return null;
    return Color(int.parse(s.replaceAll('#', '0xFF')));
  }

  LinearGradient? _parseGradient(dynamic g) {
    if (g is! List || g.isEmpty) return null;
    final colors = g.map((c) {
      if (c is String) return _parseColor(c) ?? Colors.grey;
      return Colors.grey;
    }).whereType<Color>().toList();
    if (colors.isEmpty) return null;
    return LinearGradient(colors: colors, begin: Alignment.topLeft, end: Alignment.bottomRight);
  }

  BoxDecoration? _parseDecoration(Map m) {
    final gradient = _parseGradient(m['gradient']);
    final bgColor = _parseColor(m['bgColor'] as String?);
    final borderColor = _parseColor(m['borderColor'] as String?);
    final radius = (m['radius'] as num?)?.toDouble();
    if (gradient == null && bgColor == null && borderColor == null && radius == null) return null;
    return BoxDecoration(
      gradient: gradient,
      color: bgColor,
      borderRadius: radius != null ? BorderRadius.circular(radius) : null,
      border: borderColor != null ? Border.all(color: borderColor, width: (m['borderWidth'] as num?)?.toDouble() ?? 1) : null,
    );
  }

  TextStyle? _parseStyle(dynamic s) {
    if (s is! Map) return null;
    return TextStyle(
      color: _parseColor(s['color'] as String?),
      fontSize: (s['size'] ?? 14).toDouble(),
      fontWeight: s['bold'] == true ? FontWeight.bold : FontWeight.normal,
    );
  }

  String _v(String? text) {
    if (text == null) return '';
    return text.replaceAllMapped(RegExp(r'\{\{(\w+)\}\}'), (m) {
      return _vars[m[1]!]?.toString() ?? m[0]!;
    });
  }

  bool _eval(String condition) {
    final m = RegExp(r'^(\w+)\s*(>=|<=|!=|==|>|<)\s*(\S+)$').firstMatch(condition.trim());
    if (m == null) return true;
    final v = _vars[m[1]!];
    if (v == null) return false;
    final op = m[2]!;
    final r = m[3]!;
    if (op == '==' || op == '!=') {
      final eq = v.toString() == r;
      return op == '==' ? eq : !eq;
    }
    final a = (v is num ? v : double.tryParse(v.toString())) ?? 0.0;
    final b = double.tryParse(r) ?? 0.0;
    switch (op) {
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
    }
    return true;
  }

  Widget? parse(dynamic node) {
    if (node is! Map || node['type'] == null) return null;
    if (node['if'] != null && !_eval(node['if'] as String)) return const SizedBox();
    switch (node['type']) {
      case 'column': return _column(node);
      case 'row': return _row(node);
      case 'list': return _list(node);
      case 'text': return _text(node);
      case 'button': return _button(node);
      case 'spacer': return const Spacer();
      case 'icon': return _icon(node);
      case 'list_tile': return _listTile(node);
      case 'padding': return _padding(node);
      case 'divider': return const Divider();
      case 'image': return _image(node);
      case 'card': return _card(node);
      case 'auto': return _auto(node);
      case 'checkbox': return _checkbox(node);
      case 'switch': return _switch(node);
      case 'textfield': return _textfield(node);
      case 'sdui_fragment':
        final path = node['path'] as String?;
        if (path != null) return SduiFragmentWidget(path: path, onAction: onAction);
        return const SizedBox();
      case 's3_data': return _s3Data(node);
      case 'for_each': return _forEachNode(node, _vars, onAction);
      default: return null;
    }
  }

  Widget _auto(Map m) {
    final delay = (m['delay'] as num?)?.toInt() ?? 0;
    final action = m['action'] as String?;
    if (action != null) {
      Future.delayed(Duration(milliseconds: delay), () => onAction?.call(action));
    }
    return const SizedBox();
  }

  Widget _s3Data(Map m) {
    final s3Key = m['key'] as String?;
    final template = m['template'] as Map?;
    if (s3Key == null || template == null || onReadFile == null) return const SizedBox();
    return _S3DataWidget(s3Key: s3Key, template: template, parser: this);
  }

  Widget _checkbox(Map m) {
    return CheckboxListTile(
      value: m['checked'] == true,
      title: Text(_v(m['label'] as String? ?? '')),
      onChanged: m['action'] != null ? (_) => onAction?.call(m['action']) : null,
    );
  }

  Widget _switch(Map m) {
    return SwitchListTile(
      value: m['active'] == true,
      title: Text(_v(m['label'] as String? ?? '')),
      onChanged: m['action'] != null ? (_) => onAction?.call(m['action']) : null,
    );
  }

  Widget _textfield(Map m) {
    final ctrl = TextEditingController(text: _v(m['value'] as String?));
    return Padding(
      padding: EdgeInsets.all((m['pad'] ?? 8).toDouble()),
      child: TextField(
        controller: ctrl,
        decoration: InputDecoration(
          hintText: _v(m['hint'] as String?),
          border: const OutlineInputBorder(),
        ),
        onSubmitted: m['action'] != null ? (_) => onAction?.call(m['action']) : null,
      ),
    );
  }

  Widget _padding(Map m) {
    final p = m['padding'];
    EdgeInsetsGeometry edge;
    if (p is num) {
      edge = EdgeInsets.all(p.toDouble());
    } else if (p is Map) {
      edge = EdgeInsets.only(
        left: ((p['l'] ?? p['left']) ?? 0).toDouble(),
        top: ((p['t'] ?? p['top']) ?? 0).toDouble(),
        right: ((p['r'] ?? p['right']) ?? 0).toDouble(),
        bottom: ((p['b'] ?? p['bottom']) ?? 0).toDouble(),
      );
    } else {
      edge = EdgeInsets.zero;
    }
    return Padding(padding: edge, child: parse(m['child']));
  }

  Widget _icon(Map m) {
    final d = icons[m['icon'] as String?] ?? Icons.info;
    final deco = _parseDecoration(m);
    final icon = Icon(d, color: _parseColor(m['color'] as String?), size: (m['size'] ?? 24).toDouble());
    if (deco != null) {
      final pad = (m['pad'] as num?)?.toDouble() ?? 8;
      return Container(
        width: (m['containerSize'] as num?)?.toDouble(),
        height: (m['containerSize'] as num?)?.toDouble(),
        padding: EdgeInsets.all(pad),
        decoration: deco,
        child: Center(child: icon),
      );
    }
    return icon;
  }

  Widget _listTile(Map m) {
    return ListTile(
      leading: m['leadingIcon'] != null
          ? Icon(icons[m['leadingIcon']] ?? Icons.person,
              color: _parseColor(m['leadingIconColor'] as String?))
          : null,
      title: m['title'] != null
          ? Text(_v(m['title']), style: _parseStyle(m['titleStyle']))
          : null,
      subtitle: m['subtitle'] != null
          ? Text(_v(m['subtitle']), style: _parseStyle(m['subtitleStyle']))
          : null,
      trailing: m['trailingIcon'] != null
          ? (m['trailingAction'] != null
              ? IconButton(
                  icon: Icon(icons[m['trailingIcon']] ?? Icons.arrow_forward,
                      color: _parseColor(m['trailingIconColor'] as String?)),
                  onPressed: () => onAction?.call(m['trailingAction']),
                )
              : Icon(icons[m['trailingIcon']] ?? Icons.arrow_forward,
                  color: _parseColor(m['trailingIconColor'] as String?)))
          : null,
      onTap: m['action'] != null ? () => onAction?.call(m['action']) : null,
    );
  }

  Widget _image(Map m) {
    final url = m['url'] as String?;
    if (url == null) return const SizedBox();
    return Image.network(
      _v(url),
      width: (m['width'] as num?)?.toDouble(),
      height: (m['height'] as num?)?.toDouble(),
      fit: m['fit'] != null ? _parseFit(m['fit'] as String) : null,
      errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, size: 48),
    );
  }

  BoxFit? _parseFit(String s) {
    switch (s) {
      case 'cover': return BoxFit.cover;
      case 'contain': return BoxFit.contain;
      case 'fill': return BoxFit.fill;
      case 'fitWidth': return BoxFit.fitWidth;
      case 'fitHeight': return BoxFit.fitHeight;
      default: return BoxFit.contain;
    }
  }

  Widget _card(Map m) {
    final deco = _parseDecoration(m);
    final child = Padding(
      padding: EdgeInsets.all((m['padding'] as num?)?.toDouble() ?? 12),
      child: parse(m['child']),
    );
    if (deco != null) {
      return Container(
        margin: EdgeInsets.all((m['margin'] as num?)?.toDouble() ?? 4),
        decoration: deco,
        child: child,
      );
    }
    return Card(
      elevation: (m['elevation'] as num?)?.toDouble() ?? 1,
      margin: EdgeInsets.all((m['margin'] as num?)?.toDouble() ?? 4),
      child: child,
    );
  }

  Widget _column(Map m) => Column(
    crossAxisAlignment: m['center'] == true ? CrossAxisAlignment.center : CrossAxisAlignment.start,
    children: _children(m['children']),
  );

  Widget _row(Map m) => Row(
    mainAxisAlignment: m['center'] == true ? MainAxisAlignment.center : MainAxisAlignment.start,
    children: _children(m['children']),
  );

  Widget _list(Map m) => ListView.builder(
    itemCount: (m['children'] as List?)?.length ?? 0,
    itemBuilder: (_, i) => parse((m['children'] as List)[i]) ?? const SizedBox(),
  );

  Widget _text(Map m) {
    return Padding(
      padding: EdgeInsets.all((m['pad'] ?? 0).toDouble()),
      child: Text(_v(m['content']),
        style: _parseStyle(m['style']),
        textAlign: m['center'] == true ? TextAlign.center : TextAlign.start,
      ),
    );
  }

  Widget _button(Map m) {
    final bgColor = _parseColor(m['color'] as String?);
    final fgColor = _parseColor(m['textColor'] as String?);
    final btnSize = (m['size'] as num?)?.toDouble();
    final hasIcon = m['icon'] != null;
    return Padding(
      padding: EdgeInsets.all((m['pad'] ?? 4).toDouble()),
      child: ElevatedButton(
        onPressed: m['action'] != null ? () => onAction?.call(m['action']) : null,
        style: ButtonStyle(
          backgroundColor: bgColor != null ? WidgetStatePropertyAll(bgColor) : null,
          foregroundColor: fgColor != null ? WidgetStatePropertyAll(fgColor) : null,
          fixedSize: btnSize != null ? WidgetStatePropertyAll(Size(btnSize, btnSize)) : null,
          shape: btnSize != null
              ? WidgetStatePropertyAll(RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(btnSize / 2)))
              : null,
        ),
        child: hasIcon
            ? Icon(icons[m['icon']], size: (m['iconSize'] ?? 24).toDouble())
            : Text(_v(m['content'] ?? '')),
      ),
    );
  }

  List<Widget> _children(dynamic list) {
    if (list is! List) return [];
    return list.map((c) {
      final w = parse(c) ?? const SizedBox();
      if (c is Map && c['flex'] != null) {
        return Expanded(flex: (c['flex'] as num).toInt(), child: w);
      }
      return w;
    }).toList();
  }
}

class _S3DataWidget extends StatefulWidget {
  final String s3Key;
  final Map template;
  final SduiParser parser;
  const _S3DataWidget({required this.s3Key, required this.template, required this.parser, super.key});

  @override
  State<_S3DataWidget> createState() => _S3DataWidgetState();
}

class _S3DataWidgetState extends State<_S3DataWidget> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final raw = await widget.parser.onReadFile?.call(widget.s3Key);
    if (raw == null) { if (mounted) setState(() => _error = 'Failed to load'); return; }
    try {
      final parsed = jsonDecode(raw);
      if (parsed is Map) { if (mounted) setState(() => _data = Map<String, dynamic>.from(parsed)); }
    } catch (_) { if (mounted) setState(() => _error = 'Invalid JSON'); }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 12));
    if (_data == null) return const SizedBox(height: 1);
    final sub = SduiParser(
      onAction: widget.parser.onAction,
      vars: _data!,
    );
    return sub.parse(widget.template) ?? const SizedBox();
  }
}

Widget _forEachNode(Map m, Map<String, dynamic> vars, void Function(String)? onAction) {
  final key = m['items'] as String?;
  final template = m['template'] as Map?;
  if (key == null || template == null) return const SizedBox();
  final items = vars[key];
  if (items is! List) return const SizedBox();
  return Column(
    children: items.map((item) {
      if (item is! Map) return const SizedBox();
      final sub = SduiParser(onAction: onAction, vars: Map<String, dynamic>.from(item));
      return sub.parse(template) ?? const SizedBox();
    }).toList(),
  );
}
