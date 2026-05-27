import 'dart:math';

/// 4096-entry harmonic codebook.
/// Index = midiNote(0..127) × 32 + velocity(0..31)
/// Each entry = 8 harmonic amplitudes (0..255).
///
/// Generation: exp(-h × decay) × brightness factor
///   - decay 取决于基频(高音泛音少) + 力度(大力更亮)
///   - bright = velocity/31
///   - decay = freq/2000 + (1-bright)×0.3
class HarmonicCodebook {
  static const int notes = 128;   // MIDI 0..127
  static const int vels = 32;     // velocity 0..31
  static const int entries = notes * vels; // 4096
  static const int harmonics = 8;

  static late final List<List<int>> _codebook = _generate();

  static List<List<int>> _generate() {
    final book = List<List<int>>.generate(entries, (idx) {
      final midiNote = idx ~/ vels;
      final vel = idx % vels;
      final freq = 440 * pow(2, (midiNote - 69) / 12);
      final bright = vel / (vels - 1);
      // decay: low→rich harmonics, high→few harmonics
      var decay = freq / 2000 + (1 - bright) * 0.3;
      decay = decay.clamp(0.05, 2.0);

      return List<int>.generate(harmonics, (h) {
        final raw = exp(-h * decay) * (1 + bright * 0.5);
        return (raw * 255).round().clamp(0, 255);
      });
    });
    return book;
  }

  /// Lookup entry by index
  static List<int> get(int index) => _codebook[index.clamp(0, entries - 1)];

  /// Nearest-neighbor search: find closest codebook match for 8 harmonics
  static int findNearest(List<int> target) {
    int bestIdx = 0;
    int bestDist = 0x7FFFFFFF;

    for (int i = 0; i < entries; i++) {
      final entry = _codebook[i];
      int dist = 0;
      for (int h = 0; h < harmonics; h++) {
        final d = entry[h] - target[h];
        dist += d * d;
      }
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        if (dist == 0) break;
      }
    }
    return bestIdx;
  }
}
