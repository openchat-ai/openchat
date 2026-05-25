import 'dart:convert';
import 'package:flutter/material.dart';
import 'sdui_fragment.dart';

class SduiParser {
  final void Function(String action)? onAction;
  final Map<String, dynamic> _vars;

  SduiParser({this.onAction, Map<String, dynamic>? vars})
      : _vars = vars ?? {};

  static const icons = {
    'person': Icons.person,
    'person_outline': Icons.person_outline,
    'call': Icons.call,
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
    'arrow_back': Icons.arrow_back,
    'arrow_forward': Icons.arrow_forward,
    'more_vert': Icons.more_vert,
    'info': Icons.info,
    'warning': Icons.warning,
    'error': Icons.error,
    'smart_toy': Icons.smart_toy_outlined,
    'cloud_off': Icons.cloud_off,
    'mic': Icons.mic,
    'stop': Icons.stop,
    'play_arrow': Icons.play_arrow,
    'pause': Icons.pause,
    'send': Icons.send,
    'favorite': Icons.favorite,
    'share': Icons.share,
    'menu': Icons.menu,
  };

  Color? _parseColor(String? s) {
    if (s == null) return null;
    return Color(int.parse(s.replaceAll('#', '0xFF')));
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

  Widget? parse(dynamic node) {
    if (node is! Map || node['type'] == null) return null;
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
      case 'sdui_fragment':
        final path = node['path'] as String?;
        if (path != null) return SduiFragmentWidget(path: path, onAction: onAction);
        return const SizedBox();
      default: return null;
    }
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
    return Icon(d,
        color: _parseColor(m['color'] as String?),
        size: (m['size'] ?? 24).toDouble());
  }

  Widget _listTile(Map m) {
    return ListTile(
      leading: m['leadingIcon'] != null
          ? Icon(_icons[m['leadingIcon']] ?? Icons.person,
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
                  icon: Icon(_icons[m['trailingIcon']] ?? Icons.arrow_forward,
                      color: _parseColor(m['trailingIconColor'] as String?)),
                  onPressed: () => onAction?.call(m['trailingAction']),
                )
              : Icon(_icons[m['trailingIcon']] ?? Icons.arrow_forward,
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
    return Card(
      elevation: (m['elevation'] as num?)?.toDouble() ?? 1,
      margin: EdgeInsets.all((m['margin'] as num?)?.toDouble() ?? 4),
      child: Padding(
        padding: EdgeInsets.all((m['padding'] as num?)?.toDouble() ?? 12),
        child: parse(m['child']),
      ),
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

  Widget _button(Map m) => Padding(
    padding: EdgeInsets.all((m['pad'] ?? 0).toDouble()),
    child: ElevatedButton(
      onPressed: m['action'] != null ? () => onAction?.call(m['action']) : null,
      child: Text(_v(m['content'] ?? '')),
    ),
  );

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
