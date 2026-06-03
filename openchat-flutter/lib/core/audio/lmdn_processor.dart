import 'dart:async';
import 'dart:developer' show log;
import 'dart:typed_data';
import 'lmdn_codec.dart';
import 'lmdn_models.dart';
import 'audio_pipeline.dart';

class LmdnProcessor {
  LmdnCodec? _codec;
  AudioPipeline? _pipeline;
  bool _isProcessing = false;

  final _speakingController = StreamController<bool>.broadcast();
  final _audioLevelController = StreamController<double>.broadcast();

  final int sampleRate;
  final bool enableDenoise;
  final bool enableCodec;

  LmdnProcessor({
    this.sampleRate = 48000,
    this.enableDenoise = true,
    this.enableCodec = true,
  });

  Stream<bool> get speakingEvents => _speakingController.stream;
  Stream<double> get audioLevel => _audioLevelController.stream;

  Future<void> initialize() async {
    if (enableDenoise) {
      _pipeline = AudioPipeline(sampleRate: sampleRate, frameSize: 480);
      await _pipeline!.initialize();
    }

    if (enableCodec) {
      _codec = LmdnCodec(sampleRate: sampleRate);
      await _codec!.initialize();
    }

    _isProcessing = true;
  }

  Future<Uint8List?> processMicrophoneInput(Uint8List pcmData) async {
    if (!_isProcessing) return null;

    if (_pipeline != null) {
      final processed = await _pipeline!.processFrame(pcmData);
      _speakingController.add(processed.isSpeech ?? false);
      final level = _calculateAudioLevel(processed.data);
      _audioLevelController.add(level);
      pcmData = processed.data;
    }

    if (_codec != null) {
      final encoded = await _codec!.encode(pcmData);
      return encoded.data;
    }

    return pcmData;
  }

  Future<ProcessedAudioResult?> processReceivedAudio(Uint8List data) async {
    if (!_isProcessing) return null;

    if (_codec != null) {
      try {
        final decoded = await _codec!.decode(data);
        return ProcessedAudioResult(pcm: decoded.pcm, notes: decoded.notes);
      } catch (e) {
        log('processReceivedAudio decode failed: $e');
        return null;
      }
    }

    return ProcessedAudioResult(pcm: data, notes: const []);
  }

  Map<String, dynamic> getStats() {
    return {
      'codec': _codec?.isReady ?? false,
      'pipeline': _pipeline?.rnnoiseReady ?? false,
      'codecStats': _codec?.getStats(),
    };
  }

  double _calculateAudioLevel(Uint8List pcmData) {
    double sum = 0;
    int count = 0;
    for (int i = 0; i + 1 < pcmData.length; i += 2) {
      final sample = pcmData[i] | (pcmData[i + 1] << 8);
      sum += (sample > 32767 ? sample - 65536 : sample).abs();
      count++;
    }
    return count > 0 ? (sum / count / 32768) : 0;
  }

  void resetCodec() { _codec?.reset(); }

  void dispose() {
    _isProcessing = false;
    _codec?.destroy();
    _pipeline?.destroy();
    _speakingController.close();
    _audioLevelController.close();
  }
}
