import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/providers/client_providers.dart';
import 'package:openchat_flutter/core/theme/app_theme.dart';

void main() {
  group('ThemeProvider', () {
    test('systemBrightness default is light', () {
      final container = ProviderContainer();
      addTearDown(() => container.dispose());
      expect(container.read(systemBrightnessProvider), Brightness.light);
    });
  });

  group('AppTheme', () {
    test('all 5 theme styles are defined', () {
      expect(ThemeStyle.values.length, 5);
      expect(ThemeStyle.values, contains(ThemeStyle.glassmorphism));
      expect(ThemeStyle.values, contains(ThemeStyle.retroWave));
      expect(ThemeStyle.values, contains(ThemeStyle.minimalZen));
    });
  });
}
