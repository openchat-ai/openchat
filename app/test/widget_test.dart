import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/main.dart';

void main() {
  testWidgets('OpenChat app smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: OpenChatApp()));

    expect(find.text('OpenChat'), findsOneWidget);
  });
}
