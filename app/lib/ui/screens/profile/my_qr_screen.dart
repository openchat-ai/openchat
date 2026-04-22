import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';
import 'package:openchat/providers/identity_provider.dart';
import 'package:openchat/providers/ai_provider.dart';
import 'package:openchat/ui/theme/colors.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

class MyQrScreen extends ConsumerWidget {
  final Identity? identityParam;

  const MyQrScreen({super.key, this.identityParam});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Identity? displayIdentity = identityParam;

    if (displayIdentity == null) {
      final args = ModalRoute.of(context)?.settings.arguments as String?;
      if (args != null) {
        final aiSessions = ref.read(aiSessionsProvider);
        displayIdentity = aiSessions.cast<Identity?>().firstWhere(
          (ai) => ai?.id == args,
          orElse: () => ref.read(identityProvider),
        );
      }
    }

    final identity = displayIdentity ?? ref.watch(identityProvider);

    if (identity == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: Text(identityParam != null ? "${identity.name}'s QR Code" : 'My QR Code'),
        actions: [
          IconButton(
            icon: const Icon(Icons.share),
            onPressed: () => _shareQr(context, identity.id),
          ),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(24),
              ),
              child: QrImageView(
                data: identity.id,
                version: QrVersions.auto,
                size: 200,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              identity.name,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: AppColors.surfaceDark,
                borderRadius: BorderRadius.circular(8),
              ),
              child: SelectableText(
                identity.id,
                style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              identityParam != null ? 'Scan to add this contact' : 'Scan to add me',
              style: TextStyle(
                fontSize: 14,
                color: AppColors.textSecondary.withAlpha(180),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _shareQr(BuildContext context, String id) {
    Share.share('Add me on OpenChat: $id', subject: 'OpenChat Invitation');
  }
}
