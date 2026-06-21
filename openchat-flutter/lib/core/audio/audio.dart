import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' as math;
import 'dart:typed_data';
import '../api/qiniu_direct_client.dart';

/// ===== lmdn_mdct.dart =====
const int _n = 96;
const int _bands = 16;
const int _fftSize = 2048;

Float64List? _win;
Float64List? _tab;
Float64List? _iTab;
bool _tablesReady = false;

void initMdctTables() {
  if (_tablesReady) return;
  _win = Float64List(2 * _n);
  _tab = Float64List(_n * 2 * _n);
  _iTab = Float64List(2 * _n * _n);
  for (int i = 0; i < 2 * _n; i++) {
    _win![i] = math.sin(math.pi * (i + 0.5) / (2 * _n));
  }
  for (int k = 0; k < _n; k++) {
    for (int n = 0; n < 2 * _n; n++) {
      _tab![k * 2 * _n + n] = math.cos(math.pi / _n * (n + 0.5 + _n / 2) * (k + 0.5));
    }
  }
  for (int n = 0; n < 2 * _n; n++) {
    for (int k = 0; k < _n; k++) {
      _iTab![n * _n + k] = math.cos(math.pi / _n * (n + 0.5 + _n / 2) * (k + 0.5));
    }
  }
  _tablesReady = true;
}

Float64List mdct(Float64List x) {
  final X = Float64List(_n);
  for (int k = 0; k < _n; k++) {
    double s = 0;
    final r = k * 2 * _n;
    for (int n = 0; n < 2 * _n; n++) {
      s += x[n] * _win![n] * _tab![r + n];
    }
    X[k] = s;
  }
  return X;
}

Float64List imdct(Float64List X) {
  final y = Float64List(2 * _n);
  for (int n = 0; n < 2 * _n; n++) {
    double s = 0;
    final r = n * _n;
    for (int k = 0; k < _n; k++) {
      s += X[k] * _iTab![r + k];
    }
    y[n] = s * (2.0 / _n) * _win![n];
  }
  return y;
}

void fft(Float64List re, Float64List im) {
  int n = re.length;
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      double t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (int len = 2; len <= n; len <<= 1) {
    final ang = -2 * math.pi / len;
    for (int i = 0; i < n; i += len) {
      for (int j = 0; j < len >> 1; j++) {
        final wr = math.cos(ang * j), wi = math.sin(ang * j);
        final u = i + j, v = i + j + (len >> 1);
        final tr = wr * re[v] - wi * im[v];
        final ti = wr * im[v] + wi * re[v];
        re[v] = re[u] - tr; im[v] = im[u] - ti;
        re[u] += tr; im[u] += ti;
      }
    }
  }
}

/// ===== lmdn_bitio.dart =====
class BitWriter {
  int _acc = 0, _n = 0;
  final List<int> _buf = [];

  void write(int v, int bits) {
    _acc = (_acc << bits) | (v & ((1 << bits) - 1));
    _n += bits;
    while (_n >= 8) {
      _n -= 8;
      _buf.add((_acc >> _n) & 0xFF);
      _acc &= (1 << _n) - 1;
    }
  }

  Uint8List finish() {
    if (_n > 0) _buf.add((_acc << (8 - _n)) & 0xFF);
    return Uint8List.fromList(_buf);
  }
}

class BitReader {
  final Uint8List _data;
  int pos = 0, _acc = 0, _bits = 0;

  BitReader(this._data);

  bool get hasMore => pos < _data.length;

  int read(int bits) {
    while (_bits < bits) {
      _acc = (_acc << 8) | (pos < _data.length ? _data[pos++] : 0);
      _bits += 8;
    }
    _bits -= bits;
    final v = (_acc >> _bits) & ((1 << bits) - 1);
    _acc &= (1 << _bits) - 1;
    return v;
  }
}

/// ===== lmdn_models.dart =====
class LmdnEncoded {
  final Uint8List data;
  final int frameCount;
  LmdnEncoded({required this.data, required this.frameCount});
}

class ScoreNote {
  final int midi;
  final double startSec;
  final double durSec;
  const ScoreNote({required this.midi, required this.startSec, required this.durSec});
}

class ProcessedAudioResult {
  final Uint8List pcm;
  final List<ScoreNote> notes;
  ProcessedAudioResult({required this.pcm, required this.notes});
}

class LmdnDecoded {
  final Uint8List pcm;
  final int decodeTime;
  final List<ScoreNote> notes;
  LmdnDecoded({required this.pcm, required this.decodeTime, List<ScoreNote>? notes})
      : notes = notes ?? const [];
}

/// ===== audio_models.dart =====
class ProcessedFrame {
  Uint8List data;
  final int timestamp;
  double? vad;
  bool? isSpeech;
  double? speechProbability;

  ProcessedFrame({required this.data, required this.timestamp});
}

class AudioPipelineStats {
  final int totalFrames;
  final int speechFrames;
  final int noiseFrames;
  final String speechRatio;
  final String totalSpeechTime;
  final bool vadEnabled;
  final bool rnnoiseEnabled;
  final bool rnnoiseReady;
  final String rnnoiseAvgTime;

  AudioPipelineStats({
    required this.totalFrames,
    required this.speechFrames,
    required this.noiseFrames,
    required this.speechRatio,
    required this.totalSpeechTime,
    required this.vadEnabled,
    required this.rnnoiseEnabled,
    required this.rnnoiseReady,
    required this.rnnoiseAvgTime,
  });
}

/// ===== harmonic_codebook.dart =====
class HarmonicCodebook {
  static const int notes = 128;
  static const int vels = 32;
  static const int entries = notes * vels;
  static const int harmonics = 8;

  static late final List<List<int>> _codebook = _generate();

  static List<List<int>> _generate() {
    final book = List<List<int>>.generate(entries, (idx) {
      final midiNote = idx ~/ vels;
      final vel = idx % vels;
      final freq = 440 * math.pow(2, (midiNote - 69) / 12);
      final bright = vel / (vels - 1);
      var decay = freq / 2000 + (1 - bright) * 0.3;
      decay = decay.clamp(0.05, 2.0);

      return List<int>.generate(harmonics, (h) {
        final raw = math.exp(-h * decay) * (1 + bright * 0.5);
        return (raw * 255).round().clamp(0, 255);
      });
    });
    return book;
  }

  static List<int> get(int index) => _codebook[index.clamp(0, entries - 1)];

  static int findNearest(List<int> target) {
    int bestIdx = 0;
    int bestDist = 0x7FFFFFFF;

    for (int i = 0; i < entries; i++) {
      final entry = _codebook[i];
      int dist = 0;
      for (int h = 0; h < harmonics; h++) {
        final d = entry[h] - target[h];
        dist += d * d;
      }
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        if (dist == 0) break;
      }
    }
    return bestIdx;
  }
}

/// ===== wavetable_synth.dart =====
class VocoderSynth {
  static const int bandCount = 7;

  static void mixInto(
    Uint8List pcm, int offset, List<int> subBands,
    int sr, double freq, double rms, double vel, int n, {int instrument = 0}
  ) {
    double amp = rms / 255 * vel / 127 * 0.3;
    if (amp < 0.001 || freq < 30) return;

    int maxH = (sr / 2 / freq).floor();
    if (maxH > 100) maxH = 100;

    final hGains = <double>[];
    for (int h = 1; h <= maxH; h++) {
      double hz = freq * h;
      if (hz >= 8000) break;
      double bandEnergy = h <= bandCount ? subBands[h - 1] / 255.0 : subBands[bandCount - 1] / 255.0;
      if (bandEnergy < 0.01) { hGains.add(0); continue; }
      double rolloff = (math.pow(0.85, h - 1) as double);
      hGains.add(bandEnergy * rolloff * amp);
    }

    int attackSamples = (sr ~/ 500).clamp(1, n);
    int releaseSamples = (sr ~/ 500).clamp(1, n);

    for (int i = 0; i < n; i++) {
      double env = 1.0;
      if (i < attackSamples) env = i / attackSamples;
      if (i >= n - releaseSamples) env = (n - 1 - i) / releaseSamples;

      double s = 0;
      double t = (offset + i) / sr;
      for (int h = 0; h < hGains.length; h++) {
        if (hGains[h] < 0.001) continue;
        double hz = freq * (h + 1);
        if (hz > 5000) {
          s += (math.Random().nextDouble() * 2 - 1) * hGains[h] * 0.5;
        }
        s += math.sin(2 * math.pi * hz * t) * hGains[h] * 32768;
      }
      s *= env;

      int clipped = s.round().clamp(-32768, 32767);
      int byteIdx = (offset + i) * 2;
      if (byteIdx + 1 >= pcm.length) break;
      int existing = pcm[byteIdx] | (pcm[byteIdx + 1] << 8);
      int signed = existing > 32767 ? existing - 65536 : existing;
      int mixed = (signed + clipped).clamp(-32768, 32767);
      int bv = mixed < 0 ? mixed + 65536 : mixed;
      pcm[byteIdx] = bv & 0xFF;
      pcm[byteIdx + 1] = (bv >> 8) & 0xFF;
    }
  }
}

/// ===== lmdn_f0.dart =====
Map<String, dynamic>? yinF0(Float64List samples, {int sr = 48000}) {
  final mL = (sr / 2000).round();
  final ML = (sr / 40).round();
  if (samples.length < _fftSize) return null;
  final d = Float64List(ML + 1);
  for (int t = 0; t <= ML; t++) {
    double s = 0;
    for (int i = 0; i < _fftSize - t; i++) {
      final dd = samples[i] - samples[i + t];
      s += dd * dd;
    }
    d[t] = s;
  }
  final c = Float64List(ML + 1);
  c[0] = 1;
  double rs = 0;
  for (int t = 1; t <= ML; t++) {
    rs += d[t];
    c[t] = rs > 0 ? d[t] * t / rs : 1;
    if (t >= mL && c[t] < 0.15) {
      final a = c[t - 1], b = c[t], cc = c[t + 1];
      final de = a - 2 * b + cc;
      final ft = de.abs() > 1e-12 ? t + (a - cc) / (2 * de) : t.toDouble();
      return {'freq': sr / ft, 'conf': math.max(0.0, 1.0 - c[t])};
    }
  }
  return null;
}

Map<String, dynamic>? peakTrackF0(Float64List samples, {int sr = 48000}) {
  if (samples.length < _fftSize) return null;
  final win = Float64List(_fftSize);
  for (int i = 0; i < _fftSize; i++) {
    win[i] = 0.5 * (1 - math.cos(2 * math.pi * i / (_fftSize - 1)));
  }
  final re = Float64List(_fftSize), im = Float64List(_fftSize);
  for (int i = 0; i < _fftSize; i++) re[i] = samples[i] * win[i];
  fft(re, im);
  final half = _fftSize >> 1;
  final mag = Float64List(half);
  for (int i = 0; i < half; i++) mag[i] = math.sqrt(re[i] * re[i] + im[i] * im[i]);

  final pk = <Map<String, dynamic>>[];
  for (int i = 2; i < half - 2; i++) {
    if (mag[i] > mag[i - 1] && mag[i] > mag[i - 2] &&
        mag[i] > mag[i + 1] && mag[i] > mag[i + 2]) {
      final a = mag[i - 1], b = mag[i], g = mag[i + 1], de = a - 2 * b + g;
      double fi = i.toDouble();
      if (de.abs() > 1e-12) fi = i + (a - g) / (2 * de);
      final f = fi * sr / _fftSize;
      if (f > 30 && f < 8000) pk.add({'freq': f, 'amp': mag[i]});
    }
  }
  if (pk.isEmpty) return null;
  pk.sort((a, b) => (b['amp'] as double).compareTo(a['amp'] as double));
  final maxA = pk[0]['amp'] as double;
  final strong = pk.where((p) => (p['amp'] as double) > maxA * 0.05).toList();
  final ca = <Map<String, dynamic>>[];
  for (final p in strong) {
    final pf = p['freq'] as double;
    double hs = 0;
    for (int h = 2; h <= 8; h++) {
      final hf = pf * h;
      final m = pk.firstWhere(
        (pp) => ((pp['freq'] as double) - hf).abs() / hf < 0.06 && (pp['amp'] as double) > (p['amp'] as double) * 0.03,
        orElse: () => <String, dynamic>{'amp': 0.0},
      );
      if ((m['amp'] as double) > 0) hs += (m['amp'] as double) / maxA;
    }
    double sh = 0;
    for (int h = 2; h <= 6; h++) {
      final sf = pf / h;
      final m = pk.firstWhere(
        (pp) => ((pp['freq'] as double) - sf).abs() / sf < 0.06 && (pp['amp'] as double) > (p['amp'] as double) * 0.15,
        orElse: () => <String, dynamic>{'amp': 0.0},
      );
      if ((m['amp'] as double) > 0) sh++;
    }
    ca.add({'freq': pf, 'conf': math.min(1.0, (hs + sh * 0.5) / 3)});
  }
  ca.sort((a, b) => (b['conf'] as double).compareTo(a['conf'] as double));
  return ca.isNotEmpty ? Map<String, dynamic>.from(ca[0]) : null;
}

Map<String, dynamic>? fusionF0(Float64List samples, {int sr = 48000}) {
  final y = yinF0(samples, sr: sr);
  final pt = peakTrackF0(samples, sr: sr);
  if (y == null) return pt;
  if (pt == null) return y;
  if ((y['conf'] as double) > 0.5) return y;
  final lo = math.min(y['freq'] as double, pt['freq'] as double);
  final hi = math.max(y['freq'] as double, pt['freq'] as double);
  final ratio = hi / lo, ro = ratio.round();
  if ((ratio - ro).abs() < 0.05 || (pt['freq'] as double) / (y['freq'] as double) >= 2) {
    return {'freq': y['freq'], 'conf': ((y['conf'] as double) + (pt['conf'] as double)) / 2};
  }
  return (y['conf'] as double) >= (pt['conf'] as double) ? y : pt;
}

/// ===== lmdn_codec.dart =====
class LmdnCodec {
  final int sampleRate;
  final int frameSize = 20;
  bool _isReady = false;
  int _framesEncoded = 0, _framesDecoded = 0;
  int _totalInputBytes = 0, _totalOutputBytes = 0;
  Uint8List? _bits;
  Float64List? _prevY;

  LmdnCodec({this.sampleRate = 48000});

  int get samplesPerFrame => (sampleRate * frameSize) ~/ 1000;
  bool get isReady => _isReady;

  int get _n => 96;
  int get _bands => 16;
  int get _fftSize => 2048;

  Future<void> initialize() async {
    initMdctTables();
    _isReady = true;
  }

  Future<LmdnEncoded> encode(Uint8List pcmData) async {
    if (!_isReady) throw Exception('Codec not initialized');
    final sw = Stopwatch()..start();
    final sf = samplesPerFrame;
    final totalSamples = pcmData.length ~/ 2;
    final samples = Float64List(totalSamples);
    for (int i = 0; i < totalSamples; i++) {
      samples[i] = (pcmData[i * 2] | (pcmData[i * 2 + 1] << 8)).toSigned(16) / 32768;
    }

    if (_bits == null) {
      final scanned = _scanBitAllocation(samples, totalSamples);
      if (scanned.any((b) => b > 0)) {
        _bits = scanned;
      } else {
        _bits = Uint8List.fromList([4, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      }
    }

    final hopF0 = (_n * 2).round();
    final f0len = totalSamples ~/ hopF0 + 1;
    final f0buf = Float64List(f0len);
    final f0conf = Float64List(f0len);
    for (int fi = 0; fi < f0len; fi++) {
      final st = fi * hopF0;
      final fr = Float64List(_fftSize);
      for (int i = 0; i < _fftSize && st + i < totalSamples; i++) fr[i] = samples[st + i];
      final r = fusionF0(fr, sr: sampleRate);
      if (r != null) {
        f0buf[fi] = r['freq'] as double;
        f0conf[fi] = r['conf'] as double;
      }
    }

    final bw = BitWriter();
    final stride = _n;
    final nf = (totalSamples + stride - 1) ~/ stride;

    for (int b = 0; b < _bands; b++) bw.write(_bits![b], 3);

    for (int fi = 0; fi < nf; fi++) {
      final st = fi * stride;
      final fr = Float64List(2 * _n);
      for (int i = 0; i < 2 * _n && st + i < totalSamples; i++) fr[i] = samples[st + i];

      final X = mdct(fr);
      for (int b = 0; b < _bands; b++) {
        final bi = _bits![b];
        if (bi == 0) continue;
        final scale = 1 << (bi - 1);
        final stb = (b * _n / _bands).round();
        final enb = ((b + 1) * _n / _bands).round();
        double mv = 0;
        for (int k = stb; k < enb; k++) if (X[k].abs() > mv) mv = X[k].abs();
        final mvIdx = math.max(0, math.min(255, (math.log(math.max(mv, 1e-10)) / math.ln2 * 16 + 128).round()));
        bw.write(mvIdx, 8);
        if (mv < 1e-10) {
          for (int k = stb; k < enb; k++) bw.write(0, bi);
          continue;
        }
        for (int k = stb; k < enb; k++) {
          final q = (X[k] * scale / mv).round();
          bw.write(math.max(0, math.min((1 << bi) - 1, q + scale)), bi);
        }
      }

      if (fi % 4 == 0) {
        final f0Idx = (fi * stride) ~/ hopF0;
        if (f0Idx < f0buf.length && f0buf[f0Idx] > 0) {
          final midi = 12 * (math.log(f0buf[f0Idx] / 440) / math.ln2) + 69;
          final midiInt = midi.round().clamp(0, 127);
          final cent = ((midi - midiInt) * 100).round().clamp(-16, 15);
          final conf = (f0conf[f0Idx] * 15).round().clamp(0, 15);
          bw.write(midiInt, 7);
          bw.write(cent + 16, 5);
          bw.write(conf, 4);
          bw.write(1, 1);
          bw.write(0, 3);
        } else {
          bw.write(0, 7); bw.write(0, 5); bw.write(0, 4); bw.write(0, 1); bw.write(0, 3);
        }
      }
    }

    final payload = bw.finish();
    final frame = Uint8List(7 + payload.length + 2);
    int off = 0;
    frame[off++] = 0xBB; frame[off++] = 0x12; frame[off++] = 0x30;
    final pl = payload.length;
    frame[off++] = (pl >> 16) & 0xFF;
    frame[off++] = (pl >> 8) & 0xFF;
    frame[off++] = pl & 0xFF;
    frame.setRange(off, off + pl, payload); off += pl;
    int cs = 0;
    for (int i = 1; i < off; i++) cs ^= frame[i];
    frame[off++] = cs; frame[off++] = 0x7E;

    sw.stop();
    _framesEncoded += nf;
    _totalInputBytes += pcmData.length;
    _totalOutputBytes += frame.length;
    log('[C4] encode in=${pcmData.length}B frames=$nf out=${frame.length}B ${sw.elapsedMilliseconds}ms');
    return LmdnEncoded(data: frame.sublist(0, off), frameCount: nf);
  }

  Future<LmdnDecoded> decode(Uint8List data) async {
    if (!_isReady) throw Exception('Codec not initialized');
    final sw = Stopwatch()..start();

    final outChunks = <Uint8List>[];
    final notes = <ScoreNote>[];
    final frameSec = _n / sampleRate;
    int offset = 0;
    int globalFrameIdx = 0;

    while (offset + 8 <= data.length) {
      if (data[offset] != 0xBB) {
        break;
      }
      final pl = (data[offset + 3] << 16) | (data[offset + 4] << 8) | data[offset + 5];
      if (offset + 6 + pl + 2 > data.length) break;
      final payload = data.sublist(offset + 6, offset + 6 + pl);
      offset += 6 + pl + 2;

      final br = BitReader(payload);
      final bits = <int>[];
      for (int b = 0; b < _bands; b++) bits.add(br.read(3));

      int frameIdx = 0;
      while (br.hasMore) {
        final Xq = Float64List(_n);
        for (int b = 0; b < _bands; b++) {
          final bi = bits[b];
          if (bi == 0) continue;
          final mvIdx = br.read(8);
          final mv = math.pow(2, (mvIdx - 128) / 16).toDouble();
          final stb = (b * _n / _bands).round();
          final enb = ((b + 1) * _n / _bands).round();
          for (int k = stb; k < enb; k++) {
            final u = br.read(bi);
            Xq[k] = (u - (1 << (bi - 1))) * mv / (1 << (bi - 1));
          }
        }

        if (frameIdx % 4 == 0) {
          final midiInt = br.read(7);
          final cent = br.read(5) - 16;
          final conf = br.read(4);
          final voiced = br.read(1) == 1;
          br.read(3);

          if (voiced && midiInt > 0) {
            final sec = globalFrameIdx * frameSec;
            final dur = 4 * frameSec;
            if (notes.isNotEmpty && notes.last.midi == midiInt &&
                (sec - (notes.last.startSec + notes.last.durSec)).abs() < 0.001) {
              final last = notes.removeLast();
              notes.add(ScoreNote(midi: midiInt, startSec: last.startSec, durSec: last.durSec + dur));
            } else {
              notes.add(ScoreNote(midi: midiInt, startSec: sec, durSec: dur));
            }
          }
        }

        final y = imdct(Xq);
        final out = Float64List(_n);
        for (int i = 0; i < _n; i++) {
          out[i] = (_prevY != null ? _prevY![_n + i] : 0) + y[i];
        }

        final buf = Uint8List(_n * 2);
        for (int i = 0; i < _n; i++) {
          final v = math.max(-32768, math.min(32767, (out[i] * 32768).round()));
          buf[i * 2] = v & 0xFF;
          buf[i * 2 + 1] = (v >> 8) & 0xFF;
        }
        outChunks.add(buf);
        _prevY = y;
        frameIdx++;
        globalFrameIdx++;
      }
    }

    if (outChunks.isEmpty) {
      throw Exception('No decodable LMDN frames found');
    }

    int total = outChunks.fold(0, (s, c) => s + c.length);
    final result = Uint8List(total);
    int off = 0;
    for (final c in outChunks) {
      result.setRange(off, off + c.length, c);
      off += c.length;
    }

    sw.stop();
    _framesDecoded = globalFrameIdx;
    log('[C5] decode frames=$globalFrameIdx pcm=${result.length}B time=${sw.elapsedMilliseconds}ms notes=${notes.length}');
    return LmdnDecoded(pcm: result, decodeTime: sw.elapsedMilliseconds, notes: notes);
  }

  Uint8List _scanBitAllocation(Float64List samples, int totalSamples) {
    final stride = _n;
    final maxScan = math.min(500, (totalSamples + stride - 1) ~/ stride);
    if (maxScan <= 10) {
      return Uint8List.fromList([4, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    final bandEnergy = Float64List(_bands);
    for (int fi = 0; fi < maxScan; fi++) {
      final st = fi * stride;
      final fr = Float64List(2 * _n);
      for (int i = 0; i < 2 * _n && st + i < totalSamples; i++) fr[i] = samples[st + i];
      final X = mdct(fr);
      for (int b = 0; b < _bands; b++) {
        double e = 0;
        final stb = (b * _n / _bands).round();
        final enb = ((b + 1) * _n / _bands).round();
        for (int k = stb; k < enb; k++) e += X[k] * X[k];
        bandEnergy[b] += e;
      }
    }
    for (int b = 0; b < _bands; b++) bandEnergy[b] /= maxScan;

    final isolated = <int>{};
    for (int b = 1; b < _bands - 1; b++) {
      final avgNB = (bandEnergy[b - 1] + bandEnergy[b + 1]) / 2;
      if (avgNB > 1 && bandEnergy[b] > avgNB * 1.8) isolated.add(b);
    }
    if (bandEnergy[0] > bandEnergy[1] * 1.5) isolated.add(0);
    if (bandEnergy[_bands - 1] > bandEnergy[_bands - 2] * 1.5) isolated.add(_bands - 1);

    final bits = Uint8List(_bands);
    final totalE = bandEnergy.fold(0.0, (s, v) => s + v);
    for (int b = 0; b < _bands; b++) {
      final ratio = bandEnergy[b] / math.max(totalE, 1e-10) * _bands;
      if (ratio < 0.005) { bits[b] = 0; continue; }
      int bi = math.max(1, math.min(7, (ratio * 6).round()));
      if (isolated.contains(b)) bi = math.max(bi, 3);
      bits[b] = bi;
    }
    return bits;
  }

// === invariants ===
// - _bits 首次扫描若全带 0 则不锁定，下次 encode 重扫；否则冻结
// - _prevY 跨 decode 调用持久，确保 TDAC 连续性；独立流前需 reset()
// - 仅 N=96 受支持（MDCT 表大小）；sampleRate 仅影响 F0 计算

  void reset() { _prevY = null; _bits = null; }

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

/// ===== audio_pipeline.dart =====
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
    final rc = 1 / (2 * math.pi * fc);
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

    final rms = math.sqrt(sum / count);
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

    return math.sqrt(sum / count);
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

/// ===== lmdn_processor.dart =====
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

/// ===== lmdn_config.dart =====
class LmdnConfig {
  final Map<String, dynamic> raw;

  const LmdnConfig([this.raw = const {}]);

  int getInt(String key, int def) => raw[key] is int ? raw[key] as int : def;
  bool getBool(String key, bool def) => raw[key] is bool ? raw[key] as bool : def;
  String getString(String key, String def) => raw[key] is String ? raw[key] as String : def;

  int get sampleRate => getInt('sampleRate', 48000);
  int get bufferMs => getInt('bufferMs', 1000);
  int get pollMs => getInt('pollMs', 800);
  bool get denoise => getBool('denoise', true);
  bool get agc => getBool('agc', false);
  bool get highPass => getBool('highPass', true);
  int get fadeBytes => getInt('fadeBytes', 240);
  int get fadeSamples => getInt('fadeSamples', 48);
  int get demoDelayMs => getInt('demoDelayMs', 3000);

  int get bufferBytes => (sampleRate * 2 * bufferMs / 1000).round();

  static Future<LmdnConfig> load() async {
    try {
      final raw = await QiniuDirectClient.fetchConfigFile('oc/config/audio.json');
      if (raw == null) return const LmdnConfig();
      return LmdnConfig(Map<String, dynamic>.from(raw));
    } catch (e) {
      log('LmdnConfig.load error: $e');
      return const LmdnConfig();
    }
  }
}
