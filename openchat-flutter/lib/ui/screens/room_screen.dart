import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import 'room_audio.dart';

class RoomScreen extends ConsumerStatefulWidget {
  final String roomId;
  const RoomScreen({super.key, required this.roomId});

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  RoomAudio? _audio;

  @override
  void initState() {
    super.initState();
    _initAudio();
  }

  void _initAudio() {
    _audio = RoomAudio(
      roomId: widget.roomId,
      onParticipants: (_) { if (mounted) setState(() {}); },
      onState: () { if (mounted) setState(() {}); },
    );
    _audio!.start();
  }

  void _leaveRoom() {
    _audio?.leave();
    if (mounted && Navigator.canPop(context)) Navigator.pop(context);
  }

  @override
  void dispose() {
    _audio?.leave();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final audio = _audio;
    if (audio == null) {
      return Scaffold(backgroundColor: theme.background);
    }
    final sortedPeers = audio.participants.where((p) => p != audio.myPeerId).toList()..sort();

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surface.withValues(alpha: 0.5),
        elevation: 0,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('房间: ${widget.roomId}', style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
          Text('${audio.participants.length} 人在线', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
        ]),
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: theme.textPrimary),
          onPressed: _leaveRoom,
        ),
      ),
      body: Column(children: [
        Expanded(child: sortedPeers.isEmpty
          ? Center(child: Text('等待其他人加入...', style: TextStyle(color: theme.textTertiary, fontSize: 16)))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: sortedPeers.length + 1,
              itemBuilder: (context, index) {
                final isSelf = index == 0;
                final peerId = isSelf ? audio.myPeerId : sortedPeers[index - 1];
                final isMuted = isSelf ? audio.muted : audio.isPeerMuted(peerId);
                return Card(
                  color: theme.surface.withValues(alpha: 0.4),
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  child: ListTile(
                    leading: CircleAvatar(child: Icon(Icons.person, color: Colors.white)),
                    title: Text(isSelf ? '我 ($peerId)' : peerId,
                      style: TextStyle(color: theme.textPrimary, fontSize: 14)),
                    trailing: IconButton(
                      icon: Icon(isMuted ? Icons.mic_off : Icons.mic, color: isMuted ? theme.error : theme.textSecondary),
                      onPressed: () {
                        if (isSelf) audio.toggleMuteSelf();
                        else audio.toggleMutePeer(peerId);
                        setState(() {});
                      },
                    ),
                  ),
                );
              },
            )),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.1)))),
          child: SafeArea(child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
            IconButton(
              icon: Icon(audio.muted ? Icons.mic_off : Icons.mic, color: audio.muted ? theme.error : theme.primary),
              onPressed: () { audio.toggleMuteSelf(); setState(() {}); },
            ),
            IconButton(
              icon: const Icon(Icons.call_end, color: Colors.red),
              iconSize: 32,
              onPressed: _leaveRoom,
            ),
          ])),
        ),
      ]),
    );
  }
}
