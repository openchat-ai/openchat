import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' as math;
import 'dart:typed_data';
import 'audio_pipeline.dart';
import '../api/qiniu_direct_client.dart';

// ===== LMDN Codec: MDCT + adaptive bit allocation =====
const int _sr = 24000;
const int _n = 96;
const int _bands = 16;
const int _fftSize = 2048;

// Pre-computed MDCT tables (lazy init)
Float64List? _win;
Float64List? _tab;
Float64List? _iTab;
bool _tablesReady = false;

void _initMdctTables() {
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

Float64List _mdct(Float64List x) {
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

Float64List _imdct(Float64List X) {
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

// ===== FFT (in-place, radix-2) =====
void _fft(Float64List re, Float64List im) {
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

// ===== YIN F0 (for score metadata) =====
Map<String, dynamic>? _yinF0(Float64List samples) {
  final mL = (_sr / 2000).round();
  final ML = (_sr / 40).round();
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
      return {'freq': _sr / ft, 'conf': math.max(0.0, 1.0 - c[t])};
    }
  }
  return null;
}

// ===== PeakTrack F0 =====
Map<String, dynamic>? _peakTrackF0(Float64List samples) {
  if (samples.length < _fftSize) return null;
  final win = Float64List(_fftSize);
  for (int i = 0; i < _fftSize; i++) {
    win[i] = 0.5 * (1 - math.cos(2 * math.pi * i / (_fftSize - 1)));
  }
  final re = Float64List(_fftSize), im = Float64List(_fftSize);
  for (int i = 0; i < _fftSize; i++) re[i] = samples[i] * win[i];
  _fft(re, im);
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
      final f = fi * _sr / _fftSize;
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

Map<String, dynamic>? _fusionF0(Float64List samples) {
  final y = _yinF0(samples);
  final pt = _peakTrackF0(samples);
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

// ===== BitWriter =====
class _BitWriter {
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

// ===== BitReader =====
class _BitReader {
  final Uint8List _data;
  int _pos = 0, _acc = 0, _bits = 0;

  _BitReader(this._data);

  int read(int bits) {
    while (_bits < bits) {
      _acc = (_acc << 8) | (_pos < _data.length ? _data[_pos++] : 0);
      _bits += 8;
    }
    _bits -= bits;
    final v = (_acc >> _bits) & ((1 << bits) - 1);
    _acc &= (1 << _bits) - 1;
    return v;
  }
}

// ===== Encoded/Decoded containers =====
class LmdnEncoded {
  final Uint8List data;
  final int frameCount;
  LmdnEncoded({required this.data, required this.frameCount});
}

class LmdnDecoded {
  final Uint8List pcm;
  final int decodeTime;
  LmdnDecoded({required this.pcm, required this.decodeTime});
}

// ===== LmdnCodec (LPC + MDCT) =====
class LmdnCodec {
  final int sampleRate;
  final int frameSize;
  bool _isReady = false;
  int _framesEncoded = 0, _framesDecoded = 0;
  int _totalInputBytes = 0, _totalOutputBytes = 0;
  Uint8List? _bits; // dynamic bit allocation, computed on first encode
  Float64List? _prevY;

  LmdnCodec({this.sampleRate = _sr, this.frameSize = 20}) {
    if (sampleRate != _sr) throw ArgumentError('LmdnCodec only supports $_sr Hz');
  }

  int get samplesPerFrame => (sampleRate * frameSize) ~/ 1000;
  bool get isReady => _isReady;

  Future<void> initialize() async {
    _initMdctTables();
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

    // Dynamic bit allocation: scan first 500 frames
    if (_bits == null) {
      _bits = _scanBitAllocation(samples, totalSamples);
    }

    // F0 buffer
    final hopF0 = (_n * 2).round();
    final f0len = totalSamples ~/ hopF0 + 1;
    final f0buf = Float64List(f0len);
    final f0conf = Float64List(f0len);
    for (int fi = 0; fi < f0len; fi++) {
      final st = fi * hopF0;
      final fr = Float64List(_fftSize);
      for (int i = 0; i < _fftSize && st + i < totalSamples; i++) fr[i] = samples[st + i];
      final r = _fusionF0(fr);
      if (r != null) {
        f0buf[fi] = r['freq'] as double;
        f0conf[fi] = r['conf'] as double;
      }
    }

    final bw = _BitWriter();
    final stride = _n;
    final nf = (totalSamples + stride - 1) ~/ stride;

    // Write bit allocation header
    for (int b = 0; b < _bands; b++) bw.write(_bits![b], 3);

    for (int fi = 0; fi < nf; fi++) {
      final st = fi * stride;
      final fr = Float64List(2 * _n);
      for (int i = 0; i < 2 * _n && st + i < totalSamples; i++) fr[i] = samples[st + i];

      final X = _mdct(fr);
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

      // F0 metadata every 4 frames
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
    frame[off++] = 0xBB; frame[off++] = 0x01; frame[off++] = 0xCC;
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
    return LmdnEncoded(data: frame.sublist(0, off), frameCount: nf);
  }

  Future<LmdnDecoded> decode(Uint8List data) async {
    if (!_isReady) throw Exception('Codec not initialized');
    _prevY = null; // Reset overlap-add state for new file
    final sw = Stopwatch()..start();
    if (data.length < 8) {
      throw Exception('LMDN frame too short: ${data.length} bytes');
    }
    if (data[0] != 0xBB || data[1] != 0x01 || data[2] != 0xCC) {
      throw Exception('Invalid LMDN frame header');
    }
    final pl = (data[3] << 16) | (data[4] << 8) | data[5];
    if (6 + pl > data.length) {
      throw Exception('LMDN payload overrun: claims $pl bytes, have ${data.length - 6}');
    }
    final payload = data.sublist(6, 6 + pl);
    final br = _BitReader(payload);

    final bits = <int>[];
    for (int b = 0; b < _bands; b++) bits.add(br.read(3));

    final stride = _n;
    final outChunks = <Uint8List>[];
    int frameIdx = 0;

    while (br._pos < payload.length) {
      final Xq = Float64List(_n);
      for (int b = 0; b < _bands; b++) {
        final bi = bits[b];
        if (bi == 0) continue;
        final scale = 1 << (bi - 1);
        final mvIdx = br.read(8);
        final mv = math.pow(2, (mvIdx - 128) / 16).toDouble();
        final stb = (b * _n / _bands).round();
        final enb = ((b + 1) * _n / _bands).round();
        for (int k = stb; k < enb; k++) {
          final u = br.read(bi);
          Xq[k] = (u - (1 << (bi - 1))) * mv / (1 << (bi - 1));
        }
      }

      // Skip F0 metadata (read to keep bitstream aligned)
      if (frameIdx % 4 == 0) {
        br.read(7); br.read(5); br.read(4); br.read(1); br.read(3);
      }

      final y = _imdct(Xq);
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
    }

    // Concatenate chunks
    int total = outChunks.fold(0, (s, c) => s + c.length);
    final result = Uint8List(total);
    int off = 0;
    for (final c in outChunks) {
      result.setRange(off, off + c.length, c);
      off += c.length;
    }

    sw.stop();
    _framesDecoded = frameIdx;
    return LmdnDecoded(pcm: result, decodeTime: sw.elapsedMilliseconds);
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
      final X = _mdct(fr);
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

// ===== LmdnConfig =====
class LmdnConfig {
  final Map<String, dynamic> raw;

  const LmdnConfig([this.raw = const {}]);

  int getInt(String key, int def) => raw[key] is int ? raw[key] as int : def;
  bool getBool(String key, bool def) => raw[key] is bool ? raw[key] as bool : def;
  String getString(String key, String def) => raw[key] is String ? raw[key] as String : def;

  int get sampleRate => getInt('sampleRate', 24000);
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

// ===== LmdnProcessor =====
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
    this.sampleRate = 24000,
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

  Future<Uint8List?> processReceivedAudio(Uint8List data) async {
    if (!_isProcessing) return null;

    if (_codec != null) {
      try {
        final decoded = await _codec!.decode(data);
        return decoded.pcm;
      } catch (e) {
        log('processReceivedAudio decode failed: $e');
        return null; // discard malformed frame instead of playing encoded bytes as PCM noise
      }
    }

    return data;
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

  void dispose() {
    _isProcessing = false;
    _codec?.destroy();
    _pipeline?.destroy();
    _speakingController.close();
    _audioLevelController.close();
  }
}
