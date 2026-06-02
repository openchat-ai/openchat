import 'dart:math' as math;
import 'dart:typed_data';

const int _sr = 24000;
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
