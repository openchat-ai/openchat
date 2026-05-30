import 'dart:math';
import 'dart:typed_data';
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

// F0 harmonic band centers — 7 bands at F0×1..F0×7 (extracted per-frame, no fixed bounds)

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

// ===== YIN: Autocorrelation-based F0 detection =====
// Returns list of {freq, conf} — single element for monophonic
List<Map<String, dynamic>> _yinF0(List<double> samples, int sr) {
  int len = samples.length;
  int maxLag = (sr / 40).round();   // 40Hz lower bound
  int minLag = (sr / 2000).round();  // 2000Hz upper bound
  if (maxLag > len ~/ 2) maxLag = len ~/ 2;
  if (minLag < 2) minLag = 2;
  if (maxLag <= minLag) return [];
  int n = maxLag; // analysis window = maxLag samples

  // Difference function
  var diff = Float64List(maxLag);
  for (int tau = 0; tau < maxLag; tau++) {
    double d = 0;
    for (int i = 0; i < n; i++) {
      if (i + tau >= len) break;
      double dv = samples[i] - samples[i + tau];
      d += dv * dv;
    }
    diff[tau] = d;
  }

  // Cumulative mean normalized difference
  var cmnd = Float64List(maxLag);
  cmnd[0] = 1;
  double runningSum = 0;
  for (int tau = 1; tau < maxLag; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum > 0 ? diff[tau] * tau / runningSum : 1;
  }

  // Find first minimum below threshold
  double threshold = 0.15;
  int bestLag = 0;
  double bestVal = 1;
  for (int tau = minLag; tau < maxLag - 1; tau++) {
    if (cmnd[tau] < cmnd[tau - 1] && cmnd[tau] < cmnd[tau + 1]) {
      if (cmnd[tau] < threshold) { bestLag = tau; bestVal = cmnd[tau]; break; }
      if (cmnd[tau] < bestVal) { bestLag = tau; bestVal = cmnd[tau]; }
    }
  }
  if (bestLag < minLag) return [];

  // Parabolic interpolation
  double refinedLag = bestLag.toDouble();
  if (bestLag > 0 && bestLag < maxLag - 1) {
    double alpha = cmnd[bestLag - 1], beta = cmnd[bestLag], gamma = cmnd[bestLag + 1];
    double denom = alpha - 2 * beta + gamma;
    if (denom.abs() > 1e-12) refinedLag = bestLag + (alpha - gamma) / (2 * denom);
  }

  double freq = sr / refinedLag;
  double conf = max(0.0, 1.0 - bestVal);
  if (freq > 2000 || freq < 30) return [];
  return [{'freq': freq, 'corr': conf}];
}

// ===== Spectral Peak Tracking (from FFT magnitude) =====
// Returns list of {freq, conf} — up to 3 simultaneous pitches
List<Map<String, dynamic>> _peakTrackF0(List<double> samples, int sr) {
  _initFftWin();
  int halfN = _fftSize ~/ 2;
  _fftRe.fillRange(0, _fftSize, 0);
  _fftIm.fillRange(0, _fftSize, 0);
  int copyLen = _fftSize < samples.length ? _fftSize : samples.length;
  for (int i = 0; i < copyLen; i++) _fftRe[i] = samples[i] * _fftWin[i];
  _fft(_fftRe, _fftIm);
  for (int i = 0; i < halfN; i++) _fftMag[i] = sqrt(_fftRe[i] * _fftRe[i] + _fftIm[i] * _fftIm[i]);

  // Find spectral peaks with parabolic interpolation
  var rawPeaks = <Map<String, dynamic>>[];
  for (int i = 2; i < halfN - 2; i++) {
    if (_fftMag[i] > _fftMag[i - 1] && _fftMag[i] > _fftMag[i - 2] &&
        _fftMag[i] > _fftMag[i + 1] && _fftMag[i] > _fftMag[i + 2]) {
      double alpha = _fftMag[i - 1], beta = _fftMag[i], gamma = _fftMag[i + 1];
      double denom = alpha - 2 * beta + gamma;
      double fineIdx = i.toDouble();
      if (denom.abs() > 1e-12) fineIdx = i + (alpha - gamma) / (2 * denom);
      double freq = fineIdx * sr / _fftSize;
      if (freq > 30 && freq < 8000) {
        rawPeaks.add({'freq': freq, 'amp': _fftMag[i]});
      }
    }
  }
  if (rawPeaks.isEmpty) return [];
  rawPeaks.sort((a, b) => (b['amp'] as double).compareTo(a['amp'] as double));
  double maxAmp = rawPeaks[0]['amp'] as double;
  var strongPeaks = rawPeaks.where((p) => (p['amp'] as double) > maxAmp * 0.1).toList();

  var candidates = <Map<String, dynamic>>[];
  for (var peak in strongPeaks) {
    double pf = peak['freq'] as double;
    // Harmonic support score: check if harmonics have energy
    double harmonicScore = 0;
    for (int h = 2; h <= 8; h++) {
      double hf = pf * h;
      for (var p2 in rawPeaks) {
        if ((p2['freq'] as double - hf).abs() / hf < 0.05 &&
            (p2['amp'] as double) > (peak['amp'] as double) * 0.05) {
          harmonicScore += (p2['amp'] as double) / maxAmp;
          break;
        }
      }
    }
    // Sub-harmonic check: current peak might be a harmonic of a lower fundamental
    double subScore = 0;
    for (int h = 2; h <= 4; h++) {
      double sf = pf / h;
      for (var p2 in rawPeaks) {
        if ((p2['freq'] as double - sf).abs() / sf < 0.05 &&
            (p2['amp'] as double) > (peak['amp'] as double) * 0.2) {
          subScore += 1;
          break;
        }
      }
    }
    double conf = min(1.0, (harmonicScore + subScore * 0.5) / 3);
    candidates.add({'freq': pf, 'conf': conf, 'subScore': subScore});
  }

  candidates.sort((a, b) => (b['conf'] as double).compareTo(a['conf'] as double));
  var result = <Map<String, dynamic>>[];
  for (var c in candidates) {
    double cf = c['freq'] as double;
    bool dup = result.any((r) {
      double ratio = cf > (r['freq'] as double) ? cf / (r['freq'] as double) : (r['freq'] as double) / cf;
      return (ratio - ratio.round()).abs() < 0.05;
    });
    if (!dup && (c['conf'] as double) > 0.15) {
      result.add({'freq': cf, 'corr': c['conf']});
      if (result.length >= 3) break;
    }
  }
  return result;
}

// ===== Fusion detector: YIN + PeakTrack ensemble =====
// YIN primary (best single-note), PeakTrack supplementary (chords)
List<Map<String, dynamic>> _fusionF0(List<double> samples, int sr) {
  var yin = _yinF0(samples, sr);
  var peak = _peakTrackF0(samples, sr);

  // Reject YIN GCD false positives: if PeakTrack detects notes
  // at multiples of YIN's frequency, YIN is likely detecting GCD of chord
  if (yin.isNotEmpty && peak.isNotEmpty) {
    double yinF = yin[0]['freq'] as double;
    bool yinIsGcd = false;
    for (var p in peak) {
      double ratio = (p['freq'] as double) / yinF;
      if (ratio > 3 && (ratio - ratio.round()).abs() < 0.05) {
        yinIsGcd = true; break;
      }
    }
    if (yinIsGcd) yin = [];
  }

  // Merge results by frequency proximity
  var merged = <Map<String, dynamic>>[];
  for (var n in yin) {
    n['src'] = 'yin' as dynamic;
    merged.add(n);
  }
  for (var n in peak) {
    n['src'] = 'peak' as dynamic;
    bool found = false;
    for (var m in merged) {
      double ratio = (n['freq'] as double) > (m['freq'] as double)
          ? (n['freq'] as double) / (m['freq'] as double)
          : (m['freq'] as double) / (n['freq'] as double);
      if (ratio < 1.03) { found = true; break; }
    }
    if (!found) merged.add(n);
  }

  var result = <Map<String, dynamic>>[];
  for (var m in merged) {
    double corr = (m['corr'] ?? m['conf'] ?? 0.0) as double;
    String src = m['src'] as String;
    bool yinDetected = yin.any((y) => ((y['freq'] as double) / (m['freq'] as double)).clamp(0.97, 1.03) == (y['freq'] as double) / (m['freq'] as double));
    for (var y in yin) {
      double ratio = (m['freq'] as double) > (y['freq'] as double)
          ? (m['freq'] as double) / (y['freq'] as double)
          : (y['freq'] as double) / (m['freq'] as double);
      if (ratio < 1.03) { yinDetected = true; break; }
    }
    bool peakDetected = false;
    for (var p in peak) {
      double ratio = (m['freq'] as double) > (p['freq'] as double)
          ? (m['freq'] as double) / (p['freq'] as double)
          : (p['freq'] as double) / (m['freq'] as double);
      if (ratio < 1.03) { peakDetected = true; break; }
    }
    double finalCorr = corr;
    if (yinDetected && peakDetected) finalCorr = min(1.0, corr + 0.2);
    if (src == 'peak' && !yinDetected) finalCorr *= 0.8;
    result.add({'freq': m['freq'], 'corr': finalCorr});
  }

  result.sort((a, b) => (b['corr'] as double).compareTo(a['corr'] as double));
  return result.take(3).toList();
}

// ===== Harmonic extraction from FFT bin =====
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
          tag.midiNote = t.note;
          tag.onsetFlag = 0;
          tag.velocity = (corr * 127).round();
          tag.rms = rmsQ;
          for (int i = 0; i < 7 && i < t.bands.length; i++) tag.subBands[i] = t.bands[i];
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

      // 2. Fusion analysis every 4 frames (YIN + PeakTrack ensemble)
      if (_analysisBuf.length >= 2048 && _frameCount % 4 == 0) {
      var tones = _fusionF0(_analysisBuf, sampleRate);

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

          // Extract energy at F0 harmonics (7 harmonic bands)
          var bands = List<int>.generate(7, (h) {
            double hz = f0 * (h + 1);
            int binCenter = (hz * _fftSize / sampleRate).round();
            int binStart = (binCenter - 1).clamp(0, _fftSize ~/ 2 - 1);
            int binEnd = (binCenter + 1).clamp(0, _fftSize ~/ 2);
            double energy = 0;
            for (int bin = binStart; bin < binEnd; bin++) energy += _fftMag[bin];
            int val = (energy / 32768 * 255).round().clamp(0, 255);
            return val;
          });
          double midi = 12 * (log(f0 / 440) / log(2)) + 69;
          int note = midi.round().clamp(0, 127);

          double sigRms = sqrt(samples.fold(0.0, (s, v) => s + v * v) / samples.length);
          int rmsQ = (sigRms / 32768 * 255).round().clamp(0, 255);

          int tid = _nextTrackId % 15;
          _activeTracks[tid] = _TrackState(freq: f0, note: note, bands: List.from(bands), stale: 0, instrument: 0);
          _nextTrackId++;

          var tag = EpcTag(type: EpcTagType.spectrum);
          tag.trackId = tid;
          tag.instrument = 0;
          tag.midiNote = note;
          tag.onsetFlag = 1;
          tag.velocity = (corr * 127).round();
          tag.rms = rmsQ;
          for (int i = 0; i < 7 && i < bands.length; i++) tag.subBands[i] = bands[i];
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

    // Estimate total samples: count frames from RF headers
    int totalFrames = 0;
    int tempOff = 0;
    while (tempOff + 7 <= epcData.length) {
      if (epcData[tempOff] != 0xBB) break;
      int dataLen = (epcData[tempOff + 3] << 8) | epcData[tempOff + 4];
      int frameLen = 7 + dataLen;
      if (tempOff + frameLen > epcData.length) break;
      totalFrames += dataLen ~/ 12;
      tempOff += frameLen;
    }
    var out = Uint8List(totalFrames * n * 2);
    int outSamples = 0;

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
        double freq = 440 * pow(2, (tag.midiNote - 69) / 12) as double;
        if (tag.rms > 0) {
          active[tag.trackId] = _SynthTone(
            freq: freq, subBands: List.from(tag.subBands), rms: tag.rms, velocity: tag.velocity, instrument: tag.instrument,
          );
        }
      }

      // Synthesize 20ms into pre-allocated buffer at cumulative offset
      for (var tone in active.values) {
        VocoderSynth.mixInto(out, outSamples, tone.subBands, sampleRate, tone.freq, tone.rms.toDouble(), tone.velocity.toDouble(), n, instrument: tone.instrument);
      }
      outSamples += n;
      off += frameLen;
    }

    out = out.sublist(0, outSamples * 2);
    sw.stop();
    _framesDecoded += outSamples ~/ n;
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
  int note, stale, instrument;
  List<int> bands;
  _TrackState({required this.freq, required this.note, required this.bands, this.stale = 0, this.instrument = 0});
}

class _SynthTone {
  final double freq;
  final List<int> subBands;
  int rms, velocity, instrument;
  _SynthTone({required this.freq, required this.subBands, required this.rms, required this.velocity, this.instrument = 0});
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
