import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';

class BridgeUrlTile extends ConsumerStatefulWidget {
  final AppTheme theme;
  const BridgeUrlTile({super.key, required this.theme});

  @override
  ConsumerState<BridgeUrlTile> createState() => _BridgeUrlTileState();
}

class _BridgeUrlTileState extends ConsumerState<BridgeUrlTile> {
  late TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(configProvider).baseUrl);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(configProvider);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Bridge 地址', style: TextStyle(color: widget.theme.textSecondary, fontSize: 13)),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: TextField(
            controller: _controller,
            style: TextStyle(color: widget.theme.textPrimary),
            decoration: InputDecoration(
              hintText: 'http://192.168.1.100:3800',
              hintStyle: TextStyle(color: widget.theme.textTertiary),
              filled: true, fillColor: widget.theme.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: widget.theme.textTertiary.withValues(alpha: 0.2))),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
          )),
          const SizedBox(width: 8),
          TextButton(onPressed: () {
            ref.read(configProvider.notifier).setBaseUrl(_controller.text);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Address updated'), duration: Duration(seconds: 2)));
          }, child: const Text('Save')),
        ]),
        const SizedBox(height: 4),
        Text('Current: ${config.baseUrl}', style: TextStyle(color: widget.theme.textTertiary, fontSize: 11)),
      ]),
    );
  }
}
