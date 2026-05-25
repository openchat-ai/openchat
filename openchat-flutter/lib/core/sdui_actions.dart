import 'package:flutter/material.dart';

class SduiActions {
  static void handle(BuildContext context, String action,
      {VoidCallback? onRefresh, VoidCallback? onDemo, Map<String, VoidCallback>? custom}) {
    if (action == 'refresh') { onRefresh?.call(); return; }
    if (action == 'demo') { onDemo?.call(); return; }
    if (action.startsWith('navigate:')) {
      Navigator.pushNamed(context, action.substring(9));
      return;
    }
    if (action.startsWith('snackbar:')) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(action.substring(9))));
      return;
    }
    if (action.startsWith('dialog:')) {
      final parts = action.substring(7).split('|');
      showDialog(context: context, builder: (_) => AlertDialog(
        title: Text(parts[0]),
        content: parts.length > 1 ? Text(parts[1]) : null,
        actions: [TextButton(onPressed: () => Navigator.pop(_), child: const Text('OK'))],
      ));
      return;
    }
    if (action.startsWith('haptic:')) {
      // Haptic feedback - just a no-op placeholder; platform channels needed for full support
      return;
    }
    if (custom?[action] != null) { custom![action]!(); return; }
  }
}
