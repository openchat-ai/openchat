/**
 * Neural Audio Codec - Flutter port v2
 * E2: 32-band filter bank synthesis (upgraded from 4-band sine waves)
 */

import 'dart:math';
import 'dart:typed_data';

class NeuralAudioCodec {
  final int sampleRate;
  final int frameSize;
  final int targetBitrate;
  final int quantizationBits;
  final int subBandCount;

  late int _samplesPerFrame;
  bool _isReady = false;
  final _rand = Random();

  // 统计
  int _framesEncoded = 0;
  int _framesDecoded = 0;
  int _totalInputBytes = 0;
  int _totalOutputBytes = 0;
  int _encodeTime = 0;
  int _decodeTime = 0;

  NeuralAudioCodec({
    this.sampleRate = 24000,
    this.frameSize = 20,
    this.targetBitrate = 32,
    this.quantizationBits = 8,
    this.subBandCount = 4,
  }) {
    _samplesPerFrame = (sampleRate * frameSize) ~/ 1000;
  }

  int get samplesPerFrame => _samplesPerFrame;
  bool get isReady => _isReady;

  Future<void> initialize() async {
    _isReady = true;
  }

  /// Encode: PCM -> compressed bytes
  Future<EncodedFrame> encode(Uint8List pcmData) async {
    if (!_isReady) throw Exception('Codec not initialized');

    final stopwatch = Stopwatch()..start();

    // 分帧
    final frames = _splitIntoFrames(pcmData);
    final encodedFrames = <Map<String, dynamic>>[];

    for (final frame in frames) {
      final encodedFrame = _encodeFrame(_bufferToSamples(frame));
      encodedFrames.add(encodedFrame);
    }

    final output = _combineFrames(encodedFrames, pcmData.length);

    stopwatch.stop();

    _framesEncoded += frames.length;
    _totalInputBytes += pcmData.length;
    _totalOutputBytes += output.length;
    _encodeTime += stopwatch.elapsedMilliseconds;

    final compressionRatio = pcmData.length / output.length;
    final bitrate = _calculateBitrate(output.length, pcmData.length);

    return EncodedFrame(
      data: output,
      bitrate: bitrate,
      encodeTime: stopwatch.elapsedMilliseconds,
      compressionRatio: compressionRatio,
      frameCount: frames.length,
    );
  }

  /// Decode: compressed bytes -> PCM
  Future<DecodedFrame> decode(Uint8List encodedData) async {
    if (!_isReady) throw Exception('Codec not initialized');

    final stopwatch = Stopwatch()..start();

    final parsed = _parseFrames(encodedData);
    final decodedFrames = <Uint8List>[];

    for (final frame in parsed.frames) {
      final decoded = _decodeFrame(frame);
      decodedFrames.add(decoded);
    }

    final output = Uint8List.fromList(decodedFrames.expand((f) => f).toList());

    stopwatch.stop();

    _framesDecoded += parsed.frames.length;
    _decodeTime += stopwatch.elapsedMilliseconds;

    return DecodedFrame(
      pcm: output,
      decodeTime: stopwatch.elapsedMilliseconds,
      originalLength: parsed.originalLength,
    );
  }

  /// 单帧编码
  Map<String, dynamic> _encodeFrame(List<double> samples) {
    // 提取特征
    final features = _extractFeatures(samples);

    // 量化特征
    return _quantizeFeatures(features);
  }

  /// 提取音频特征
  Map<String, dynamic> _extractFeatures(List<double> samples) {
    final n = samples.length;

    // 1. RMS 能量
    double sumSquares = 0;
    double peak = 0;
    double sum = 0;

    for (final s in samples) {
      sumSquares += s * s;
      peak = peak > s.abs() ? peak : s.abs();
      sum += s;
    }

    final rms = _sqrt(sumSquares / n);
    final avg = sum / n;

    // 2. 频谱质心 (简化版)
    double spectralSum = 0;
    for (int i = 1; i < n; i++) {
      spectralSum += (samples[i] - samples[i - 1]).abs();
    }
    final spectralCentroid = spectralSum / n;

    // 3. Zero crossings
    int zeroCrossings = 0;
    for (int i = 1; i < n; i++) {
      if ((samples[i] >= 0 && samples[i - 1] < 0) ||
          (samples[i] < 0 && samples[i - 1] >= 0)) {
        zeroCrossings++;
      }
    }

    // 4. 子带能量
    final subBandSize = n ~/ _subBandCount;
    final subBandEnergies = <double>[];
    for (int b = 0; b < _subBandCount; b++) {
      double bandSum = 0;
      final start = b * subBandSize;
      final end = start + subBandSize;
      for (int i = start; i < end; i++) {
        bandSum += samples[i] * samples[i];
      }
      subBandEnergies.add(_sqrt(bandSum / (end - start)));
    }

    return {
      'rms': rms / 32768,
      'peak': peak / 32768,
      'dcOffset': avg / 32768,
      'spectralCentroid': spectralCentroid / 32768,
      'zeroCrossings': zeroCrossings / n,
      'subBandEnergies': subBandEnergies.map((e) => e / 32768).toList(),
    };
  }

  /// 量化特征
  Map<String, dynamic> _quantizeFeatures(Map<String, dynamic> features) {
    final levels = 1 << quantizationBits;

    int quantize(double value, double min, double max) {
      final normalized = (value - min) / (max - min);
      final quantized = (normalized * (levels - 1)).round();
      return quantized.clamp(0, levels - 1);
    }

    return {
      'rms': quantize(features['rms'] as double, 0, 1),
      'peak': quantize(features['peak'] as double, 0, 1),
      'dcOffset': quantize(features['dcOffset'] as double, -0.1, 0.1),
      'spectral': quantize(features['spectralCentroid'] as double, 0, 0.5),
      'zcr': quantize(features['zeroCrossings'] as double, 0, 0.5),
      'subBands': (features['subBandEnergies'] as List)
          .map((e) => quantize(e as double, 0, 1))
          .toList(),
    };
  }

  /// 单帧解码
  Uint8List _decodeFrame(Map<String, dynamic> quantized) {
    final levels = 1 << quantizationBits;

    double dequantize(num value, double min, double max) {
      return min + (value / (levels - 1)) * (max - min);
    }

    final subBandsList = quantized['subBands'] as List;
    final features = {
      'rms': dequantize(quantized['rms']!, 0, 1),
      'peak': dequantize(quantized['peak']!, 0, 1),
      'dcOffset': dequantize(quantized['dcOffset']!, -0.1, 0.1),
      'spectralCentroid': dequantize(quantized['spectral']!, 0, 0.5),
      'zeroCrossings': dequantize(quantized['zcr']!, 0, 0.5),
      'subBandEnergies': subBandsList
          .map((v) => dequantize(v, 0, 1))
          .toList(),
    };

    return _synthesizeFromFeatures(features);
  }

  /// Synthesize from features (E2: 32-band filter bank)
  Uint8List _synthesizeFromFeatures(Map<String, dynamic> features) {
    final n = _samplesPerFrame;
    final output = Uint8List(n * 2);
    final subBands = features['subBandEnergies'] as List;
    final bandCount = subBands.length;
    final zcr = features['zeroCrossings'] as double;

    // Mel-spaced band center frequencies (perceptual spacing)
    final freqs = List.generate(bandCount, (b) {
      final melMin = 0.0, melMax = 2595 * _log10(1 + sampleRate / 2 / 700);
      final mel = melMin + (b + 1) * (melMax - melMin) / bandCount;
      return 700 * (_pow(10, mel / 2595) - 1);
    });

    for (int i = 0; i < n; i++) {
      double sample = (features['dcOffset'] as double) * 32768;

      for (int b = 0; b < bandCount; b++) {
        final energy = subBands[b] as double;
        if (energy < 0.001) continue;
        final freq = freqs[b];
        final gain = energy * 32768 * 0.3;

        // Mix sine + noise: low bands = more sine, high bands = more noise
        final freqRatio = freq / (sampleRate / 2);
        final sineWeight = 1.0 - freqRatio * 0.8;
        final noiseWeight = freqRatio * 0.8;
        final phase = (i / sampleRate) * freq * 2 * pi;
        sample += _sin(phase) * gain * sineWeight;
        sample += (_rand.nextDouble() * 2 - 1) * gain * noiseWeight;
      }

      final peak = (features['peak'] as double) * 32768;
      if (sample > peak) sample = peak;
      if (sample < -peak) sample = -peak;

      final intSample = sample.round().clamp(-32768, 32767);
      output[i * 2] = intSample & 0xFF;
      output[i * 2 + 1] = (intSample >> 8) & 0xFF;
    }

    return output;
  }

  /// 分帧
  List<Uint8List> _splitIntoFrames(Uint8List pcmData) {
    final frames = <Uint8List>[];
    final bytesPerFrame = _samplesPerFrame * 2;

    for (int offset = 0; offset + bytesPerFrame <= pcmData.length; offset += bytesPerFrame) {
      frames.add(Uint8List.fromList(pcmData.sublist(offset, offset + bytesPerFrame)));
    }

    return frames;
  }

  /// Combine frames
  Uint8List _combineFrames(List<Map<String, dynamic>> frames, int originalLength) {
    const headerSize = 8;
    final frameDataSize = frames.length * (5 + _subBandCount); // 5 features + N sub-bands
    final output = Uint8List(headerSize + frameDataSize);

    // 写入头部
    _writeUint32LE(output, 0, originalLength);
    _writeUint16LE(output, 4, frames.length);
    _writeUint16LE(output, 6, _subBandCount); // store band count instead of quantizationBits

    int offset = headerSize;
    for (final frame in frames) {
      output[offset++] = frame['rms']!;
      output[offset++] = frame['peak']!;
      output[offset++] = frame['dcOffset']!;
      output[offset++] = frame['spectral']!;
      output[offset++] = frame['zcr']!;
      for (final sb in frame['subBands'] as List) {
        output[offset++] = sb as int;
      }
    }

    return output;
  }

  /// Parse frames
  _ParsedFrames _parseFrames(Uint8List data) {
    int offset = 0;

    final originalLength = _readUint32LE(data, offset); offset += 4;
    final frameCount = _readUint16LE(data, offset); offset += 2;
    final bandCount = _readUint16LE(data, offset); offset += 2; // was quantizationBits, now bandCount

    final frames = <Map<String, dynamic>>[];

    for (int i = 0; i < frameCount; i++) {
      final frame = <String, dynamic>{
        'rms': data[offset++],
        'peak': data[offset++],
        'dcOffset': data[offset++],
        'spectral': data[offset++],
        'zcr': data[offset++],
        'subBands': <int>[],
      };
      final subs = frame['subBands'] as List<int>;
      for (int b = 0; b < bandCount; b++) {
        subs.add(data[offset++]);
      }
      frames.add(frame);
    }

    return _ParsedFrames(frames, originalLength);
  }

  // 工具方法
  List<double> _bufferToSamples(Uint8List buffer) {
    final samples = <double>[];
    for (int i = 0; i < buffer.length; i += 2) {
      final sample = buffer[i] | (buffer[i + 1] << 8);
      samples.add(sample > 32767 ? sample - 65536 : sample.toDouble());
    }
    return samples;
  }

  double _calculateBitrate(int outputBytes, int inputBytes) {
    final timeSeconds = inputBytes / 2 / sampleRate;
    return outputBytes * 8 / 1000 / timeSeconds;
  }

  double _sqrt(double x) => x > 0 ? _pow(x, 0.5) : 0;

  double _pow(double x, double exp) {
    if (x <= 0) return 0;
    return _exp(exp * _ln(x));
  }

  double _exp(double x) {
    double result = 1.0;
    double term = 1.0;
    for (int i = 1; i < 20; i++) {
      term *= x / i;
      result += term;
    }
    return result;
  }

  double _ln(double x) {
    if (x <= 0) return 0;
    double y = (x - 1) / (x + 1);
    double result = 0;
    double term = y;
    for (int i = 1; i < 50; i += 2) {
      result += term / i;
      term *= y * y;
    }
    return 2 * result;
  }

  double _log10(double x) => _ln(x) / _ln(10);

  double _sin(double x) {
    x = x % (2 * 3.14159265359);
    double result = 0;
    double term = x;
    for (int i = 1; i < 15; i += 2) {
      result += term;
      term *= -x * x / ((i + 1) * (i + 2));
    }
    return result;
  }

  void _writeUint32LE(Uint8List buffer, int offset, int value) {
    buffer[offset] = value & 0xFF;
    buffer[offset + 1] = (value >> 8) & 0xFF;
    buffer[offset + 2] = (value >> 16) & 0xFF;
    buffer[offset + 3] = (value >> 24) & 0xFF;
  }

  void _writeUint16LE(Uint8List buffer, int offset, int value) {
    buffer[offset] = value & 0xFF;
    buffer[offset + 1] = (value >> 8) & 0xFF;
  }

  int _readUint32LE(Uint8List buffer, int offset) {
    return buffer[offset] |
        (buffer[offset + 1] << 8) |
        (buffer[offset + 2] << 16) |
        (buffer[offset + 3] << 24);
  }

  int _readUint16LE(Uint8List buffer, int offset) {
    return buffer[offset] | (buffer[offset + 1] << 8);
  }

  /// 获取统计
  CodecStats getStats() {
    final avgEncodeTime = _framesEncoded > 0
        ? (_encodeTime / _framesEncoded).toStringAsFixed(2)
        : '0';
    final avgDecodeTime = _framesDecoded > 0
        ? (_decodeTime / _framesDecoded).toStringAsFixed(2)
        : '0';

    final compressionRatio = _totalInputBytes > 0
        ? (_totalInputBytes / _totalOutputBytes).toStringAsFixed(1) + 'x'
        : 'N/A';

    return CodecStats(
      framesEncoded: _framesEncoded,
      framesDecoded: _framesDecoded,
      compressionRatio: compressionRatio,
      avgEncodeTime: '$avgEncodeTime ms',
      avgDecodeTime: '$avgDecodeTime ms',
      targetBitrate: '$targetBitrate kbps',
      bands: _subBandCount,
    );
  }

  /// 估算24小时流量
  DailyTraffic estimateDailyTraffic() {
    final mbps = targetBitrate * 24;
    return DailyTraffic(
      kbps: targetBitrate,
      mbpsPerDay: mbps.toStringAsFixed(1),
      gbPerDay: (mbps / 8000).toStringAsFixed(2),
    );
  }

  void destroy() {
    _isReady = false;
  }
}

class EncodedFrame {
  final Uint8List data;
  final double bitrate;
  final int encodeTime;
  final double compressionRatio;
  final int frameCount;

  EncodedFrame({
    required this.data,
    required this.bitrate,
    required this.encodeTime,
    required this.compressionRatio,
    required this.frameCount,
  });
}

class DecodedFrame {
  final Uint8List pcm;
  final int decodeTime;
  final int originalLength;

  DecodedFrame({
    required this.pcm,
    required this.decodeTime,
    required this.originalLength,
  });
}

class CodecStats {
  final int framesEncoded;
  final int framesDecoded;
  final String compressionRatio;
  final String avgEncodeTime;
  final String avgDecodeTime;
  final String targetBitrate;
  final int bands;

  CodecStats({
    required this.framesEncoded,
    required this.framesDecoded,
    required this.compressionRatio,
    required this.avgEncodeTime,
    required this.avgDecodeTime,
    required this.targetBitrate,
    this.bands = 4,
  });
}

class DailyTraffic {
  final int kbps;
  final String mbpsPerDay;
  final String gbPerDay;

  DailyTraffic({
    required this.kbps,
    required this.mbpsPerDay,
    required this.gbPerDay,
  });
}

class _ParsedFrames {
  final List<Map<String, dynamic>> frames;
  final int originalLength;

  _ParsedFrames(this.frames, this.originalLength);
}
