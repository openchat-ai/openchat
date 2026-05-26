/**
 * Audio Processor
 * Neural Codec + Audio Pipeline + RNNOISE integration
 */

import 'dart:async';
import 'dart:typed_data';
import 'neural_audio_codec.dart';
import 'audio_pipeline.dart';
import 'opus_codec.dart';

enum AudioMode {
  raw,        // 原始 PCM (256 kbps)
  neural,     // Neural Codec (8-32 kbps)
  opus,       // Opus 编码
  adaptive,   // 自适应
}

class AudioProcessor {
  NeuralAudioCodec? _codec;
  AudioPipeline? _pipeline;
  OpusCodec? _opus;

  AudioMode _mode;
  bool _isProcessing = false;

  final _speakingController = StreamController<bool>.broadcast();
  final _audioLevelController = StreamController<double>.broadcast();

  // 配置
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
      _pipeline = AudioPipeline(
        sampleRate: sampleRate,
        frameSize: 480,
      );
      await _pipeline!.initialize();
    }

    if (enableCodec) {
      if (_mode == AudioMode.opus) {
        _opus = OpusCodec(sampleRate: sampleRate);
        await _opus!.initialize();
      } else {
        _codec = NeuralAudioCodec(
          sampleRate: sampleRate,
          targetBitrate: 32,
          subBandCount: 32,
        );
        await _codec!.initialize();
      }
    }

    _isProcessing = true;
  }

  /// Process microphone input (encode before sending)
  Future<Uint8List?> processMicrophoneInput(Uint8List pcmData) async {
    if (!_isProcessing) return null;

    // 1. 音频处理管道 (降噪/VAD/AGC)
    if (_pipeline != null) {
      final processed = await _pipeline!.processFrame(pcmData);

      _speakingController.add(processed.isSpeech ?? false);

      // 计算音频级别
      final level = _calculateAudioLevel(processed.data);
      _audioLevelController.add(level);

      pcmData = processed.data;
    }

    // 2. 编码
    if (_mode == AudioMode.opus && _opus != null) {
      return _opus!.encode(pcmData);
    }
    if (_codec != null && _mode == AudioMode.neural) {
      final encoded = await _codec!.encode(pcmData);
      return encoded.data;
    }

    // raw 模式直接返回原始 PCM
    return pcmData;
  }

  /// Process received audio (decode before playing)
  Future<Uint8List?> processReceivedAudio(Uint8List data) async {
    if (!_isProcessing) return null;

    if (_mode == AudioMode.opus && _opus != null) {
      return _opus!.decode(data);
    }
    if (_codec != null && _mode == AudioMode.neural) {
      try {
        final decoded = await _codec!.decode(data);
        return decoded.pcm;
      } catch (e) {
        return data;
      }
    }

    return data;
  }

  /// 设置音频模式
  void setMode(AudioMode mode) {
    _mode = mode;
  }

  /// 获取统计信息
  Map<String, dynamic> getStats() {
    return {
      'mode': _mode.name,
      'codec': _codec?.isReady ?? false,
      'pipeline': _pipeline?.rnnoiseReady ?? false,
      'codecStats': _codec?.getStats().toJson(),
      'pipelineStats': _pipeline?.getStats().toJson(),
    };
  }

  double _calculateAudioLevel(Uint8List pcmData) {
    double sum = 0;
    int count = 0;

    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = pcmData[i] | (pcmData[i + 1] << 8);
      final signed = sample > 32767 ? sample - 65536 : sample;
      sum += signed.abs();
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

// 扩展 CodecStats
extension CodecStatsExtension on CodecStats {
  Map<String, dynamic> toJson() => {
    'framesEncoded': framesEncoded,
    'framesDecoded': framesDecoded,
    'compressionRatio': compressionRatio,
    'avgEncodeTime': avgEncodeTime,
    'avgDecodeTime': avgDecodeTime,
    'targetBitrate': targetBitrate,
  };
}

// 扩展 AudioPipelineStats
extension AudioPipelineStatsExtension on AudioPipelineStats {
  Map<String, dynamic> toJson() => {
    'totalFrames': totalFrames,
    'speechFrames': speechFrames,
    'noiseFrames': noiseFrames,
    'speechRatio': speechRatio,
    'totalSpeechTime': totalSpeechTime,
    'vadEnabled': vadEnabled,
    'rnnoiseEnabled': rnnoiseEnabled,
    'rnnoiseReady': rnnoiseReady,
    'rnnoiseAvgTime': rnnoiseAvgTime,
  };
}
