import 'dart:math' as math;
import 'dart:typed_data';
import 'lmdn_mdct.dart';

const int _sr = 24000;
const int _fftSize = 2048;

Map<String, dynamic>? yinF0(Float64List samples) {
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

Map<String, dynamic>? peakTrackF0(Float64List samples) {
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

Map<String, dynamic>? fusionF0(Float64List samples) {
  final y = yinF0(samples);
  final pt = peakTrackF0(samples);
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
