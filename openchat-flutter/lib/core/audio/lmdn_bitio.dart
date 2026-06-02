import 'dart:typed_data';

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
