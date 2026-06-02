import 'dart:convert';
import 'dart:developer' show log;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'sdui.dart';

class SduiActions {
  static void handle(BuildContext context, String action,
      {VoidCallback? onRefresh, VoidCallback? onDemo, Map<String, VoidCallback>? custom}) {
    log('[C19] sdui action=$action');
    if (action == 'refresh') { onRefresh?.call(); return; }
    if (action == 'demo') { onDemo?.call(); return; }
    if (action.startsWith('navigate:')) {
      final path = action.substring(9);
      final parts = path.split('?');
      final route = parts[0];
      Map<String, dynamic>? args;
      if (parts.length > 1) {
        args = {};
        for (final param in parts[1].split('&')) {
          final kv = param.split('=');
          if (kv.length == 2) args[kv[0]] = Uri.decodeComponent(kv[1]);
        }
      }
      Navigator.pushNamed(context, route, arguments: args);
    }
    if (action.startsWith('snackbar:')) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(action.substring(9))));
      return;
    }
    if (action.startsWith('sdui_dialog:')) {
      final encoded = action.substring(12);
      try {
        final layout = jsonDecode(utf8.decode(base64Decode(encoded)));
        if (layout is Map) {
          showDialog(context: context, builder: (ctx) => AlertDialog(
            content: SizedBox(width: double.maxFinite, child: SduiParser(onAction: (a) {
              Navigator.pop(ctx);
            }).parse(layout)),
          ));
        }
      } catch (_) {}
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
    if (action.startsWith('haptic:')) { return; }
    if (action.startsWith('tel:') || action.startsWith('mailto:')) {
      Clipboard.setData(ClipboardData(text: action.substring(4)));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Copied: ${action.substring(4)}')));
      return;
    }
    if (action.startsWith('http://') || action.startsWith('https://')) {
      Clipboard.setData(ClipboardData(text: action));
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied')));
      return;
    }
    if (custom?[action] != null) { custom![action]!(); return; }
  }
}
