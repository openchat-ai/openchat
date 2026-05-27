import 'dart:typed_data';
import 'package:opus_dart/opus_dart.dart' as opus;
import 'package:opus_flutter/opus_flutter.dart' as opus_flutter;

class OpusCodec {
  opus.SimpleOpusEncoder? _encoder;
  opus.SimpleOpusDecoder? _decoder;
  final int sampleRate;
  bool _initialized = false;

  OpusCodec({this.sampleRate = 24000});

  Future<void> initialize() async {
    if (_initialized) return;
    final lib = await opus_flutter.load();
    opus.initOpus(lib);
    _encoder = opus.SimpleOpusEncoder(
      sampleRate: sampleRate,
      channels: 1,
      application: opus.Application.audio,
    );
    _decoder = opus.SimpleOpusDecoder(
      sampleRate: sampleRate,
      channels: 1,
    );
    _initialized = true;
  }

  static const int _frameSamples = 480; // 20ms at 24kHz

  Uint8List encode(Uint8List pcm) {
    final allSamples = Int16List(pcm.length ~/ 2);
    for (int i = 0; i < allSamples.length; i++) {
      allSamples[i] = pcm[i * 2] | (pcm[i * 2 + 1] << 8);
    }

    final packets = <Uint8List>[];
    for (int offset = 0; offset + _frameSamples <= allSamples.length; offset += _frameSamples) {
      final frame = Int16List.sublistView(allSamples, offset, offset + _frameSamples);
      packets.add(_encoder!.encode(input: frame));
    }

    // [numPackets:u16][len1:u16][data1...][len2:u16][data2...]...
    final headerSize = 2 + packets.length * 2;
    int total = headerSize;
    for (final p in packets) total += p.length;
    final output = Uint8List(total);
    int off = 0;
    output[off++] = packets.length & 0xFF;
    output[off++] = (packets.length >> 8) & 0xFF;
    for (final p in packets) {
      output[off++] = p.length & 0xFF;
      output[off++] = (p.length >> 8) & 0xFF;
      output.setRange(off, off + p.length, p);
      off += p.length;
    }
    return output;
  }

  Uint8List decode(Uint8List opusData) {
    int off = 0;
    final numPackets = opusData[off] | (opusData[off + 1] << 8);
    off += 2;
    final allSamples = <int>[];

    for (int i = 0; i < numPackets; i++) {
      final len = opusData[off] | (opusData[off + 1] << 8);
      off += 2;
      final packet = opusData.sublist(off, off + len);
      off += len;
      final decoded = _decoder!.decode(input: packet);
      allSamples.addAll(decoded);
    }

    final pcm = Uint8List(allSamples.length * 2);
    for (int i = 0; i < allSamples.length; i++) {
      pcm[i * 2] = allSamples[i] & 0xFF;
      pcm[i * 2 + 1] = (allSamples[i] >> 8) & 0xFF;
    }
    return pcm;
  }

  void destroy() {
    try { _encoder?.destroy(); } catch (_) {}
    try { _decoder?.destroy(); } catch (_) {}
  }
}
