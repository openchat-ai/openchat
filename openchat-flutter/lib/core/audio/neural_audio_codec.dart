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

  int _framesEncoded = 0, _framesDecoded = 0;
  int _totalInputBytes = 0, _totalOutputBytes = 0;
  int _encodeTime = 0, _decodeTime = 0;

  // E3 transient state
  double _prevFrameRms = 0;
  final List<int> _transientHistory = [];

  // E4 timbre codebook
  static const int timbreCount = 16;
  late List<List<double>> _timbreCodebook;

  // E5 HPSS state
  List<double> _prevHarmonic = List.filled(480, 0.0);
  List<double> _prevPercussive = List.filled(480, 0.0);

  // E6 F0 tracking
  double _prevF0 = 0;
  final List<double> _f0Buffer = [];

  NeuralAudioCodec({
    this.sampleRate = 24000,
    this.frameSize = 20,
    this.targetBitrate = 32,
    this.quantizationBits = 8,
    this.subBandCount = 4,
  }) {
    _samplesPerFrame = (sampleRate * frameSize) ~/ 1000;
    _initTimbreCodebook();
  }

  void _initTimbreCodebook() {
    _timbreCodebook = List.generate(timbreCount, (i) {
      final base = 0.1 + i * 0.05;
      return List.generate(subBandCount, (b) {
        final center = (b + 0.5) / subBandCount;
        return base * (1 + 0.5 * _sin(center * pi * (i + 1)));
      });
    });
  }

  int get samplesPerFrame => _samplesPerFrame;
  bool get isReady => _isReady;

  Future<void> initialize() async { _isReady = true; }

  // ===== E2-E6 Encode Pipeline =====

  Future<EncodedFrame> encode(Uint8List pcmData) async {
    if (!_isReady) throw Exception('Codec not initialized');
    final stopwatch = Stopwatch()..start();
    final frames = _splitIntoFrames(pcmData);
    final encodedFrames = <Map<String, dynamic>>[];

    for (final frame in frames) {
      final samples = _bufferToSamples(frame);

      // E5: HPSS separation
      final separated = _hpssSeparate(samples);

      // E2: Extract features from harmonic part
      final features = _extractFeatures(separated['harmonic'] as List<double>);

      // E3: Onset detection
      final onset = _detectOnset(features['rms'] as double);
      features['onset'] = onset;

      // E4: Timbre classification
      final timbre = _classifyTimbre(features['subBandEnergies'] as List<double>);
      features['timbreIdx'] = timbre['index'];
      features['timbreResidual'] = timbre['residual'];

      // E6: F0 tracking
      final f0 = _trackF0(samples);
      features['f0'] = f0;
      features['voiced'] = f0 > 50 ? 1 : 0;

      encodedFrames.add(_quantizeFeatures(features));
    }

    final output = _combineFrames(encodedFrames, pcmData.length);
    stopwatch.stop();
    _framesEncoded += frames.length;
    _totalInputBytes += pcmData.length;
    _totalOutputBytes += output.length;
    _encodeTime += stopwatch.elapsedMilliseconds;

    return EncodedFrame(
      data: output,
      bitrate: _calculateBitrate(output.length, pcmData.length),
      encodeTime: stopwatch.elapsedMilliseconds,
      compressionRatio: pcmData.length / output.length,
      frameCount: frames.length,
    );
  }

  // ===== E2-E6 Decode Pipeline =====

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

    return DecodedFrame(pcm: output, decodeTime: stopwatch.elapsedMilliseconds, originalLength: parsed.originalLength);
  }

  // ===== Single Frame Encode =====

  Map<String, dynamic> _encodeFrame(List<double> samples) {
    return _quantizeFeatures(_extractFeatures(samples));
  }

  Map<String, dynamic> _extractFeatures(List<double> samples) {
    final n = samples.length;
    double sumSq = 0, peak = 0, sum = 0;
    for (final s in samples) { sumSq += s * s; peak = max(peak, s.abs()); sum += s; }
    final rms = _sqrt(sumSq / n);
    final avg = sum / n;

    double spectralSum = 0;
    for (int i = 1; i < n; i++) spectralSum += (samples[i] - samples[i - 1]).abs();
    final spectralCentroid = spectralSum / n;

    int zeroCrossings = 0;
    for (int i = 1; i < n; i++) {
      if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) zeroCrossings++;
    }

    final subBandSize = n ~/ subBandCount;
    final subBandEnergies = <double>[];
    for (int b = 0; b < subBandCount; b++) {
      double bandSum = 0;
      final start = b * subBandSize, end = start + subBandSize;
      for (int i = start; i < end; i++) bandSum += samples[i] * samples[i];
      subBandEnergies.add(_sqrt(bandSum / (end - start)));
    }

    return {
      'rms': rms / 32768, 'peak': peak / 32768, 'dcOffset': avg / 32768,
      'spectralCentroid': spectralCentroid / 32768,
      'zeroCrossings': zeroCrossings / n,
      'subBandEnergies': subBandEnergies.map((e) => e / 32768).toList(),
    };
  }

  // ===== E3: Transient Encoding =====

  double _detectOnset(double normalizedRms) {
    const threshold = 2.5;
    final ratio = _prevFrameRms > 0.001 ? normalizedRms / _prevFrameRms : 1.0;
    final onset = ratio > threshold ? (ratio / 10).clamp(0.0, 1.0) : 0.0;
    _prevFrameRms = normalizedRms;
    _transientHistory.add((onset * 255).round());
    if (_transientHistory.length > 10) _transientHistory.removeAt(0);
    return onset;
  }

  Uint8List _synthesizeTransient(double onsetStrength, int n) {
    final output = Uint8List(n * 2);
    if (onsetStrength < 0.01) return output;
    final gain = onsetStrength * 32768 * 0.5;
    for (int i = 0; i < n; i++) {
      final env = _exp(-i / (n * 0.15)); // fast decay envelope
      final sample = (_rand.nextDouble() * 2 - 1) * gain * env;
      final clipped = sample.round().clamp(-32768, 32767);
      final bv = clipped < 0 ? clipped + 65536 : clipped;
      output[i * 2] = bv & 0xFF;
      output[i * 2 + 1] = (bv >> 8) & 0xFF;
    }
    return output;
  }

  // ===== E4: Timbre Model =====

  Map<String, dynamic> _classifyTimbre(List<double> energies) {
    int bestIdx = 0;
    double bestDist = double.infinity;
    for (int t = 0; t < timbreCount; t++) {
      double dist = 0;
      for (int b = 0; b < energies.length && b < _timbreCodebook[t].length; b++) {
        dist += (energies[b] - _timbreCodebook[t][b]) * (energies[b] - _timbreCodebook[t][b]);
      }
      if (dist < bestDist) { bestDist = dist; bestIdx = t; }
    }
    final residual = energies.length > 0 ? bestDist / energies.length : 0.0;
    return {'index': bestIdx, 'residual': residual.clamp(0.0, 1.0)};
  }

  List<double> _applyTimbre(List<double> energies, int timbreIdx, double residual) {
    if (timbreIdx >= _timbreCodebook.length) return energies;
    final codebook = _timbreCodebook[timbreIdx];
    return List.generate(energies.length, (b) {
      final blend = 1.0 - residual.clamp(0.0, 1.0) * 0.5;
      return energies[b] * blend + codebook[b] * (1 - blend);
    });
  }

  // ===== E5: HPSS Source Separation =====

  Map<String, dynamic> _hpssSeparate(List<double> samples) {
    final n = samples.length;
    final harmonic = List<double>.filled(n, 0);
    final percussive = List<double>.filled(n, 0);

    // Simple median-based HPSS
    const medianLen = 7;
    final halfLen = medianLen ~/ 2;
    for (int i = 0; i < n; i++) {
      final start = max(0, i - halfLen), end = min(n, i + halfLen + 1);
      final window = samples.sublist(start, end);
      window.sort();
      final med = window[window.length ~/ 2];
      harmonic[i] = med;
      percussive[i] = samples[i] - med;
    }

    _prevHarmonic = harmonic;
    _prevPercussive = percussive;
    return {'harmonic': harmonic, 'percussive': percussive};
  }

  // ===== E6: F0 Tracking =====

  double _trackF0(List<double> samples) {
    final minLag = sampleRate ~/ 800, maxLag = sampleRate ~/ 50;
    final n = samples.length;

    // Subtract DC
    double sum = 0;
    for (final s in samples) sum += s;
    final mean = sum / n;
    final centered = samples.map((s) => s - mean).toList();

    // Autocorrelation
    double bestCorr = 0;
    int bestLag = 0;
    // Use decimated search for speed
    for (int lag = minLag; lag <= maxLag; lag += 2) {
      double corr = 0, norm = 0;
      for (int i = 0; i < n - lag; i++) {
        corr += centered[i] * centered[i + lag];
        norm += centered[i] * centered[i] + centered[i + lag] * centered[i + lag];
      }
      if (norm > 0) corr /= _sqrt(norm);
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }

    final f0 = bestCorr > 0.3 ? sampleRate / bestLag : 0.0;
    _f0Buffer.add(f0);
    if (_f0Buffer.length > 5) _f0Buffer.removeAt(0);

    // Median filter f0
    final sorted = List<double>.from(_f0Buffer)..sort();
    final smoothed = sorted[sorted.length ~/ 2];
    _prevF0 = smoothed;
    return smoothed;
  }

  // ===== Single Frame Decode =====

  Uint8List _decodeFrame(Map<String, dynamic> quantized) {
    final features = _dequantizeFeatures(quantized);
    final n = _samplesPerFrame;

    // E2: Filter bank synthesis
    final mainPcm = _synthesizeFromFeatures(features);

    // E3: Add transient layer
    final onset = (features['onset'] as num?)?.toDouble() ?? 0;
    final transients = _synthesizeTransient(onset, n);

    // E4: Apply timbre coloring
    final timbreIdx = (features['timbreIdx'] as num?)?.toInt() ?? 0;
    final residual = (features['timbreResidual'] as num?)?.toDouble() ?? 0;
    final energies = features['subBandEnergies'] as List;
    final shapedEnergies = _applyTimbre(energies.cast<double>(), timbreIdx, residual);

    // Mix everything
    final output = Uint8List(n * 2);
    for (int i = 0; i < n; i++) {
      final main = (mainPcm[i * 2] | (mainPcm[i * 2 + 1] << 8)).toSigned(16);
      final trans = (transients[i * 2] | (transients[i * 2 + 1] << 8)).toSigned(16);
      final mixed = main + trans;
      final clipped = mixed.clamp(-32768, 32767);
      final bv = clipped < 0 ? clipped + 65536 : clipped;
      output[i * 2] = bv & 0xFF;
      output[i * 2 + 1] = (bv >> 8) & 0xFF;
    }
    return output;
  }

  Map<String, dynamic> _dequantizeFeatures(Map<String, dynamic> quantized) {
    final levels = 1 << quantizationBits;
    double deq(num v, double mn, double mx) => mn + (v / (levels - 1)) * (mx - mn);
    return {
      'rms': deq(quantized['rms']!, 0, 1),
      'peak': deq(quantized['peak']!, 0, 1),
      'dcOffset': deq(quantized['dcOffset']!, -0.1, 0.1),
      'spectralCentroid': deq(quantized['spectral']!, 0, 0.5),
      'zeroCrossings': deq(quantized['zcr']!, 0, 0.5),
      'subBandEnergies': (quantized['subBands'] as List).map((v) => deq(v, 0, 1)).toList(),
      'onset': (quantized['onset'] as num?)?.toDouble() ?? 0,
      'timbreIdx': (quantized['timbreIdx'] as num?)?.toInt() ?? 0,
      'timbreResidual': (quantized['timbreResidual'] as num?)?.toDouble() ?? 0,
      'f0': (quantized['f0'] as num?)?.toDouble() ?? 0,
      'voiced': (quantized['voiced'] as num?)?.toInt() ?? 0,
    };
  }

  Map<String, dynamic> _quantizeFeatures(Map<String, dynamic> features) {
    final levels = 1 << quantizationBits;
    int qtz(double v, double mn, double mx) => ((v - mn) / (mx - mn) * (levels - 1)).round().clamp(0, levels - 1);

    return {
      'rms': qtz(features['rms'] as double, 0, 1),
      'peak': qtz(features['peak'] as double, 0, 1),
      'dcOffset': qtz(features['dcOffset'] as double, -0.1, 0.1),
      'spectral': qtz(features['spectralCentroid'] as double, 0, 0.5),
      'zcr': qtz(features['zeroCrossings'] as double, 0, 0.5),
      'subBands': (features['subBandEnergies'] as List).map((e) => qtz(e as double, 0, 1)).toList(),
      'onset': ((features['onset'] as double) * 255).round().clamp(0, 255),
      'timbreIdx': (features['timbreIdx'] as int).clamp(0, 15),
      'timbreResidual': ((features['timbreResidual'] as double) * 255).round().clamp(0, 255),
      'f0': ((features['f0'] as double) / 10).round().clamp(0, 255),
      'voiced': features['voiced'] as int,
    };
  }

  Uint8List _synthesizeFromFeatures(Map<String, dynamic> features) {
    final n = _samplesPerFrame;
    final output = Uint8List(n * 2);
    final subBands = features['subBandEnergies'] as List;
    final bandCount = subBands.length;
    final timbreIdx = (features['timbreIdx'] as num?)?.toInt() ?? 0;
    final residual = (features['timbreResidual'] as num?)?.toDouble() ?? 0;
    final voiced = (features['voiced'] as num?)?.toInt() ?? 0;
    final f0 = (features['f0'] as num?)?.toDouble() ?? 0;

    // Apply timbre shaping
    final shaped = _applyTimbre(subBands.cast<double>(), timbreIdx, residual);

    // Mel-spaced frequencies
    final freqs = List.generate(bandCount, (b) {
      final melMin = 0.0, melMax = 2595 * _log10(1 + sampleRate / 2 / 700);
      return 700 * (_pow(10, (melMin + (b + 1) * (melMax - melMin) / bandCount) / 2595) - 1);
    });

    // E6: Pulse train for voiced frames
    final pulsePeriod = f0 > 20 ? (sampleRate / f0).round() : 0;

    for (int i = 0; i < n; i++) {
      double sample = (features['dcOffset'] as double) * 32768;

      for (int b = 0; b < bandCount; b++) {
        final energy = shaped[b];
        if (energy < 0.001) continue;
        final freq = freqs[b];
        final gain = energy * 32768 * 0.3;
        final freqRatio = freq / (sampleRate / 2);
        final sineWeight = 1.0 - freqRatio * 0.8;

        // E6: Use pulse train for voiced frames, noise for unvoiced
        final phase = (i / sampleRate) * freq * 2 * pi;
        double excitation;
        if (voiced > 0 && pulsePeriod > 0 && i % pulsePeriod < pulsePeriod * 0.3) {
          excitation = _sin(phase); // pulse-like
        } else {
          excitation = _rand.nextDouble() * 2 - 1;
        }
        sample += _sin(phase) * gain * sineWeight * 0.7 + excitation * gain * (1 - sineWeight) * 0.3;
      }

      final peak = (features['peak'] as double) * 32768;
      if (sample > peak) sample = peak;
      if (sample < -peak) sample = -peak;

      final clipped = sample.round().clamp(-32768, 32767);
      final bv = clipped < 0 ? clipped + 65536 : clipped;
      output[i * 2] = bv & 0xFF;
      output[i * 2 + 1] = (bv >> 8) & 0xFF;
    }
    return output;
  }

  // ===== Frame I/O =====

  List<Uint8List> _splitIntoFrames(Uint8List pcmData) {
    final frames = <Uint8List>[];
    final bytesPerFrame = _samplesPerFrame * 2;
    for (int offset = 0; offset + bytesPerFrame <= pcmData.length; offset += bytesPerFrame) {
      frames.add(Uint8List.sublistView(pcmData, offset, offset + bytesPerFrame));
    }
    return frames;
  }

  Uint8List _combineFrames(List<Map<String, dynamic>> frames, int originalLength) {
    // Per-frame size: 5 features + N sub-bands + 1 onset + 1 timbreIdx + 1 timbreResidual + 1 f0 + 1 voiced
    final extraBytes = 5; // onset(1) + timbreIdx(1) + timbreResidual(1) + f0(1) + voiced(1)
    const headerSize = 8;
    final frameBytes = 5 + subBandCount + extraBytes;
    final output = Uint8List(headerSize + frames.length * frameBytes);
    int off = 0;
    _writeUint32LE(output, off, originalLength); off += 4;
    _writeUint16LE(output, off, frames.length); off += 2;
    _writeUint16LE(output, off, subBandCount + (extraBytes << 8)); off += 2; // low=bandCount, high=extraBytes

    for (final f in frames) {
      output[off++] = f['rms']!;
      output[off++] = f['peak']!;
      output[off++] = f['dcOffset']!;
      output[off++] = f['spectral']!;
      output[off++] = f['zcr']!;
      for (final sb in f['subBands'] as List) output[off++] = sb as int;
      output[off++] = (f['onset'] as num).toInt();
      output[off++] = (f['timbreIdx'] as num).toInt();
      output[off++] = (f['timbreResidual'] as num).toInt();
      output[off++] = (f['f0'] as num).toInt();
      output[off++] = (f['voiced'] as num).toInt();
    }
    return output;
  }

  _ParsedFrames _parseFrames(Uint8List data) {
    int off = 0;
    final originalLength = _readUint32LE(data, off); off += 4;
    final frameCount = _readUint16LE(data, off); off += 2;
    final info = _readUint16LE(data, off); off += 2;
    final bandCount = info & 0xFF;
    final extraBytes = (info >> 8) & 0xFF;
    final frames = <Map<String, dynamic>>[];

    for (int i = 0; i < frameCount; i++) {
      final frame = <String, dynamic>{
        'rms': data[off++], 'peak': data[off++], 'dcOffset': data[off++],
        'spectral': data[off++], 'zcr': data[off++], 'subBands': <int>[],
      };
      final subs = frame['subBands'] as List<int>;
      for (int b = 0; b < bandCount; b++) subs.add(data[off++]);
      frame['onset'] = data[off++];
      frame['timbreIdx'] = data[off++];
      frame['timbreResidual'] = data[off++];
      frame['f0'] = data[off++];
      frame['voiced'] = data[off++];
      frames.add(frame);
    }
    return _ParsedFrames(frames, originalLength);
  }

  // ===== Utilities =====

  List<double> _bufferToSamples(Uint8List buffer) {
    final samples = List<double>.generate(buffer.length ~/ 2, (i) {
      final v = buffer[i * 2] | (buffer[i * 2 + 1] << 8);
      return v > 32767 ? (v - 65536).toDouble() : v.toDouble();
    });
    return samples;
  }

  double _calculateBitrate(int outBytes, int inBytes) => outBytes * 8 / 1000 / (inBytes / 2 / sampleRate);

  double _sqrt(double x) => x > 0 ? _pow(x, 0.5) : 0;
  double _pow(double x, double e) => x <= 0 ? 0 : _exp(e * _ln(x));
  double _exp(double x) { double r = 1, t = 1; for (int i = 1; i < 20; i++) { t *= x / i; r += t; } return r; }
  double _ln(double x) {
    if (x <= 0) return 0;
    double y = (x - 1) / (x + 1), r = 0, t = y;
    for (int i = 1; i < 50; i += 2) { r += t / i; t *= y * y; }
    return 2 * r;
  }
  double _log10(double x) => _ln(x) / _ln(10);
  double _sin(double x) {
    x = x % (2 * pi);
    double r = 0, t = x;
    for (int i = 1; i < 15; i += 2) { r += t; t *= -x * x / ((i + 1) * (i + 2)); }
    return r;
  }

  void _writeUint32LE(Uint8List b, int o, int v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; b[o + 2] = (v >> 16) & 0xFF; b[o + 3] = (v >> 24) & 0xFF; }
  void _writeUint16LE(Uint8List b, int o, int v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; }
  int _readUint32LE(Uint8List b, int o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
  int _readUint16LE(Uint8List b, int o) => b[o] | (b[o + 1] << 8);
  int get _trimmedFrames => _framesEncoded;

  CodecStats getStats() {
    final avgEnc = _framesEncoded > 0 ? (_encodeTime / _framesEncoded).toStringAsFixed(2) : '0';
    final avgDec = _framesDecoded > 0 ? (_decodeTime / _framesDecoded).toStringAsFixed(2) : '0';
    final cr = _totalInputBytes > 0 ? (_totalInputBytes / _totalOutputBytes).toStringAsFixed(1) + 'x' : 'N/A';
    return CodecStats(
      framesEncoded: _framesEncoded, framesDecoded: _framesDecoded,
      compressionRatio: cr, avgEncodeTime: '$avgEnc ms',
      avgDecodeTime: '$avgDec ms', targetBitrate: '$targetBitrate kbps',
      bands: subBandCount,
    );
  }

  DailyTraffic estimateDailyTraffic() => DailyTraffic(kbps: targetBitrate, mbpsPerDay: '${targetBitrate * 24}', gbPerDay: '${(targetBitrate * 24 / 8000).toStringAsFixed(2)}');

  void destroy() { _isReady = false; }
}

class EncodedFrame {
  final Uint8List data; final double bitrate; final int encodeTime; final double compressionRatio; final int frameCount;
  EncodedFrame({required this.data, required this.bitrate, required this.encodeTime, required this.compressionRatio, required this.frameCount});
}

class DecodedFrame {
  final Uint8List pcm; final int decodeTime; final int originalLength;
  DecodedFrame({required this.pcm, required this.decodeTime, required this.originalLength});
}

class CodecStats {
  final int framesEncoded, framesDecoded, bands;
  final String compressionRatio, avgEncodeTime, avgDecodeTime, targetBitrate;
  CodecStats({required this.framesEncoded, required this.framesDecoded, required this.compressionRatio, required this.avgEncodeTime, required this.avgDecodeTime, required this.targetBitrate, this.bands = 4});
}

class DailyTraffic {
  final int kbps; final String mbpsPerDay, gbPerDay;
  DailyTraffic({required this.kbps, required this.mbpsPerDay, required this.gbPerDay});
}

class _ParsedFrames {
  final List<Map<String, dynamic>> frames; final int originalLength;
  _ParsedFrames(this.frames, this.originalLength);
}
