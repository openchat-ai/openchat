import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/api/resident_client.dart';
import 'package:openchat_flutter/core/models/resident_model.dart';
import 'client_providers.dart';

class FeedNotifier extends StateNotifier<AsyncValue<List<FeedItem>>> {
  final ResidentClient _client;

  FeedNotifier(this._client) : super(const AsyncValue.loading()) {
    refresh();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    try {
      final feed = await _client.getCommunityFeed();
      state = AsyncValue.data(feed);
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }
}

final feedProvider =
    StateNotifierProvider<FeedNotifier, AsyncValue<List<FeedItem>>>((ref) {
  final client = ref.watch(residentClientProvider);
  return FeedNotifier(client);
});
