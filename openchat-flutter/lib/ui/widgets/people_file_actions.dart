import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../screens/main_screen.dart';
import 'people_dialogs.dart';

class PeopleFileActions {
  static void handle(BuildContext context, String action, QiniuDirectClient client) {
    final qIdx = action.indexOf('?');
    final params = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1)) : <String, String>{};
    if (action.startsWith('file:list?')) {
      client.listFiles(params['prefix'] ?? '').then((files) {
        if (!context.mounted) return;
        PeopleDialogs.showSdui(context,
          {'type': 'column', 'children': [
            {'type': 'text', 'content': 'Files: ${params['prefix'] ?? ""}', 'style': {'bold': true}, 'pad': 8},
            {'type': 'for_each', 'items': 'files', 'template': {'type': 'list_tile', 'title': '{{name}}'}}
          ]},
          {'files': files.map((f) => {'name': f.split('/').last}).toList()});
      });
    } else if (action.startsWith('file:delete?')) {
      final key = params['key'] ?? '';
      if (key.isEmpty) return;
      PeopleDialogs.showSdui(context,
        {'type': 'column', 'children': [
          {'type': 'text', 'content': 'Delete?', 'style': {'bold': true}, 'pad': 8},
          {'type': 'text', 'content': key, 'pad': 8}
        ]},
        {},
        actions: [
          {'action': 'cancel', 'label': 'Cancel'},
          {'action': 'del', 'label': 'Delete', 'color': '#F44336'}
        ],
        onAction: (a) {
          if (a == 'cancel') Navigator.of(context).pop();
          if (a == 'del') { client.deleteFile(key); Navigator.of(context).pop(); }
        });
    } else if (action.startsWith('file:get?')) {
      final qIdx = action.indexOf('?');
      final key = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1))['key'] ?? '' : '';
      if (key.isEmpty) return;
      client.getBinary(key).then((data) {
        if (!context.mounted) return;
        final content = String.fromCharCodes(data);
        PeopleDialogs.showSdui(context,
          {'type': 'column', 'children': [
            {'type': 'text', 'content': key.split('/').last, 'style': {'bold': true}, 'pad': 8},
            {'type': 'text', 'content': content, 'style': {'size': 10}}
          ]},
          {});
      });
    } else if (action.startsWith('file:write?')) {
      final qIdx = action.indexOf('?');
      if (qIdx < 0) return;
      final params = Uri.splitQueryString(action.substring(qIdx + 1));
      final key = params['key'] ?? '';
      final value = params['value'] ?? '';
      if (key.isEmpty || value.isEmpty) return;
      client.writeFile(key, value).then((ok) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(ok ? 'Written: $key' : 'Write failed: $key')));
      });
    } else if (action.startsWith('config:set?')) {
      _handleConfigSet(context, action);
    }
  }

  static Future<void> _handleConfigSet(BuildContext context, String action) async {
    final qIdx = action.indexOf('?');
    if (qIdx < 0) return;
    final params = Uri.splitQueryString(action.substring(qIdx + 1));
    final key = params['key'];
    final value = params['value'];
    if (key == null || value == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Config set: $key=$value')));
  }

  static Future<void> showConfig(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    final keys = ['peerId', 'bridge_url', 'theme_mode'].where((k) => prefs.containsKey(k));
    final items = keys.map((k) => '$k: ${prefs.get(k)}').join('\n');
    PeopleDialogs.showSdui(context,
      {'type': 'column', 'children': [
        {'type': 'text', 'content': items.isEmpty ? '(no config)' : items, 'style': {'size': 13}}
      ]},
      {});
  }

  static void restartApp(BuildContext context) {
    PeopleDialogs.showSdui(context,
      {'type': 'column', 'children': [
        {'type': 'text', 'content': 'Restart app for changes to take effect', 'pad': 8}
      ]},
      {},
      actions: [
        {'action': 'cancel', 'label': 'Cancel'},
        {'action': 'restart', 'label': 'Restart', 'color': '#7C4DFF'}
      ],
      onAction: (a) {
        if (a == 'cancel') Navigator.of(context).pop();
        if (a == 'restart') {
          Navigator.pop(context);
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
            (r) => false);
          Future.delayed(const Duration(milliseconds: 100), () => Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const MainScreen()),
            (r) => false));
        }
      });
  }
}
