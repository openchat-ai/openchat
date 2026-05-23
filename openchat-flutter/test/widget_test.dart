import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/main.dart';

void main() {
  testWidgets('App renders main screen', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: OpenChatApp()),
    );
    await tester.pump();
    expect(find.byType(OpenChatApp), findsOneWidget);
  }, skip: true);
}
