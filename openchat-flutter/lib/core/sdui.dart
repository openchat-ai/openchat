import 'dart:convert';
import 'package:flutter/material.dart';

class SduiParser {
  final void Function(String action)? onAction;
  final Map<String, dynamic> _vars;

  SduiParser({this.onAction, Map<String, dynamic>? vars})
      : _vars = vars ?? {};

  static const _icons = {
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
    final d = _icons[m['icon'] as String?] ?? Icons.info;
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
    return list.map((c) => parse(c) ?? const SizedBox()).toList();
  }
}
