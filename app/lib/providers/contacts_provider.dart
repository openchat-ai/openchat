import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';
import 'package:openchat/providers/identity_provider.dart';

final contactsProvider =
    StateNotifierProvider<ContactsNotifier, List<Identity>>((ref) {
      return ContactsNotifier(ref.watch(storageServiceProvider));
    });

class ContactsNotifier extends StateNotifier<List<Identity>> {
  final dynamic _storage;

  ContactsNotifier(this._storage) : super([]) {
    _loadContacts();
  }

  Future<void> _loadContacts() async {
    state = await _storage.getContacts();
  }

  Future<void> addContact(Identity contact) async {
    await _storage.addContact(contact);
    state = [...state, contact];
  }

  Future<void> updateContact(Identity contact) async {
    await _storage.updateContact(contact);
    state = state.map((c) => c.id == contact.id ? contact : c).toList();
  }

  Future<void> removeContact(String id) async {
    await _storage.removeContact(id);
    state = state.where((c) => c.id != id).toList();
  }
}
