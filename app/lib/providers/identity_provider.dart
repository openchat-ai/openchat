import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';
import 'package:openchat/services/storage_service.dart';

final identityProvider = StateNotifierProvider<IdentityNotifier, UserIdentity?>(
  (ref) {
    return IdentityNotifier(ref.watch(storageServiceProvider));
  },
);

class IdentityNotifier extends StateNotifier<UserIdentity?> {
  final StorageService _storage;

  IdentityNotifier(this._storage) : super(null) {
    _loadIdentity();
  }

  Future<void> _loadIdentity() async {
    state = await _storage.getIdentity();
  }

  Future<void> createIdentity({
    required String name,
    String? avatar,
    String personality = 'friendly',
  }) async {
    final identity = await UserIdentity.create(
      name: name,
      avatar: avatar,
      personality: personality,
    );
    await _storage.saveIdentity(identity);
    state = identity;
  }

  Future<void> importIdentity({
    required String privateKeyHex,
    required String name,
    String? avatar,
    String personality = 'friendly',
  }) async {
    final identity = await UserIdentity.importFromPrivateKey(
      privateKeyHex: privateKeyHex,
      name: name,
      avatar: avatar,
      personality: personality,
    );
    await _storage.saveIdentity(identity);
    state = identity;
  }

  Future<void> updateProfile({
    String? name,
    String? avatar,
    String? personality,
  }) async {
    if (state == null) return;

    final updated = state!.copyWith(
      name: name ?? state!.name,
      avatar: avatar ?? state!.avatar,
      personality: personality ?? state!.personality,
    );
    await _storage.saveIdentity(updated);
    state = updated;
  }

  Future<void> clear() async {
    await _storage.deleteIdentity();
    state = null;
  }
}

final isInitializedProvider = Provider<bool>((ref) {
  return ref.watch(identityProvider) != null;
});

final myPeerIdProvider = Provider<String?>((ref) {
  return ref.watch(identityProvider)?.peerId;
});

final storageServiceProvider = Provider<StorageService>((ref) {
  throw UnimplementedError('storageServiceProvider must be overridden');
});
