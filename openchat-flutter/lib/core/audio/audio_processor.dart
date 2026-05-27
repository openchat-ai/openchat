import 'dart:async';
import 'dart:typed_data';
import 'epc_codec.dart';
import 'audio_pipeline.dart';
import 'opus_codec.dart';

enum AudioMode {
  raw,
  epc,        // EPC Codec (1-12 kbps, 96-bit frames)
  opus,
  adaptive,
}

class AudioProcessor {
  EpcCodec? _codec;
  AudioPipeline? _pipeline;
  OpusCodec? _opus;

  AudioMode _mode;
  bool _isProcessing = false;

  final _speakingController = StreamController<bool>.broadcast();
  final _audioLevelController = StreamController<double>.broadcast();

  final int sampleRate;
  final bool enableDenoise;
  final bool enableCodec;

  AudioProcessor({
    this.sampleRate = 24000,
    this.enableDenoise = true,
    this.enableCodec = true,
    AudioMode mode = AudioMode.raw,
  }) : _mode = mode;

  Stream<bool> get speakingEvents => _speakingController.stream;
  Stream<double> get audioLevel => _audioLevelController.stream;
  AudioMode get mode => _mode;

  Future<void> initialize() async {
    if (enableDenoise) {
      _pipeline = AudioPipeline(sampleRate: sampleRate, frameSize: 480);
      await _pipeline!.initialize();
    }

    if (enableCodec) {
      if (_mode == AudioMode.opus) {
        _opus = OpusCodec(sampleRate: sampleRate);
        await _opus!.initialize();
      } else {
        _codec = EpcCodec(sampleRate: sampleRate);
        await _codec!.initialize();
      }
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

    if (_mode == AudioMode.opus && _opus != null) {
      return _opus!.encode(pcmData);
    }
    if (_codec != null && _mode == AudioMode.epc) {
      final encoded = await _codec!.encode(pcmData);
      return encoded.data;
    }

    return pcmData;
  }

  Future<Uint8List?> processReceivedAudio(Uint8List data) async {
    if (!_isProcessing) return null;

    if (_mode == AudioMode.opus && _opus != null) {
      return _opus!.decode(data);
    }
    if (_codec != null && _mode == AudioMode.epc) {
      try {
        final decoded = await _codec!.decode(data);
        return decoded.pcm;
      } catch (_) {
        return data;
      }
    }

    return data;
  }

  void setMode(AudioMode mode) {
    _mode = mode;
  }

  Map<String, dynamic> getStats() {
    return {
      'mode': _mode.name,
      'codec': _codec?.isReady ?? false,
      'pipeline': _pipeline?.rnnoiseReady ?? false,
      'codecStats': _codec?.getStats(),
    };
  }

  double _calculateAudioLevel(Uint8List pcmData) {
    double sum = 0;
    int count = 0;
    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = pcmData[i] | (pcmData[i + 1] << 8);
      sum += (sample > 32767 ? sample - 65536 : sample).abs();
      count++;
    }
    return count > 0 ? (sum / count / 32768) : 0;
  }

  void dispose() {
    _isProcessing = false;
    _codec?.destroy();
    _opus?.destroy();
    _pipeline?.destroy();
    _speakingController.close();
    _audioLevelController.close();
  }
}
