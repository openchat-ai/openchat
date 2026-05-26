import 'package:flutter/material.dart';

class SduiParser {
  final void Function(String action)? onAction;
  final Map<String, dynamic> _vars;

  SduiParser({this.onAction, Map<String, dynamic>? vars}) : _vars = vars ?? {};

  // ─── Icon registry ─────────────────────────────────────

  static final Map<String, IconData> icons = <String, IconData>{
    'person': Icons.person, 'person_outline': Icons.person_outline,
    'call': Icons.call, 'call_end': Icons.call_end, 'phone': Icons.phone,
    'refresh': Icons.refresh, 'settings': Icons.settings, 'home': Icons.home,
    'search': Icons.search, 'add': Icons.add, 'close': Icons.close,
    'delete': Icons.delete, 'edit': Icons.edit, 'check': Icons.check,
    'check_circle': Icons.check_circle, 'arrow_back': Icons.arrow_back,
    'arrow_forward': Icons.arrow_forward, 'more_vert': Icons.more_vert,
    'info': Icons.info, 'warning': Icons.warning, 'error': Icons.error,
    'mic': Icons.mic, 'mic_off': Icons.mic_off, 'stop': Icons.stop,
    'play_arrow': Icons.play_arrow, 'pause': Icons.pause, 'send': Icons.send,
    'favorite': Icons.favorite, 'share': Icons.share, 'menu': Icons.menu,
    'code': Icons.code, 'circle': Icons.circle, 'folder': Icons.folder,
    'inbox': Icons.inbox_outlined, 'palette': Icons.palette,
    'help': Icons.help_outline, 'search_outlined': Icons.search,
    'close_outlined': Icons.close,
  };

  /// Register custom icons at startup.
  static void registerIcons(Map<String, IconData> extra) {
    icons.addAll(extra);
  }

  // ─── Core parse ────────────────────────────────────────

  Widget? parse(dynamic node) {
    if (node is! Map || node['type'] == null) return null;
    if (node['if'] != null && !_eval(node['if'] as String)) return const SizedBox();
    return (switch (node['type']) {
      'column' => Column(crossAxisAlignment: node['center'] == true ? CrossAxisAlignment.center : CrossAxisAlignment.start, children: _children(node['children'])),
      'row' => Row(mainAxisAlignment: node['center'] == true ? MainAxisAlignment.center : MainAxisAlignment.start, children: _children(node['children'])),
      'list' => ListView.builder(itemCount: (node['children'] as List?)?.length ?? 0, itemBuilder: (_, i) => parse((node['children'] as List)[i]) ?? const SizedBox()),
      'text' => Padding(padding: EdgeInsets.all(_n(node, 'pad')), child: Text(_v(node['content']), style: _style(node['style']), textAlign: node['center'] == true ? TextAlign.center : TextAlign.start)),
      'spacer' => const Spacer(),
      'divider' => const Divider(),
      'icon' => _icon(node),
      'button' => _button(node),
      'card' => _card(node),
      'padding' => Padding(padding: _edge(node['padding']), child: parse(node['child'])),
      'auto' => _auto(node),
      'image' => _image(node),
      'list_tile' => _listTile(node),
      'checkbox' => CheckboxListTile(value: node['checked'] == true, title: Text(_v(node['label'] as String? ?? '')), onChanged: node['action'] != null ? (_) => onAction?.call(node['action']) : null),
      'switch' => SwitchListTile(value: node['active'] == true, title: Text(_v(node['label'] as String? ?? '')), onChanged: node['action'] != null ? (_) => onAction?.call(node['action']) : null),
      'textfield' => Padding(padding: EdgeInsets.all(_n(node, 'pad', 8)), child: TextField(controller: TextEditingController(text: _v(node['value'] as String?)), decoration: InputDecoration(hintText: _v(node['hint'] as String?), border: const OutlineInputBorder()), onSubmitted: node['action'] != null ? (_) => onAction?.call(node['action']) : null)),
      'for_each' => _forEach(node),
      _ => null,
    });
  }

  // ─── Helpers ───────────────────────────────────────────

  Color? _c(String? s) => s == null ? null : Color(int.parse(s.replaceAll('#', '0xFF')));
  double _n(Map m, String k, [double d = 0]) => (m[k] as num?)?.toDouble() ?? d;
  int _i(Map m, String k, [int d = 0]) => (m[k] as num?)?.toInt() ?? d;
  String _v(String? s) => s == null ? '' : s.replaceAllMapped(RegExp(r'\{\{(\w+)\}\}'), (m) => _vars[m[1]!]?.toString() ?? m[0]!);

  bool _eval(String c) {
    final m = RegExp(r'^(\w+)\s*(>=|<=|!=|==|>|<)\s*(\S+)$').firstMatch(c.trim());
    if (m == null) return true;
    final v = _vars[m[1]!]; if (v == null) return false;
    if (m[2]! == '==' || m[2]! == '!=') return (v.toString() == m[3]!) == (m[2]! == '==');
    final a = (v is num ? v : double.tryParse(v.toString())) ?? 0.0;
    final b = double.tryParse(m[3]!) ?? 0.0;
    return switch (m[2]!) { '>' => a > b, '<' => a < b, '>=' => a >= b, '<=' => a <= b, _ => true };
  }

  BoxDecoration? _deco(Map m) {
    final g = m['gradient']; final bg = _c(m['bgColor'] as String?);
    final bc = _c(m['borderColor'] as String?); final r = _n(m, 'radius');
    LinearGradient? lg;
    if (g is List && g.isNotEmpty) {
      final cs = g.map((c) => c is String ? (_c(c) ?? Colors.grey) : Colors.grey).whereType<Color>().toList();
      if (cs.isNotEmpty) lg = LinearGradient(colors: cs, begin: Alignment.topLeft, end: Alignment.bottomRight);
    }
    if (lg == null && bg == null && bc == null && r == 0) return null;
    return BoxDecoration(gradient: lg, color: bg, borderRadius: r > 0 ? BorderRadius.circular(r) : null,
      border: bc != null ? Border.all(color: bc, width: _n(m, 'borderWidth', 1)) : null);
  }

  TextStyle? _style(dynamic s) => s is Map ? TextStyle(color: _c(s['color'] as String?), fontSize: _n(s, 'size', 14), fontWeight: s['bold'] == true ? FontWeight.bold : FontWeight.normal) : null;

  EdgeInsetsGeometry _edge(dynamic p) {
    if (p is num) return EdgeInsets.all(p.toDouble());
    if (p is Map) return EdgeInsets.only(left: _n(p, 'l', _n(p, 'left')), top: _n(p, 't', _n(p, 'top')), right: _n(p, 'r', _n(p, 'right')), bottom: _n(p, 'b', _n(p, 'bottom')));
    return EdgeInsets.zero;
  }

  List<Widget> _children(dynamic list) {
    if (list is! List) return [];
    return list.map((c) {
      final w = parse(c) ?? const SizedBox();
      return c is Map && c['flex'] != null ? Expanded(flex: (c['flex'] as num).toInt(), child: w) : w;
    }).toList();
  }

  // ─── Widget builders ───────────────────────────────────

  Widget _icon(Map m) {
    final icon = Icon(icons[m['icon'] as String?] ?? Icons.info, color: _c(m['color'] as String?), size: _n(m, 'size', 24));
    final deco = _deco(m);
    if (deco == null) return icon;
    return Container(width: _n(m, 'containerSize'), height: _n(m, 'containerSize'), padding: EdgeInsets.all(_n(m, 'pad', 8)), decoration: deco, child: Center(child: icon));
  }

  Widget _button(Map m) {
    final icon = m['icon'] != null ? Icon(icons[m['icon']], size: _n(m, 'iconSize', 24)) : null;
    final text = Text(_v(m['content'] ?? ''));
    final bg = _c(m['color'] as String?); final fg = _c(m['textColor'] as String?);
    final sz = _n(m, 'size'); final deco = _deco(m);
    final onTap = m['action'] != null ? () => onAction?.call(m['action']) : null;
    final child = icon ?? text as Widget;
    if (deco != null) return Padding(padding: EdgeInsets.all(_n(m, 'pad', 4)), child: GestureDetector(onTap: onTap, child: Container(width: sz > 0 ? sz : null, height: sz > 0 ? sz : null, decoration: deco, child: Center(child: child))));
    return Padding(padding: EdgeInsets.all(_n(m, 'pad', 4)), child: ElevatedButton(onPressed: onTap, style: ButtonStyle(backgroundColor: bg != null ? WidgetStatePropertyAll(bg) : null, foregroundColor: fg != null ? WidgetStatePropertyAll(fg) : null, fixedSize: sz > 0 ? WidgetStatePropertyAll(Size(sz, sz)) : null, shape: sz > 0 ? WidgetStatePropertyAll(RoundedRectangleBorder(borderRadius: BorderRadius.circular(sz / 2))) : null), child: child));
  }

  Widget _card(Map m) {
    final child = Padding(padding: EdgeInsets.all(_n(m, 'padding', 12)), child: parse(m['child']));
    final deco = _deco(m);
    if (deco != null) return Container(margin: EdgeInsets.all(_n(m, 'margin', 4)), decoration: deco, child: child);
    return Card(elevation: _n(m, 'elevation', 1), margin: EdgeInsets.all(_n(m, 'margin', 4)), child: child);
  }

  Widget _auto(Map m) {
    final delay = _i(m, 'delay'); final action = m['action'] as String?;
    final unmount = m['onUnmount'] as String?;
    if (action != null && delay > 0) Future.delayed(Duration(milliseconds: delay), () => onAction?.call(action));
    if (unmount != null) return _LifecycleWidget(child: const SizedBox(), onDispose: () => onAction?.call(unmount));
    return const SizedBox();
  }

  Widget _image(Map m) {
    final url = m['url'] as String?;
    if (url == null) return const SizedBox();
    return Image.network(_v(url), width: _n(m, 'width'), height: _n(m, 'height'),
      fit: m['fit'] is String ? switch (m['fit']) { 'cover' => BoxFit.cover, 'contain' => BoxFit.contain, 'fill' => BoxFit.fill, 'fitWidth' => BoxFit.fitWidth, 'fitHeight' => BoxFit.fitHeight, _ => BoxFit.contain } : null,
      errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, size: 48));
  }

  Widget _listTile(Map m) {
    return ListTile(
      leading: m['leadingIcon'] != null ? Icon(icons[m['leadingIcon']] ?? Icons.person, color: _c(m['leadingIconColor'] as String?)) : null,
      title: m['title'] != null ? Text(_v(m['title']), style: _style(m['titleStyle'])) : null,
      subtitle: m['subtitle'] != null ? Text(_v(m['subtitle']), style: _style(m['subtitleStyle'])) : null,
      trailing: m['trailingIcon'] != null ? (m['trailingAction'] != null ? IconButton(icon: Icon(icons[m['trailingIcon']] ?? Icons.arrow_forward, color: _c(m['trailingIconColor'] as String?)), onPressed: () => onAction?.call(m['trailingAction'])) : Icon(icons[m['trailingIcon']] ?? Icons.arrow_forward, color: _c(m['trailingIconColor'] as String?))) : null,
      onTap: m['action'] != null ? () => onAction?.call(m['action']) : null,
    );
  }

  Widget _forEach(Map m) {
    final key = m['items'] as String?; final tpl = m['template'] as Map?;
    if (key == null || tpl == null) return const SizedBox();
    final items = _vars[key];
    if (items is! List) return const SizedBox();
    return Column(children: items.map((item) {
      if (item is! Map) return const SizedBox();
      return SduiParser(onAction: onAction, vars: Map<String, dynamic>.from(item)).parse(tpl) ?? const SizedBox();
    }).toList());
  }
}

class _LifecycleWidget extends StatefulWidget {
  final Widget child; final VoidCallback? onDispose;
  const _LifecycleWidget({required this.child, this.onDispose});
  @override State<_LifecycleWidget> createState() => _LifecycleWidgetState();
}

class _LifecycleWidgetState extends State<_LifecycleWidget> {
  @override void dispose() { widget.onDispose?.call(); super.dispose(); }
  @override Widget build(BuildContext context) => widget.child;
}
