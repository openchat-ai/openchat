import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/providers/config_provider.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(configProvider);
    final configNotifier = ref.read(configProvider.notifier);

    final urlController = TextEditingController(text: config.baseUrl);
    final tokenController = TextEditingController(text: config.token ?? '');

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: urlController,
            decoration: const InputDecoration(
              labelText: 'Bridge URL',
              hintText: 'http://localhost:3000',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: tokenController,
            decoration: const InputDecoration(
              labelText: 'Bearer Token',
              hintText: '请输入您的认证令牌',
              border: OutlineInputBorder(),
            ),
            obscureText: true,
          ),
          const SizedBox(height: 16),
          SwitchListTile(
            title: const Text('开发模式'),
            subtitle: const Text('关闭部分安全检查'),
            value: config.isDev,
            onChanged: (value) => configNotifier.setDevMode(value),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () {
              configNotifier.setBaseUrl(urlController.text);
              configNotifier.setToken(tokenController.text.isEmpty ? null : tokenController.text);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('设置已保存')),
              );
            },
            child: const Text('保存设置'),
          ),
        ],
      ),
    );
  }
}