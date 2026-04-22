import 'package:hive_flutter/hive_flutter.dart';
import 'package:openchat/models/user_identity.dart';

class StorageService {
  static const String _identityBoxName = 'identity';
  static const String _contactsBoxName = 'contacts';
  static const String _settingsBoxName = 'settings';

  static const String _identityKey = 'identity';

  Box<Map>? _identityBox;
  Box<Map>? _contactsBox;
  Box<dynamic>? _settingsBox;
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    await Hive.initFlutter();
    _identityBox = await Hive.openBox<Map>(_identityBoxName);
    _contactsBox = await Hive.openBox<Map>(_contactsBoxName);
    _settingsBox = await Hive.openBox<dynamic>(_settingsBoxName);
    _initialized = true;
  }

  Future<Identity?> getIdentity() async {
    if (!_initialized) await init();
    final data = _identityBox?.get(_identityKey);
    if (data == null) return null;
    return Identity.fromJson(Map<String, dynamic>.from(data));
  }

  Future<void> saveIdentity(Identity identity) async {
    if (!_initialized) await init();
    await _identityBox?.put(_identityKey, identity.toJson());
  }

  Future<void> deleteIdentity() async {
    if (!_initialized) await init();
    await _identityBox?.delete(_identityKey);
  }

  Future<List<Identity>> getContacts() async {
    if (!_initialized) await init();
    final contacts = <Identity>[];
    for (final key in _contactsBox?.keys ?? []) {
      final data = _contactsBox?.get(key);
      if (data != null) {
        contacts.add(Identity.fromJson(Map<String, dynamic>.from(data)));
      }
    }
    return contacts;
  }

  Future<void> addContact(Identity contact) async {
    if (!_initialized) await init();
    await _contactsBox?.put(contact.id, contact.toJson());
  }

  Future<void> updateContact(Identity contact) async {
    if (!_initialized) await init();
    await _contactsBox?.put(contact.id, contact.toJson());
  }

  Future<void> removeContact(String id) async {
    if (!_initialized) await init();
    await _contactsBox?.delete(id);
  }

  Future<T?> getSetting<T>(String key) async {
    if (!_initialized) await init();
    return _settingsBox?.get(key) as T?;
  }

  Future<void> setSetting<T>(String key, T value) async {
    if (!_initialized) await init();
    await _settingsBox?.put(key, value);
  }
}
