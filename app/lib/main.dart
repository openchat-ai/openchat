import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:openchat/ui/theme/app_theme.dart';
import 'package:openchat/ui/screens/splash_screen.dart';
import 'package:openchat/ui/screens/profile/my_qr_screen.dart';
import 'package:openchat/ui/screens/chat/chat_detail_screen.dart';
import 'package:openchat/ui/screens/bridge/bridge_status_screen.dart';
import 'package:openchat/services/storage_service.dart';
import 'package:openchat/providers/identity_provider.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Hive.initFlutter();

  final storageService = StorageService();
  await storageService.init();

  runApp(
    ProviderScope(
      overrides: [storageServiceProvider.overrideWithValue(storageService)],
      child: const OpenChatApp(),
    ),
  );
}

class OpenChatApp extends ConsumerWidget {
  const OpenChatApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final theme = ref.watch(appThemeProvider);

    return MaterialApp(
      title: 'OpenChat',
      debugShowCheckedModeBanner: false,
      theme: theme.lightTheme,
      darkTheme: theme.darkTheme,
      themeMode: themeMode,
      home: const SplashScreen(),
      routes: {
        '/profile/my-qr': (context) => const MyQrScreen(),
        '/chat': (context) {
          final args = ModalRoute.of(context)!.settings.arguments as Map<String, dynamic>?;
          return ChatDetailScreen(
            id: args?['id'] ?? '',
            name: args?['name'] ?? 'Chat',
          );
        },
        '/bridge/status': (context) => const BridgeStatusScreen(),
      },
    );
  }
}
