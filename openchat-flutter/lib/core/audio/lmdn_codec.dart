import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' as math;
import 'dart:typed_data';
import 'lmdn_models.dart';
import 'lmdn_mdct.dart';
import 'lmdn_f0.dart';
import 'lmdn_bitio.dart';

class LmdnCodec {
  final int sampleRate;
  final int frameSize = 20;
  bool _isReady = false;
  int _framesEncoded = 0, _framesDecoded = 0;
  int _totalInputBytes = 0, _totalOutputBytes = 0;
  Uint8List? _bits;
  Float64List? _prevY;

  LmdnCodec({this.sampleRate = 24000}) {
    if (sampleRate != 24000) throw ArgumentError('LmdnCodec only supports 24000 Hz');
  }

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
      _bits = _scanBitAllocation(samples, totalSamples);
    }

    final hopF0 = (_n * 2).round();
    final f0len = totalSamples ~/ hopF0 + 1;
    final f0buf = Float64List(f0len);
    final f0conf = Float64List(f0len);
    for (int fi = 0; fi < f0len; fi++) {
      final st = fi * hopF0;
      final fr = Float64List(_fftSize);
      for (int i = 0; i < _fftSize && st + i < totalSamples; i++) fr[i] = samples[st + i];
      final r = fusionF0(fr);
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
    frame[off++] = 0xBB; frame[off++] = 0x00; frame[off++] = 0xCC;
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
    _prevY = null;
    final sw = Stopwatch()..start();

    final outChunks = <Uint8List>[];
    final notes = <ScoreNote>[];
    final frameSec = _n / 24000;
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
