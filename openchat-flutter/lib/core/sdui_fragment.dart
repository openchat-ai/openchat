import 'package:flutter/material.dart';
import 'api/qiniu_direct_client.dart';
import 'sdui.dart';

class SduiFragmentWidget extends StatefulWidget {
  final String path;
  final void Function(String action)? onAction;
  const SduiFragmentWidget({required this.path, this.onAction, super.key});

  @override
  State<SduiFragmentWidget> createState() => _SduiFragmentWidgetState();
}

class _SduiFragmentWidgetState extends State<SduiFragmentWidget> {
  Map? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(SduiFragmentWidget old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path) _load();
  }

  Future<void> _load() async {
    final raw = await QiniuDirectClient.fetchConfigFile(widget.path);
    if (mounted && raw != null) setState(() => _data = raw);
  }

  @override
  Widget build(BuildContext context) {
    if (_data == null) return const SizedBox(height: 1);
    final parser = SduiParser(onAction: widget.onAction);
    return parser.parse(_data) ?? const SizedBox();
  }
}
