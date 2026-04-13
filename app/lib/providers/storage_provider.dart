import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/services/storage_service.dart';

final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService();
});
