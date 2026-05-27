/// Wavetable synthesizer: generates a single-cycle waveform from
/// codebook harmonics, then plays it at arbitrary pitch.
///
/// Instead of 8 independent sine waves (which lose phase relationships),
/// we render one period of the combined waveform and repeat it.
/// This preserves the full harmonic profile of the codebook entry.
import 'dart:math';
import 'dart:typed_data';

class WavetableSynth {
  static const int tableSize = 256;

  // Biquad peaking filter state (per-channel, reset each render)
  static double _f1x1 = 0, _f1x2 = 0, _f1y1 = 0, _f1y2 = 0;
  static double _f2x1 = 0, _f2x2 = 0, _f2y1 = 0, _f2y2 = 0;

  /// Reset formant filter state (call at start of each decode batch)
  static void resetFormants() {
    _f1x1 = _f1x2 = _f1y1 = _f1y2 = 0;
    _f2x1 = _f2x2 = _f2y1 = _f2y2 = 0;
  }

  // Apply formant filters in series (F1=800Hz Q=1.5 +10dB, F2=1600Hz Q=2 +6dB)
  static double _applyFormants(double sample, int sr) {
    // F1 peaking filter
    const f1 = 800.0, q1 = 1.5, g1 = 10.0;
    final a1 = pow(10, g1 / 40);
    final w1 = 2 * pi * f1 / sr;
    final alpha1 = sin(w1) / (2 * q1);
    final b01 = 1 + alpha1 * a1, b11 = -2 * cos(w1), b21 = 1 - alpha1 * a1;
    final a01 = 1 + alpha1 / a1, a11 = -2 * cos(w1), a21 = 1 - alpha1 / a1;
    final y1 = (b01 * sample + b11 * _f1x1 + b21 * _f1x2 - a11 * _f1y1 - a21 * _f1y2) / a01;
    _f1x2 = _f1x1; _f1x1 = sample; _f1y2 = _f1y1; _f1y1 = y1;

    // F2 peaking filter
    const f2 = 1600.0, q2 = 2.0, g2 = 6.0;
    final a2 = pow(10, g2 / 40);
    final w2 = 2 * pi * f2 / sr;
    final alpha2 = sin(w2) / (2 * q2);
    final b02 = 1 + alpha2 * a2, b12 = -2 * cos(w2), b22 = 1 - alpha2 * a2;
    final a02 = 1 + alpha2 / a2, a12 = -2 * cos(w2), a22 = 1 - alpha2 / a2;
    final y2 = (b02 * y1 + b12 * _f2x1 + b22 * _f2x2 - a12 * _f2y1 - a22 * _f2y2) / a02;
    _f2x2 = _f2x1; _f2x1 = y1; _f2y2 = _f2y1; _f2y1 = y2;

    return y2;
  }

  /// Render a single-cycle wavetable from 8 harmonic amplitudes.
  /// Returns Float64List(tableSize) ready for playback.
  static Float64List render(List<int> harmonics) {
    var wt = Float64List(tableSize);
    double maxVal = 0;

    for (int i = 0; i < tableSize; i++) {
      double s = 0;
      for (int h = 0; h < 8; h++) {
        double amp = harmonics[h] / 255;
        if (amp < 0.001) continue;
        s += sin(2 * pi * (h + 1) * i / tableSize) * amp;
      }
      wt[i] = s;
      if (s.abs() > maxVal) maxVal = s.abs();
    }

    // Normalize to [-1, 1]
    if (maxVal > 0) {
      for (int i = 0; i < tableSize; i++) wt[i] /= maxVal;
    }
    return wt;
  }

  /// Synthesize N output samples at given frequency using wavetable.
  /// wt: the wavetable from render()
  /// sr: sample rate
  /// freq: target frequency (Hz)
  /// amp: amplitude (0..1)
  static Float64List synthesize(Float64List wt, int sr, double freq, double amp, int nSamples) {
    double phaseInc = freq * tableSize / sr;
    var out = Float64List(nSamples);
    double phase = 0;

    for (int i = 0; i < nSamples; i++) {
      int idx = phase.floor() % tableSize;
      double frac = phase - idx;
      int next = (idx + 1) % tableSize;
      // Linear interpolation
      out[i] = (wt[idx] * (1 - frac) + wt[next] * frac) * amp;
      phase += phaseInc;
    }
    return out;
  }

  /// Synthesize and mix into an existing PCM buffer (Int16LE).
  static void mixInto(Uint8List pcm, int offset, Float64List wt, int sr, double freq, double amp, int nSamples) {
    double phaseInc = freq * tableSize / sr;
    double phase = 0;

    for (int i = 0; i < nSamples; i++) {
      int idx = phase.floor() % tableSize;
      double frac = phase - idx;
      int next = (idx + 1) % tableSize;
      double val = (wt[idx] * (1 - frac) + wt[next] * frac) * amp;
      val = _applyFormants(val, sr);

      int byteIdx = (offset + i) * 2;
      if (byteIdx + 1 >= pcm.length) break;
      int existing = pcm[byteIdx] | (pcm[byteIdx + 1] << 8);
      int signed = existing > 32767 ? existing - 65536 : existing;
      int mixed = (signed + (val * 32768).round()).clamp(-32768, 32767);
      int bv = mixed < 0 ? mixed + 65536 : mixed;
      pcm[byteIdx] = bv & 0xFF;
      pcm[byteIdx + 1] = (bv >> 8) & 0xFF;
      phase += phaseInc;
    }
  }
}
