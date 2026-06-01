// Harmonic envelope synthesizer: 7 harmonic bands x 8b energy at F0x1..F0x7.
import 'dart:math';
import 'dart:typed_data';

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

    // Harmonic gains: each harmonic h maps to subBands[h-1] / 255
    final hGains = <double>[];
    for (int h = 1; h <= maxH; h++) {
      double hz = freq * h;
      if (hz >= 8000) break;
      double bandEnergy = h <= bandCount ? subBands[h - 1] / 255.0 : subBands[bandCount - 1] / 255.0;
      if (bandEnergy < 0.01) { hGains.add(0); continue; }
      double rolloff = (pow(0.85, h - 1) as double);
      hGains.add(bandEnergy * rolloff * amp);
    }

    // Per-frame envelope: 2ms attack + 2ms release, prevents clicks at frame boundaries
    int attackSamples = (sr ~/ 500).clamp(1, n);     // 2ms
    int releaseSamples = (sr ~/ 500).clamp(1, n);    // 2ms

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
          s += (Random().nextDouble() * 2 - 1) * hGains[h] * 0.5;
        }
        s += sin(2 * pi * hz * t) * hGains[h] * 32768;
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
