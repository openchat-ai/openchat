/// Vocoder synthesizer: 11 Mel-spaced subbands → sine/noise mix → formant filter.
/// Replaces the old 8-harmonic wavetable with a channel vocoder approach.
import 'dart:math';
import 'dart:typed_data';

// Mel-spaced center frequencies for 11 bands (100Hz-8000Hz @ 24kHz)
const List<double> _melFreqs = [
  100, 150, 220, 320, 460, 660, 950, 1350, 1950, 2800, 4000,
];

// One-pole filter state per band
class _BandState {
  double lp = 0; // smoothed amplitude
}

class VocoderSynth {
  static const int bandCount = 11;
  static final _states = List.generate(bandCount, (_) => _BandState());

  // Formant filter state (biquad peaking)
  static double _f1x1 = 0, _f1x2 = 0, _f1y1 = 0, _f1y2 = 0;
  static double _f2x1 = 0, _f2x2 = 0, _f2y1 = 0, _f2y2 = 0;

  static void reset() {
    for (final s in _states) s.lp = 0;
    _f1x1 = _f1x2 = _f1y1 = _f1y2 = 0;
    _f2x1 = _f2x2 = _f2y1 = _f2y2 = 0;
  }

  /// Synthesize N samples from subband energies and mix into PCM buffer.
  static void mixInto(
    Uint8List pcm, int offset, List<int> subBands,
    int sr, double freq, double rms, double vel, int n,
  ) {
    double amp = rms / 255 * vel / 127 * 0.5;
    if (amp < 0.001) return;

    for (int i = 0; i < n; i++) {
      double s = 0;

      for (int b = 0; b < bandCount; b++) {
        double targetAmp = subBands[b] / 31.0 * amp;
        if (targetAmp < 0.001) continue;

        // Smooth amplitude changes
        _states[b].lp += (targetAmp - _states[b].lp) * 0.3;
        double bandAmp = _states[b].lp;

        double f = _melFreqs[b];
        double t = (offset + i) / sr;
        double val;

        if (f > 3000) {
          // High bands: noise only (fricative)
          val = (Random().nextDouble() * 2 - 1) * bandAmp;
        } else if (f > 1500) {
          // Mid bands: sine + noise mix
          val = (sin(2 * pi * f * t) * 0.6 +
                 (Random().nextDouble() * 2 - 1) * 0.4) * bandAmp;
        } else {
          // Low bands: pure sine with pitch
          val = sin(2 * pi * f * t) * bandAmp;
          // Add pitch excitation
          if (freq > 50) {
            val += sin(2 * pi * freq * t) * bandAmp * 0.3;
          }
        }

        s += val;
      }

      // Apply formant filter
      const f1 = 800.0, q1 = 1.5, g1 = 10.0;
      final a1 = pow(10, g1 / 40);
      final w1 = 2 * pi * f1 / sr;
      final alpha1 = sin(w1) / (2 * q1);
      final y1 = ((1 + alpha1 * a1) * s - 2 * cos(w1) * _f1x1 + (1 - alpha1 * a1) * _f1x2
                 + 2 * cos(w1) * _f1y1 - (1 - alpha1 / a1) * _f1y2) / (1 + alpha1 / a1);
      _f1x2 = _f1x1; _f1x1 = s; _f1y2 = _f1y1; _f1y1 = y1;

      const f2 = 1600.0, q2 = 2.0, g2 = 6.0;
      final a2 = pow(10, g2 / 40);
      final w2 = 2 * pi * f2 / sr;
      final alpha2 = sin(w2) / (2 * q2);
      final y2 = ((1 + alpha2 * a2) * y1 - 2 * cos(w2) * _f2x1 + (1 - alpha2 * a2) * _f2x2
                 + 2 * cos(w2) * _f2y1 - (1 - alpha2 / a2) * _f2y2) / (1 + alpha2 / a2);
      _f2x2 = _f2x1; _f2x1 = y1; _f2y2 = _f2y1; _f2y1 = y2;

      final clipped = (y2 * 32768).round().clamp(-32768, 32767);
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
