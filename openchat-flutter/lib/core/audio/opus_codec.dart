import 'dart:typed_data';
import 'package:opus_dart/opus_dart.dart' as opus;
import 'package:opus_flutter/opus_flutter.dart' as opus_flutter;

class OpusCodec {
  opus.OpusEncoder? _encoder;
  opus.OpusDecoder? _decoder;
  final int sampleRate;
  bool _initialized = false;

  OpusCodec({this.sampleRate = 24000});

  Future<void> initialize() async {
    if (_initialized) return;
    final lib = await opus_flutter.load();
    opus.initOpus(lib);
    _encoder = opus.SimpleOpusEncoder(sampleRate, 1);
    _decoder = opus.SimpleOpusDecoder(sampleRate, 1);
    _initialized = true;
  }

  Uint8List encode(Uint8List pcm) {
    final samples = Int16List(pcm.length ~/ 2);
    for (int i = 0; i < samples.length; i++) {
      samples[i] = pcm[i * 2] | (pcm[i * 2 + 1] << 8);
    }
    final encoded = _encoder!.encode(samples, samples.length);
    return encoded;
  }

  Uint8List decode(Uint8List opusData) {
    final decoded = _decoder!.decode(opusData, sampleRate ~/ 50);
    final pcm = Uint8List(decoded.length * 2);
    for (int i = 0; i < decoded.length; i++) {
      pcm[i * 2] = decoded[i] & 0xFF;
      pcm[i * 2 + 1] = (decoded[i] >> 8) & 0xFF;
    }
    return pcm;
  }

  void destroy() {
    _encoder?.destroy();
    _decoder?.destroy();
  }
}
