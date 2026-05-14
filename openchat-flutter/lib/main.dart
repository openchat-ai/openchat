import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'providers/theme_provider.dart';
import 'ui/screens/main_screen.dart';
import 'ui/screens/theme_selector_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Colors.transparent,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );
  runApp(const ProviderScope(child: OpenChatApp()));
}

class OpenChatApp extends ConsumerStatefulWidget {
  const OpenChatApp({super.key});

  @override
  ConsumerState<OpenChatApp> createState() => _OpenChatAppState();
}

class _OpenChatAppState extends ConsumerState<OpenChatApp>
    with WidgetsBindingObserver {
  
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() {
    final brightness = MediaQuery.of(context).platformBrightness;
    ref.read(systemBrightnessProvider.notifier).state = brightness;
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return MaterialApp(
      title: 'OpenChat',
      debugShowCheckedModeBanner: false,
      theme: buildThemeData(theme),
      home: const MainScreen(),
      routes: {
        '/theme': (context) => const ThemeSelectorScreen(),
      },
    );
  }
}
