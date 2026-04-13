import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';
import 'package:openchat/providers/identity_provider.dart';

final contactsProvider =
    StateNotifierProvider<ContactsNotifier, List<UserIdentity>>((ref) {
      return ContactsNotifier(ref.watch(storageServiceProvider));
    });

class ContactsNotifier extends StateNotifier<List<UserIdentity>> {
  final dynamic _storage;

  ContactsNotifier(this._storage) : super([]) {
    _loadContacts();
  }

  Future<void> _loadContacts() async {
    state = await _storage.getContacts();
  }

  Future<void> addContact(UserIdentity contact) async {
    await _storage.addContact(contact);
    state = [...state, contact];
  }

  Future<void> updateContact(UserIdentity contact) async {
    await _storage.updateContact(contact);
    state = state.map((c) => c.peerId == contact.peerId ? contact : c).toList();
  }

  Future<void> removeContact(String peerId) async {
    await _storage.removeContact(peerId);
    state = state.where((c) => c.peerId != peerId).toList();
  }
}
