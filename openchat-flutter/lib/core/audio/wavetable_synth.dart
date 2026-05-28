/// Harmonic envelope synthesizer: 7 harmonic bands × 8b energy at F0×1..F0×7.
import 'dart:math';
import 'dart:typed_data';

class VocoderSynth {
  static const int bandCount = 7;

  static void mixInto(
    Uint8List pcm, int offset, List<int> subBands,
    int sr, double freq, double rms, double vel, int n, {int instrument = 0},
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

    double velRatio = vel / 127;
    double attackMs = 5;
    double decayRate = 4 - velRatio * 2;
    switch (instrument) {
      case 0:
        attackMs = 3; decayRate = 3 - velRatio * 1.5;
      case 1:
        attackMs = 20; decayRate = 1.5 - velRatio * 0.5;
      case 2:
        attackMs = 2; decayRate = 6 - velRatio * 2;
      case 3:
        attackMs = 30; decayRate = 1 - velRatio * 0.5;
    }
    double attackSamples = attackMs * sr / 1000;
    for (int i = 0; i < n; i++) {
      double s = 0;
      double t = i / sr;
      double notePos = i / n;
      double env = min(1.0, i / attackSamples) * exp(-notePos * decayRate);
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
