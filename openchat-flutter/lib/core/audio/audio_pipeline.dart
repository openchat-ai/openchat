import 'dart:math';
import 'dart:typed_data';
import 'audio_models.dart';

class AudioPipeline {
  final int sampleRate;
  final int channels;
  final int frameSize;

  bool _rnnoiseReady = false;
  bool _enabledRNNOISE = true;
  bool _enabledVAD = false;
  bool _enabledAGC = false;
  bool _enabledHighPass = true;

  int _totalFrames = 0;
  int _speechFrames = 0;
  int _noiseFrames = 0;
  double _totalSpeechTime = 0;
  int _rnnoiseProcessingTime = 0;

  AudioPipeline({
    this.sampleRate = 48000,
    this.channels = 1,
    this.frameSize = 480,
  });

  Future<void> initialize() async {
    _rnnoiseReady = true;
  }

  bool get rnnoiseReady => _rnnoiseReady;

  Future<ProcessedFrame> processFrame(Uint8List pcmData) async {
    final frame = ProcessedFrame(
      data: Uint8List.fromList(pcmData),
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );

    if (_enabledHighPass) {
      frame.data = _applyHighPass(frame.data);
    }

    if (_enabledRNNOISE) {
      final rnnoiseResult = await _applyRNNoise(frame.data);
      frame.data = rnnoiseResult.data;
      frame.vad = rnnoiseResult.vad;
    }

    if (_enabledAGC) {
      frame.data = _applyAGC(frame.data);
    }

    if (frame.vad == null) {
      final vadResult = _detectSpeech(frame.data);
      frame.isSpeech = vadResult.isSpeech;
      frame.speechProbability = vadResult.probability;
    } else {
      frame.isSpeech = frame.vad! > 0.5;
      frame.speechProbability = frame.vad!;
    }

    _updateStats(frame);

    return frame;
  }

  Future<_RNNoiseResult> _applyRNNoise(Uint8List pcmData) async {
    final noiseLevel = _estimateNoiseLevel(pcmData);
    double vad = 0;

    if (noiseLevel > 0.1) {
      final reduction = (noiseLevel * 0.5).clamp(0.0, 0.8);
      final reduced = _applyNoiseReduction(pcmData, reduction);
      return _RNNoiseResult(data: reduced, vad: vad);
    }

    return _RNNoiseResult(data: pcmData, vad: vad);
  }

  Uint8List _applyHighPass(Uint8List pcmData) {
    const fc = 80;
    final dt = 1 / sampleRate;
    final rc = 1 / (2 * pi * fc);
    final alpha = rc / (rc + dt);

    final output = Uint8List(pcmData.length);
    int prevInput = 0;
    double prevOutput = 0;

    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = _readInt16LE(pcmData, i);
      final filtered = alpha * prevOutput + alpha * (sample - prevInput);
      _writeInt16LE(output, i, filtered.round());
      prevInput = sample;
      prevOutput = filtered;
    }

    return output;
  }

  double _estimateNoiseLevel(Uint8List pcmData) {
    double sum = 0;
    int count = 0;

    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = _readInt16LE(pcmData, i);
      sum += sample * sample;
      count++;
    }

    final rms = sqrt(sum / count);
    return (rms / 32768).clamp(0.0, 1.0);
  }

  Uint8List _applyNoiseReduction(Uint8List pcmData, double reduction) {
    final factor = 1 - reduction * 0.3;
    final output = Uint8List(pcmData.length);

    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = _readInt16LE(pcmData, i);
      final reduced = (sample * factor).round().clamp(-32768, 32767);
      _writeInt16LE(output, i, reduced);
    }

    return output;
  }

  Uint8List _applyAGC(Uint8List pcmData) {
    final rms = _calculateRMS(pcmData);
    const targetRMS = 8000;

    if (rms < 100) return pcmData;

    final gain = targetRMS / rms;
    final clampedGain = gain.clamp(0.0, 10.0);

    final output = Uint8List(pcmData.length);
    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = _readInt16LE(pcmData, i) * clampedGain;
      final clamped = sample.round().clamp(-32768, 32767);
      _writeInt16LE(output, i, clamped);
    }

    return output;
  }

  _VADResult _detectSpeech(Uint8List pcmData) {
    final energy = _calculateEnergy(pcmData);
    final zeroCrossings = _calculateZeroCrossings(pcmData);

    const minEnergy = 300;
    const maxZCR = 80;
    const minZCR = 8;

    if (energy < minEnergy) {
      return _VADResult(isSpeech: false, probability: 0);
    }

    if (zeroCrossings < minZCR) {
      return _VADResult(isSpeech: false, probability: 0.1);
    }

    if (zeroCrossings > maxZCR) {
      return _VADResult(isSpeech: false, probability: 0.2);
    }

    final energyProb = ((energy - minEnergy) / 5000).clamp(0.0, 1.0);
    final zcrProb = 1 - (zeroCrossings - minZCR) / (maxZCR - minZCR);

    final probability = ((energyProb * 0.5 + zcrProb * 0.5) * 10).round() / 10;
    final isSpeech = probability > 0.3;

    return _VADResult(isSpeech: isSpeech, probability: probability);
  }

  double _calculateRMS(Uint8List pcmData) {
    double sum = 0;
    int count = 0;

    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = _readInt16LE(pcmData, i);
      sum += sample * sample;
      count++;
    }

    return sqrt(sum / count);
  }

  double _calculateEnergy(Uint8List pcmData) {
    double energy = 0;
    int count = 0;

    for (int i = 0; i < pcmData.length; i += 2) {
      energy += _readInt16LE(pcmData, i).abs();
      count++;
    }

    return energy / count;
  }

  int _calculateZeroCrossings(Uint8List pcmData) {
    int crossings = 0;
    int prev = 0;

    for (int i = 0; i < pcmData.length; i += 2) {
      final sample = _readInt16LE(pcmData, i);
      if ((prev < 0 && sample >= 0) || (prev >= 0 && sample < 0)) {
        crossings++;
      }
      prev = sample;
    }

    return crossings;
  }

  void _updateStats(ProcessedFrame frame) {
    _totalFrames++;
    if (frame.isSpeech == true) {
      _speechFrames++;
      _totalSpeechTime += frameSize / sampleRate;
    } else {
      _noiseFrames++;
    }
  }

  AudioPipelineStats getStats() {
    final total = _totalFrames > 0 ? _totalFrames : 1;
    return AudioPipelineStats(
      totalFrames: _totalFrames,
      speechFrames: _speechFrames,
      noiseFrames: _noiseFrames,
      speechRatio: ((_speechFrames / total) * 100).toStringAsFixed(1) + '%',
      totalSpeechTime: _totalSpeechTime.toStringAsFixed(1) + 's',
      vadEnabled: _enabledVAD,
      rnnoiseEnabled: _enabledRNNOISE,
      rnnoiseReady: _rnnoiseReady,
      rnnoiseAvgTime: _totalFrames > 0
          ? (_rnnoiseProcessingTime / _totalFrames).toStringAsFixed(2) + 'ms'
          : 'N/A',
    );
  }

  int _readInt16LE(Uint8List buffer, int offset) {
    final value = buffer[offset] | (buffer[offset + 1] << 8);
    return value > 32767 ? value - 65536 : value;
  }

  void _writeInt16LE(Uint8List buffer, int offset, int value) {
    value = value.clamp(-32768, 32767);
    buffer[offset] = value & 0xFF;
    buffer[offset + 1] = (value >> 8) & 0xFF;
  }

  void destroy() {
    _rnnoiseReady = false;
  }
}

class _RNNoiseResult {
  final Uint8List data;
  final double vad;
  _RNNoiseResult({required this.data, required this.vad});
}

class _VADResult {
  final bool isSpeech;
  final double probability;
  _VADResult({required this.isSpeech, required this.probability});
}
