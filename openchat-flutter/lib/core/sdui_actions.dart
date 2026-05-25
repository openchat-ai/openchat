import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class SduiActions {
  static void handle(BuildContext context, String action,
      {VoidCallback? onRefresh, VoidCallback? onDemo, Map<String, VoidCallback>? custom}) {
    if (action == 'refresh') { onRefresh?.call(); return; }
    if (action == 'demo') { onDemo?.call(); return; }
    if (action.startsWith('navigate:')) {
      final rest = action.substring(9);
      final uri = Uri.tryParse(rest);
      final route = uri?.path ?? rest;
      if (uri != null && uri.hasQuery) {
        Navigator.pushNamed(context, route, arguments: uri.queryParameters);
      } else {
        Navigator.pushNamed(context, route);
      }
      return;
    }
    if (action.startsWith('snackbar:')) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(action.substring(9))));
      return;
    }
    if (action.startsWith('dialog:')) {
      final parts = action.substring(7).split('|');
      showDialog(context: context, builder: (ctx) => AlertDialog(
        title: Text(parts[0]),
        content: parts.length > 1 ? Text(parts[1]) : null,
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ));
      return;
    }
    if (action.startsWith('haptic:')) {
      return;
    }
    if (action.startsWith('tel:') || action.startsWith('mailto:')) {
      Clipboard.setData(ClipboardData(text: action.substring(4)));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已复制: ${action.substring(4)}')));
      return;
    }
    if (action.startsWith('http://') || action.startsWith('https://')) {
      Clipboard.setData(ClipboardData(text: action));
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('链接已复制到剪贴板')));
      return;
    }
    if (custom?[action] != null) { custom![action]!(); return; }
  }
}
