import 'package:flutter/material.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui.dart';

class PeopleDialogs {
  static Future<void> showSdui(
    BuildContext context,
    Map layout,
    Map<String, dynamic> vars, {
    List<Map<String, String>>? actions,
    void Function(String)? onAction,
  }) {
    final parser = SduiParser(vars: vars, onAction: onAction);
    return showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        content: SizedBox(width: double.maxFinite, child: parser.parse(layout)),
        actions: actions?.map((a) => TextButton(
          onPressed: () => onAction?.call(a['action'] ?? ''),
          child: Text(a['label'] ?? '', style: a['color'] != null ? TextStyle(color: Color(int.parse(a['color']!.replaceAll('#', '0xFF')))) : null),
        )).toList() ?? [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  static Future<void> showRoomDialog(BuildContext context) async {
    final controller = TextEditingController(text: 'room_${DateTime.now().millisecondsSinceEpoch}');
    await showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('加入语音房间'),
      content: TextField(
        controller: controller,
        decoration: const InputDecoration(labelText: '房间 ID', hintText: '输入房间 ID 或使用默认'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
        TextButton(onPressed: () {
          Navigator.pop(ctx);
          Navigator.pushNamed(context, '/room', arguments: controller.text.trim());
        }, child: const Text('加入', style: TextStyle(color: Color(0xFF7C4DFF)))),
      ],
    ));
  }

  static Future<void> showAudioFiles(BuildContext context, QiniuDirectClient client, Map? uiConfig) async {
    final items = await client.listAudioFilesWithSize();
    if (!context.mounted) return;
    final layout = uiConfig?['audioFilesLayout'];
    final parser = SduiParser(vars: {
      'files': items.map((f) => {
        'name': (f['key'] as String? ?? '').split('/').last,
        'size': () {
          final s = f['size'] as int? ?? 0;
          return s >= 1024 ? '${(s / 1024).toStringAsFixed(1)}KB' : '${s}B';
        }(),
      }).toList(),
    }, onAction: null);
    final body = layout is Map
      ? parser.parse(layout)
      : parser.parse({
          'type': 'column', 'children': [
            {'type': 'for_each', 'items': '{{files}}', 'template': {
              'type': 'column', 'children': [
                {'type': 'divider'},
                {'type': 'row', 'children': [
                  {'type': 'text', 'content': '{{item.name}}', 'pad': 8},
                  {'type': 'spacer'},
                  {'type': 'text', 'content': '{{item.size}}', 'style': {'color': '#9E9E9E', 'size': 12}, 'pad': 8},
                ]},
              ],
            }},
          ],
        });
    if (!context.mounted) return;
    showDialog(context: context, builder: (ctx) => AlertDialog(
      content: SizedBox(width: double.maxFinite, child: body),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }

  static void showDeviceInfo(BuildContext context, QiniuDirectClient client) {
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Device Info'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Peer ID: ${client.peerId}'),
        const SizedBox(height: 8),
        Text('Poll: ${client.pollIntervalMs}ms'),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }
}
