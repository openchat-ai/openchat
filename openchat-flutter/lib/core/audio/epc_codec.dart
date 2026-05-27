import 'dart:math';
import 'dart:typed_data';
import 'harmonic_codebook.dart';
import 'epc_tag.dart';
import 'wavetable_synth.dart';

// ===== Math helpers =====
double _pi = 3.141592653589793;
double _sin(double x) { x = x % (2 * _pi); double r = 0, t = x; for (int i = 1; i < 15; i += 2) { r += t; t *= -x * x / ((i + 1) * (i + 2)); } return r; }
double _sqrt(double x) => x > 0 ? _pow(x, 0.5) : 0;
double _pow(double x, double e) => x <= 0 ? 0 : _exp(e * _ln(x));
double _exp(double x) { double r = 1, t = 1; for (int i = 1; i < 20; i++) { t *= x / i; r += t; } return r; }
double _ln(double x) { if (x <= 0) return 0; double y = (x - 1) / (x + 1), r = 0, t = y; for (int i = 1; i < 50; i += 2) { r += t / i; t *= y * y; } return 2 * r; }
double _log10(double x) => _ln(x) / _ln(10);

// ===== FFT (in-place, radix-2, decimation-in-time) =====
void _fft(Float64List re, Float64List im) {
  int n = re.length;
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = 2 * _pi / len, wR = cos(ang), wI = -sin(ang);
    for (int i = 0; i < n; i += len) {
      double cR = 1, cI = 0;
      for (int j = 0; j < len ~/ 2; j++) {
        int idx = i + j;
        double uR = re[idx], uI = im[idx];
        double vR = re[idx + len ~/ 2] * cR - im[idx + len ~/ 2] * cI;
        double vI = re[idx + len ~/ 2] * cI + im[idx + len ~/ 2] * cR;
        re[idx] = uR + vR; im[idx] = uI + vI;
        re[idx + len ~/ 2] = uR - vR; im[idx + len ~/ 2] = uI - vI;
        double tR = cR * wR - cI * wI; cI = cR * wI + cI * wR; cR = tR;
      }
    }
  }
}

// ===== Pre-allocated FFT buffers =====
const int _fftSize = 2048;
final _fftRe = Float64List(_fftSize);
final _fftIm = Float64List(_fftSize);
final _fftMag = Float64List(_fftSize ~/ 2);
final _fftHp = Float64List(_fftSize ~/ 2);
final _fftWin = Float64List(_fftSize); // Hanning window, initialized once
bool _fftWinReady = false;

void _initFftWin() {
  if (_fftWinReady) return;
  for (int i = 0; i < _fftSize; i++) _fftWin[i] = 0.5 * (1 - cos(2 * _pi * i / (_fftSize - 1)));
  _fftWinReady = true;
}

// ===== HPS Multi-F0 Detection (zero-alloc after warmup) =====
List<Map<String, dynamic>> _hpsMultiF0(List<double> samples, int sr) {
  _initFftWin();
  int halfN = _fftSize ~/ 2;
  _fftRe.fillRange(0, _fftSize, 0);
  _fftIm.fillRange(0, _fftSize, 0);

  // Window + copy
  int copyLen = _fftSize < samples.length ? _fftSize : samples.length;
  for (int i = 0; i < copyLen; i++) _fftRe[i] = samples[i] * _fftWin[i];

  _fft(_fftRe, _fftIm);

  _fft(_fftRe, _fftIm);

  // Magnitude
  for (int i = 0; i < halfN; i++) _fftMag[i] = sqrt(_fftRe[i] * _fftRe[i] + _fftIm[i] * _fftIm[i]);

  // HPS: product of 4 downsampled spectra
  for (int i = 0; i < halfN; i++) {
    double p = _fftMag[i];
    if (p < 1) { _fftHp[i] = 0; continue; }
    for (int h = 2; h <= 4; h++) {
      int idx = (i * h).round();
      if (idx >= halfN) break;
      p *= _fftMag[idx];
    }
    _fftHp[i] = p;
  }

  // Find peaks in 40-1500Hz range
  int minBin = (halfN * 40 / sr).round();
  int maxBin = (halfN * 1500 / sr).round();
  var peaks = <MapEntry<int, double>>[];
  double maxPeakVal = 0;
  for (int i = minBin + 1; i < maxBin - 1; i++) {
    if (_fftHp[i] > _fftHp[i - 1] && _fftHp[i] > _fftHp[i + 1] && _fftHp[i] > 0) {
      peaks.add(MapEntry(i, _fftHp[i]));
      if (_fftHp[i] > maxPeakVal) maxPeakVal = _fftHp[i];
    }
  }
  double threshold = maxPeakVal * 0.2;
  peaks.removeWhere((p) => p.value < threshold);
  peaks.sort((a, b) => b.value.compareTo(a.value));

  var result = <Map<String, dynamic>>[];
  for (var p in peaks) {
    double freq = p.key * sr / _fftSize;
    bool dup = result.any((r) {
      double rf = r['freq'] as double;
      double ratio = freq > rf ? freq / rf : rf / freq;
      return (ratio - ratio.round()).abs() < 0.08;
    });
    if (!dup) {
      double corr = p.value / peaks[0].value;
      if (corr > 1) corr = 1;
      result.add({'freq': freq, 'corr': corr});
      if (result.length >= 2) break;
    }
  }
  return result;
}

// ===== Quick check: correlation at one lag =====
double _quickCheck(List<double> samples, int lag, int half) {
  double c = 0, n = 0;
  for (int i = 0; i < half; i++) {
    c += samples[i] * samples[i + lag];
    n += samples[i] * samples[i] + samples[i + lag] * samples[i + lag];
  }
  return n > 0 ? c / sqrt(n) : 0;
}

// ===== Harmonic extraction from FFT bin =====
int _extractHarmonic(List<double> samples, int sr, double freq, int harmonic, int lim) {
  double hz = freq * (harmonic + 1);
  int fftSize = 2048;
  int bin = (hz * fftSize / sr).round();
  if (bin < 1 || bin >= fftSize ~/ 2) return 0;
  double cR = 0, cI = 0;
  int n = samples.length < lim ? samples.length : lim;
  for (int i = 0; i < n; i++) {
    double ang = 2 * _pi * bin * i / fftSize;
    cR += samples[i] * cos(ang);
    cI -= samples[i] * sin(ang);
  }
  return (sqrt(cR * cR + cI * cI) / n * 2).round();
}

// ===== Response Frame: BB|01|CC|PL|EPCs|Chk|7E =====
class ResponseFrame {
  final List<Uint8List> epcData; // raw 12-byte EPCs

  ResponseFrame(this.epcData);

  Uint8List pack() {
    int dataLen = epcData.length * 12;
    var f = Uint8List(7 + dataLen);
    int o = 0;
    f[o++] = 0xBB; f[o++] = 0x01; f[o++] = 0xCC;
    f[o++] = (dataLen >> 8) & 0xFF; f[o++] = dataLen & 0xFF;
    for (var e in epcData) { f.setRange(o, o + 12, e); o += 12; }
    int ck = 0; for (int i = 1; i < o; i++) ck = (ck + f[i]) & 0xFF;
    f[o++] = ck; f[o++] = 0x7E;
    return f;
  }
}

// ===== EpcCodec =====
class EpcCodec {
  final int sampleRate;
  final int frameSize; // ms
  bool _isReady = false;
  int _framesEncoded = 0, _framesDecoded = 0;
  int _totalInputBytes = 0, _totalOutputBytes = 0;

  // Track state (encode side)
  final List<double> _analysisBuf = [];
  final Map<int, _TrackState> _activeTracks = {};
  int _nextTrackId = 0, _frameCount = 0;

  EpcCodec({this.sampleRate = 24000, this.frameSize = 20});

  int get samplesPerFrame => (sampleRate * frameSize) ~/ 1000;
  bool get isReady => _isReady;

  Future<void> initialize() async { _isReady = true; }

  Future<EpcEncoded> encode(Uint8List pcmData) async {
    if (!_isReady) throw Exception('Codec not initialized');
    var sw = Stopwatch()..start();
    int sf = samplesPerFrame;
    int sfB = sf * 2;
    int half = sf ~/ 2;
    var responseFrames = <Uint8List>[];

    for (int off = 0; off + sfB <= pcmData.length; off += sfB) {
      // Read 20ms samples
      var samples = List<double>.generate(sf, (i) {
        int v = pcmData[off + i * 2] | (pcmData[off + i * 2 + 1] << 8);
        return (v > 32767 ? v - 65536 : v).toDouble();
      });
      // Silence gate: skip processing if RMS < 300 (quiet background)
      double sigRms = sqrt(samples.fold(0.0, (s, v) => s + v * v) / samples.length);
      if (sigRms < 300) {
        _frameCount++;
        responseFrames.add(ResponseFrame([]).pack());
        continue;
      }
      _analysisBuf.addAll(samples);
      while (_analysisBuf.length > 2048) _analysisBuf.removeAt(0);

      var frameEpcs = <Uint8List>[];

      // 1. Quick check on existing tracks
      var toRemove = <int>[];
      for (var entry in _activeTracks.entries.toList()) {
        int tid = entry.key;
        var t = entry.value;
        double corr = _quickCheck(samples, (sampleRate / t.freq).round(), half);
        if (corr > 0.3) {
          t.stale = 0;
          double sigRms = sqrt(samples.fold(0.0, (s, v) => s + v * v) / samples.length);
          int rmsQ = (sigRms / 32768 * 255).round().clamp(0, 255);
          var tag = EpcTag(type: EpcTagType.spectrum);
          tag.trackId = tid;
          tag.codebookIdx = t.cbIdx;
          tag.midiNote = t.note;
          tag.cent = t.cent;
          tag.onsetFlag = 0;
          tag.velocity = (corr * 127).round();
          tag.rms = rmsQ;
          frameEpcs.add(tag.pack());
        } else {
          t.stale++;
          if (t.stale > 3) {
            toRemove.add(tid);
            var tag = EpcTag(type: EpcTagType.spectrum);
            tag.trackId = tid;
            tag.onsetFlag = 0;
            tag.velocity = 0;
            tag.rms = 0; // vel=0 + rms=0 = NoteOff marker
            frameEpcs.add(tag.pack());
          }
        }
      }
      for (var tid in toRemove) _activeTracks.remove(tid);

      // 2. HPS analysis every 4 frames (only when buffer has 2048 samples)
      if (_analysisBuf.length >= 2048 && _frameCount % 4 == 0) {
      var tones = _hpsMultiF0(_analysisBuf, sampleRate);

        // Extract harmonics for each valid F0
        for (var t in tones) {
          double f0 = t['freq'] as double;
          double corr = t['corr'] as double;
          // Verify with 20ms quickCheck
          if (_quickCheck(samples, (sampleRate / f0).round(), half) < 0.3) continue;
          // Check if harmonic of existing track
          bool dup = _activeTracks.values.any((at) {
            double r = f0 > at.freq ? f0 / at.freq : at.freq / f0;
            return (r - r.round()).abs() < 0.05;
          });
          if (dup) continue;

          // Extract 8 harmonics (use analysis buffer)
          var harms = List<int>.generate(8, (h) => _extractHarmonic(_analysisBuf, sampleRate, f0, h, _analysisBuf.length));
          double maxH = harms.cast<num>().reduce((a, b) => a > b ? a : b).toDouble();
          if (maxH > 0) harms = harms.map((a) => (a / maxH * 255).round().clamp(0, 255)).toList();

          // Codebook match
          int cbIdx = HarmonicCodebook.findNearest(harms);
          double midi = 12 * (log(f0 / 440) / log(2)) + 69;
          int note = midi.round().clamp(0, 127);
          int cent = ((midi - note) * 100).round().clamp(-32, 31);

          double sigRms = sqrt(samples.fold(0.0, (s, v) => s + v * v) / samples.length);
          int rmsQ = (sigRms / 32768 * 255).round().clamp(0, 255);

          int tid = _nextTrackId % 15;
          _activeTracks[tid] = _TrackState(freq: f0, cbIdx: cbIdx, note: note, cent: cent, stale: 0);
          _nextTrackId++;

          var tag = EpcTag(type: EpcTagType.spectrum);
          tag.trackId = tid;
          tag.codebookIdx = cbIdx;
          tag.midiNote = note;
          tag.cent = cent;
          tag.onsetFlag = 1; // NoteOn
          tag.velocity = (corr * 127).round();
          tag.rms = rmsQ;
          frameEpcs.add(tag.pack());
        }
      }

      responseFrames.add(ResponseFrame(frameEpcs).pack());
      _frameCount++;
    }

    // Concatenate
    int total = responseFrames.fold(0, (s, f) => s + f.length);
    var out = Uint8List(total);
    int off = 0;
    for (var f in responseFrames) { out.setRange(off, off + f.length, f); off += f.length; }

    sw.stop();
    _framesEncoded += (pcmData.length ~/ sfB);
    _totalInputBytes += pcmData.length;
    _totalOutputBytes += out.length;
    return EpcEncoded(data: out, frameCount: (pcmData.length ~/ sfB));
  }

  Future<EpcDecoded> decode(Uint8List epcData) async {
    if (!_isReady) throw Exception('Codec not initialized');
    var sw = Stopwatch()..start();
    int n = samplesPerFrame;
    var active = <int, _SynthTone>{};
    var decodedFrames = <Uint8List>[];

    int off = 0;
    while (off + 7 <= epcData.length) {
      if (epcData[off] != 0xBB) break;
      int dataLen = (epcData[off + 3] << 8) | epcData[off + 4];
      int frameLen = 7 + dataLen;
      if (off + frameLen > epcData.length) break;

      // Parse EPCs
      for (int eo = off + 5; eo < off + 5 + dataLen; eo += 12) {
        var tag = EpcTag.unpack(epcData.sublist(eo, eo + 12));
        if (tag.velocity == 0 && tag.rms == 0) { active.remove(tag.trackId); continue; }
        double freq = 440 * pow(2, (tag.midiNote + tag.cent / 100 - 69) / 12) as double;
        if (tag.rms > 0) {
          active[tag.trackId] = _SynthTone(
            freq: freq, harmonics: tag.harmonics, rms: tag.rms, velocity: tag.velocity,
          );
        }
      }

      // Synthesize 20ms using wavetable (cache by codebook hash)
      var pcm = Uint8List(n * 2);
      var cachedWt = <int, Float64List>{};
      for (var entry in active.entries) {
        var tone = entry.value;
        double amp = tone.rms / 255 * tone.velocity / 127;
        if (amp < 0.001) continue;
        int key = tone.freq.round() * 31 + tone.harmonics[0];
        var wt = cachedWt.putIfAbsent(key, () => WavetableSynth.render(tone.harmonics));
        WavetableSynth.mixInto(pcm, 0, wt, sampleRate, tone.freq, amp * 0.3, n);
      }
      decodedFrames.add(pcm);
      off += frameLen;
    }

    var out = Uint8List.fromList(decodedFrames.expand((f) => f).toList());
    sw.stop();
    _framesDecoded += decodedFrames.length;
    return EpcDecoded(pcm: out, decodeTime: sw.elapsedMilliseconds);
  }

  Map<String, dynamic> getStats() {
    double cr = _totalInputBytes > 0 ? _totalInputBytes / _totalOutputBytes : 0;
    return {
      'framesEncoded': _framesEncoded,
      'framesDecoded': _framesDecoded,
      'compressionRatio': cr.toStringAsFixed(1) + 'x',
    };
  }

  void destroy() { _isReady = false; }
}

class _TrackState {
  double freq;
  int cbIdx, note, cent, stale;
  _TrackState({required this.freq, required this.cbIdx, required this.note, required this.cent, this.stale = 0});
}

class _SynthTone {
  final double freq;
  List<int> harmonics;
  int rms, velocity;
  _SynthTone({required this.freq, required this.harmonics, required this.rms, required this.velocity});
}

class EpcEncoded {
  final Uint8List data;
  final int frameCount;
  EpcEncoded({required this.data, required this.frameCount});
}

class EpcDecoded {
  final Uint8List pcm;
  final int decodeTime;
  EpcDecoded({required this.pcm, required this.decodeTime});
}
