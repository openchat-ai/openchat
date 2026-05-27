/// Harmonic envelope synthesizer: subband energies → spectral envelope for F0 harmonics.
/// Works for both voice (formants) and music (harmonic spectrum).
import 'dart:math';
import 'dart:typed_data';

// No fixed band bounds — bands track F0 harmonics dynamically

class VocoderSynth {
  static const int bandCount = 11;

  /// Synthesize N samples: generate F0 harmonics, shape by subband envelope.
  static void mixInto(
    Uint8List pcm, int offset, List<int> subBands,
    int sr, double freq, double rms, double vel, int n, {int instrument = 0},
  ) {
    double amp = rms / 255 * vel / 127 * 0.3;
    if (amp < 0.001 || freq < 30) return;

    // Edge case: avoid division by zero in bin calculation
    int maxH = (sr / 2 / freq).floor(); // max harmonic below Nyquist
    if (maxH > 100) maxH = 100; // performance limit

    // For each harmonic, compute which band it falls in, get band energy
    final hGains = <double>[];
    for (int h = 1; h <= maxH; h++) {
      double hz = freq * h;
      if (hz >= 8000) break;
      // Find band index
      int band = bandCount - 1;
      for (int b = 0; b < bandCount; b++) {
        if (hz < _bandBounds[b + 1]) { band = b; break; }
      }
      double bandEnergy = subBands[band] / 31.0;
      if (bandEnergy < 0.01) { hGains.add(0); continue; }
      // Interpolate: how central is this harmonic in the band
      double bandLow = _bandBounds[band], bandHigh = _bandBounds[band + 1];
      double position = (hz - bandLow) / (bandHigh - bandLow);
      // Gaussian-like weighting: peak at band center, drop at edges
      double centerWeight = exp(-4 * (position - 0.5) * (position - 0.5));
      // Higher harmonics naturally weaker
      double rolloff = pow(0.85, h - 1);
      hGains.add(bandEnergy * centerWeight * rolloff * amp);
    }

    // Synthesize: sum harmonics with instrument-based envelope
    double velRatio = vel / 127;
    double attackMs = 5; // default 5ms
    double decayRate = 4 - velRatio * 2;
    switch (instrument) {
      case 0: // piano: fast attack, medium decay
        attackMs = 3; decayRate = 3 - velRatio * 1.5;
      case 1: // voice: slow attack, slow decay
        attackMs = 20; decayRate = 1.5 - velRatio * 0.5;
      case 2: // guitar: fast attack, fast decay
        attackMs = 2; decayRate = 6 - velRatio * 2;
      case 3: // strings: slow attack, very slow decay
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
        // Add noise for very high harmonics (>5kHz)
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
