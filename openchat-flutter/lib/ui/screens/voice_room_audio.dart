import 'dart:async';
import 'dart:developer' show log;
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';
import '../../core/ui_voice_config.dart';

/// 通话音频管理：录音/编码/上传/播放/解码
/// 由 _VoiceRoomScreenState 持有，状态字段在调用方
class VoiceRoomAudio {
  AudioRecorder? recorder;
  AudioPlayer? player;
  LmdnProcessor? processor;
  StreamSubscription? recordSub;
  Timer? audioTimer;
  List<int> vmBuffer = [];
  bool vmRecording = false;
  final List<Uint8List> playQueue = [];
  final List<Uint8List> localQueue = [];
  final List<Uint8List> callFrames = [];
  List notes = [];
  bool playing = false;
  bool muted = false;
  bool localMode = true;
  int audioSeq = 0;
  LmdnConfig audioCfg = const LmdnConfig();

  QiniuDirectClient? client;
  String? targetPeerId;
  String state = 'calling';
  bool Function() isMounted = () => false;
  void Function(void Function()) setStateCb = (_) {};

  int _lastCpTs = 0;

  /// Write checkpoint to S3 (throttled: max 1 write/sec).
  void _writeCp(String label, String detail) {
    log('[$label] $detail');
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastCpTs < 1000) return;
    _lastCpTs = now;
    final c = client;
    if (c != null) {
      c.writeFile('oc/debug/${c.peerId}/checkpoint.json', {
        'label': label, 'detail': detail, 'ts': now,
      });
    }
  }

  Future<void> startAudio() async {
    if (audioTimer != null) return; // _audioStarted guard
    try {
      final cfg = await LmdnConfig.load();
      audioCfg = cfg;
      recorder = AudioRecorder();
      player = AudioPlayer();
      if (localMode) {
        player.setAudioContext(const AudioContext(
          android: AudioContextAndroid(
            isSpeakerphoneOn: false,
            contentType: AndroidContentType.speech,
            usageType: AndroidUsageType.voiceCommunication,
          ),
        ));
      }
      processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: cfg.denoise, enableCodec: !localMode);
      await processor?.initialize();
      _writeCp('C2', 'processor init ok');

      if (await recorder!.hasPermission() != true) {
        await recorder!.hasPermission(request: true);
        if (await recorder!.hasPermission() != true) {
          _writeCp('C2', 'mic denied');
          return;
        }
      }
      _writeCp('C2', 'mic perm ok');

      final stream = await recorder!.startStream(RecordConfig(
          encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: cfg.sampleRate));
      if (stream == null) {
        _writeCp('C3', 'stream null');
        return;
      }
      _writeCp('C3', 'record stream started');

      final bufSize = cfg.bufferBytes;
      final fadeBytes = cfg.fadeBytes;
      List<int> buffer = [];
      Uint8List? prevOverlap;
      final targetId = targetPeerId;
      if (targetId == null) return;

      recordSub = stream.listen((chunk) async {
        try {
          if (muted || state != 'connected') {
            buffer.clear();
            return;
          }
          buffer.addAll(chunk);
          if (buffer.length >= bufSize) {
            var frame = Uint8List.fromList(buffer.take(bufSize).toList());
            buffer = buffer.skip(bufSize).toList();
            final overlap = prevOverlap;
            if (overlap != null) {
              for (int i = 0; i < fadeBytes && i < frame.length; i += 2) {
                final ratio = i / fadeBytes;
                final pv = overlap[overlap.length - fadeBytes + i] | (overlap[overlap.length - fadeBytes + i + 1] << 8);
                final cv = frame[i] | (frame[i + 1] << 8);
                final ps = pv > 32767 ? pv - 65536 : pv;
                final cs = cv > 32767 ? cv - 65536 : cv;
                final blended = (ps * (1 - ratio) + cs * ratio).round().clamp(-32768, 32767);
                final bv = blended < 0 ? blended + 65536 : blended;
                frame[i] = bv & 0xFF;
                frame[i + 1] = (bv >> 8) & 0xFF;
              }
            }
            prevOverlap = Uint8List.fromList(frame.sublist(frame.length - fadeBytes));
            final processed = await processor?.processMicrophoneInput(frame);
            if (processed != null) {
              if (localMode) {
                localQueue.add(processed);
                _writeCp('C4', 'local enc size=${processed.length}');
              } else {
                await client?.sendEncodedAudio(targetId, processed, audioSeq++);
                _writeCp('C4', 'sent seq=$audioSeq size=${processed.length}');
              }
              callFrames.add(processed);
            } else {
              _writeCp('C4', 'encode null');
            }
          }
        } catch (e) {
          log('record process error: $e');
        }
      }, onError: (e) {
        log('record stream error: $e');
      });

      audioTimer?.cancel();
      audioTimer = Timer.periodic(Duration(milliseconds: cfg.pollMs), (_) async {
        if (state != 'connected' || client == null) return;
        try {
          final List<Uint8List> chunks;
          if (localMode) {
            chunks = List.from(localQueue);
            localQueue.clear();
            if (chunks.isNotEmpty) _writeCp('C5', 'local ${chunks.length} chunks');
          } else {
            chunks = await client!.pollEncodedAudio();
            if (chunks.isNotEmpty) _writeCp('C5', 'polled ${chunks.length} chunks');
          }
          if (chunks.isEmpty) return;
          for (final c in chunks) {
            final result = await processor?.processReceivedAudio(c);
            if (result != null) {
              playQueue.add(result.pcm);
              _writeCp('C6', 'decoded ${result.pcm.length} B');
              if (result.notes.isNotEmpty && isMounted()) {
                notes.addAll(result.notes);
                _writeCp('C8', 'notes=${result.notes.length}');
              }
            } else {
              _writeCp('C6', 'decode null');
            }
          }
          if (!playing) playNext();
        } catch (e) {
          log('audio poll error: $e');
        }
      });
    } catch (e) {
      log('_startAudio init error: $e');
    }
  }

  Future<void> startVmRecord() async {
    if (vmRecording) return;
    vmBuffer.clear();
    try {
      if (recorder == null) recorder = AudioRecorder();
      if (processor == null) {
        final cfg = await LmdnConfig.load();
        processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: false, enableCodec: true);
        await processor!.initialize();
      }
      if (player == null) player = AudioPlayer();
      if (await recorder!.hasPermission() != true) {
        await recorder!.hasPermission(request: true);
        if (await recorder!.hasPermission() != true) return;
      }
      final stream = await recorder!.startStream(RecordConfig(
          encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: processor!.sampleRate));
      if (stream == null) return;
      vmRecording = true;
      recordSub = stream.listen((chunk) {
        vmBuffer.addAll(chunk);
      }, onError: (e) {
        log('vm record error: $e');
        vmRecording = false;
      });
    } catch (e) {
      log('_startVmRecord error: $e');
      vmRecording = false;
    }
  }

  Future<void> endVmRecord() async {
    if (!vmRecording) return;
    vmRecording = false;
    await recordSub?.cancel();
    recordSub = null;
    await recorder?.stop();
    if (vmBuffer.isEmpty) return;
    final pcm = Uint8List.fromList(vmBuffer);
    vmBuffer.clear();
    try {
      final encoded = await processor?.processMicrophoneInput(pcm);
      if (encoded == null) {
        log('vm encode failed');
        return;
      }
      log('vm encoded ${pcm.length} B -> ${encoded.length} B');
      final result = await processor?.processReceivedAudio(encoded);
      if (result == null) {
        log('vm decode failed');
        return;
      }
      final wav = QiniuDirectClient.wavFromPcm(result.pcm);
      await player?.stop();
      await player?.play(BytesSource(wav));
    } catch (e) {
      log('_endVmRecord error: $e');
    }
  }

  Future<void> playNext() async {
    if (playQueue.isEmpty || !isMounted()) {
      playing = false;
      return;
    }
    playing = true;
    try {
      const targetBytes = 3 * 24000 * 2;
      int total = 0;
      final batch = <Uint8List>[];
      while (playQueue.isNotEmpty && total < targetBytes) {
        final chunk = playQueue.removeAt(0);
        batch.add(chunk);
        total += chunk.length;
      }
      final pcm = Uint8List(total);
      int offset = 0;
      for (final chunk in batch) {
        pcm.setRange(offset, offset + chunk.length, chunk);
        offset += chunk.length;
      }
      final fadeSamples = audioCfg.fadeSamples;
      for (int i = 0; i < fadeSamples && i * 2 < pcm.length; i++) {
        final ratio = i / fadeSamples;
        final idx = i * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * ratio).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF;
        pcm[idx + 1] = (b >> 8) & 0xFF;
      }
      for (int i = 0; i < fadeSamples && pcm.length >= (i + 1) * 2; i++) {
        final ratio = i / fadeSamples;
        final idx = pcm.length - (i + 1) * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * (1 - ratio)).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF;
        pcm[idx + 1] = (b >> 8) & 0xFF;
      }
      final wav = QiniuDirectClient.wavFromPcm(pcm);
      log('[C7] play ${pcm.length} B');
      final p = player;
      if (p != null) {
        p.onPlayerComplete.first.then((_) => playNext());
        await p.play(BytesSource(wav));
      }
    } catch (e) {
      log('[C7] error: $e');
      playing = false;
    }
  }

  void dispose() {
    recordSub?.cancel();
    recorder?.dispose();
    player?.dispose();
    processor?.dispose();
    audioTimer?.cancel();
    vmBuffer.clear();
    playQueue.clear();
    localQueue.clear();
    callFrames.clear();
  }
}
