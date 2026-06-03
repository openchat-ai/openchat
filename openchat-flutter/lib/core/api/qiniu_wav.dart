import 'dart:typed_data';

/// WAV header generator for raw PCM s16le mono data.
class QiniuWav {
  /// Prepend a 44-byte WAV header to PCM data.
  static Uint8List wrapPcm(Uint8List pcm, {int sampleRate = 48000}) {
    final header = _header(pcm.length, sampleRate);
    final wav = Uint8List(header.length + pcm.length);
    wav.setRange(0, header.length, header);
    wav.setRange(header.length, wav.length, pcm);
    return wav;
  }

  static List<int> _header(int dataLen, int sr) {
    final h = List<int>.filled(44, 0);
    h[0] = 0x52; h[1] = 0x49; h[2] = 0x46; h[3] = 0x46;
    final fs = 36 + dataLen;
    h[4] = fs & 0xFF;
    h[5] = (fs >> 8) & 0xFF;
    h[6] = (fs >> 16) & 0xFF;
    h[7] = (fs >> 24) & 0xFF;
    h[8] = 0x57; h[9] = 0x41; h[10] = 0x56; h[11] = 0x45;
    h[12] = 0x66; h[13] = 0x6D; h[14] = 0x74; h[15] = 0x20;
    h[16] = 16; h[17] = 0; h[18] = 0; h[19] = 0;
    h[20] = 1; h[21] = 0;
    h[22] = 1; h[23] = 0;
    h[24] = sr & 0xFF;
    h[25] = (sr >> 8) & 0xFF;
    h[26] = (sr >> 16) & 0xFF;
    h[27] = (sr >> 24) & 0xFF;
    final byteRate = sr * 2;
    h[28] = byteRate & 0xFF;
    h[29] = (byteRate >> 8) & 0xFF;
    h[30] = (byteRate >> 16) & 0xFF;
    h[31] = (byteRate >> 24) & 0xFF;
    h[32] = 2; h[33] = 0;
    h[34] = 16; h[35] = 0;
    h[36] = 0x64; h[37] = 0x61; h[38] = 0x74; h[39] = 0x61;
    h[40] = dataLen & 0xFF;
    h[41] = (dataLen >> 8) & 0xFF;
    h[42] = (dataLen >> 16) & 0xFF;
    h[43] = (dataLen >> 24) & 0xFF;
    return h;
  }
}
