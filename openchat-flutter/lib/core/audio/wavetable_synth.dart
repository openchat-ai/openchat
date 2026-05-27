/// Wavetable synthesizer: generates a single-cycle waveform from
/// codebook harmonics, then plays it at arbitrary pitch.
///
/// Instead of 8 independent sine waves (which lose phase relationships),
/// we render one period of the combined waveform and repeat it.
/// This preserves the full harmonic profile of the codebook entry.
import 'dart:math';
import 'dart:typed_data';

class WavetableSynth {
  static const int tableSize = 256; // samples per period

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
