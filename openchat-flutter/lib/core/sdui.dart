/// Minimal Server-Driven UI engine
/// Parses JSON into Flutter widgets, fetched from Qiniu remote config.
/// Allows UI updates without rebuild.
import 'dart:convert';
import 'package:flutter/material.dart';

class SduiParser {
  final void Function(String action)? onAction;

  SduiParser({this.onAction});

  Widget? parse(dynamic node) {
    if (node is! Map || node['type'] == null) return null;
    switch (node['type']) {
      case 'column': return _column(node);
      case 'row': return _row(node);
      case 'list': return _list(node);
      case 'text': return _text(node);
      case 'button': return _button(node);
      case 'spacer': return const Spacer();
      default: return null;
    }
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
    final s = m['style'] as Map? ?? {};
    return Padding(
      padding: EdgeInsets.all((m['pad'] ?? 0).toDouble()),
      child: Text(m['content'] ?? '',
        style: TextStyle(
          color: s['color'] != null ? Color(int.parse(s['color'].toString().replaceAll('#', '0xFF'))) : null,
          fontSize: (s['size'] ?? 14).toDouble(),
          fontWeight: s['bold'] == true ? FontWeight.bold : FontWeight.normal,
        ),
        textAlign: m['center'] == true ? TextAlign.center : TextAlign.start,
      ),
    );
  }

  Widget _button(Map m) => Padding(
    padding: EdgeInsets.all((m['pad'] ?? 0).toDouble()),
    child: ElevatedButton(
      onPressed: m['action'] != null ? () => onAction?.call(m['action']) : null,
      child: Text(m['content'] ?? ''),
    ),
  );

  List<Widget> _children(dynamic list) {
    if (list is! List) return [];
    return list.map((c) => parse(c) ?? const SizedBox()).toList();
  }
}
