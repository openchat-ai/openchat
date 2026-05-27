import 'dart:typed_data';
import 'harmonic_codebook.dart';

const int epcBytes = 12; // 96 bits

/// EPC-96 Tag types
enum EpcTagType {
  spectrum(0x02),   // codebook-matched pitched tones
  audio(0x03);       // noise residual / unpitched

  final int value;
  const EpcTagType(this.value);
  static EpcTagType fromValue(int v) =>
      EpcTagType.values.firstWhere((e) => e.value == v, orElse: () => audio);
}

/// EPC-96: 96 bits, 12 bytes per pitched component.
///
/// Spectrum tag (0x02) — 位分配:
///   Byte
///   [0]      tagType=0x02                             8b
///   [1]      trackId(4) | spare(4)                    8b
///   [2..3]   codebookIdx(12) | spare(4)               16b ← 4096码本索引
///   [4]      midiNote(7) | onset(1)                   8b  ← 音高+起音标记
///   [5]      cent(6) | spare(2)                       8b  ← 精细调音
///   [6]      vel(7) | spare(1)                        8b  ← 力度
///   [7]      rms                                      8b  ← 能量
///   [8..11]  spare 32b                                32b
///   Total: 8+8+16+8+8+8+8+32 = 96b ✓
///
/// Audio tag (0x03) — unchanged:
///   [0]      tagType=0x03                             8b
///   [1]      trackId(4) | spare(4)                    8b
///   [2..5]   subBands[0..3]                          32b
///   [6]      centroid                                 8b
///   [7]      zcr                                      8b
///   [8]      spread                                   8b
///   [9]      spare                                    8b
///   [10..11] subBands[4..5]                          16b
class EpcTag {
  final EpcTagType type;
  int trackId = 0;

  // Spectrum fields
  int codebookIdx = 0; // 0..4095
  int midiNote = 60;   // 21..108
  int cent = 0;        // -32..31 → stored as 0..63, decoded as -32..+31
  int velocity = 64;   // 0..127
  int rms = 0;
  int onsetFlag = 0;   // 0=none, 1=attack, 2=release, 3=pedal
  int spare = 0;

  // Audio fields
  final List<int> subBands = List.filled(6, 0);
  int centroid = 0, zcr = 0, spread = 0;

  EpcTag({required this.type});

  /// Set from raw harmonics (encode path): find nearest codebook match
  void setHarmonics(List<int> h, int r, int note, int vel) {
    codebookIdx = HarmonicCodebook.findNearest(h);
    midiNote = note.clamp(0, 127);
    velocity = vel.clamp(0, 127);
    rms = r.clamp(0, 255);
  }

  /// Get decoded harmonics for synthesis (decode path)
  List<int> get harmonics => HarmonicCodebook.get(codebookIdx);

  void setAudio(List<int> sb, int c, int z, int s) {
    for (int i = 0; i < 6 && i < sb.length; i++) subBands[i] = sb[i];
    centroid = c; zcr = z; spread = s;
  }

  Uint8List pack() {
    final buf = Uint8List(epcBytes);

    switch (type) {
      case EpcTagType.spectrum:
        // Byte 0: tagType
        buf[0] = type.value;
        // Byte 1: trackId | spare
        buf[1] = (trackId << 4) & 0xF0;
        // Bytes 2-3: codebookIdx(12) | spare(4)
        buf[2] = (codebookIdx >> 4) & 0xFF;
        buf[3] = ((codebookIdx & 0x0F) << 4) & 0xF0;
        // Byte 4: midiNote(7) | onset(1)
        buf[4] = ((midiNote & 0x7F) << 1) | (onsetFlag & 1);
        // Byte 5: cent(6) | spare(2)
        buf[5] = ((cent + 32) << 2) & 0xFC;
        // Byte 6: vel(7) | spare(1)
        buf[6] = (velocity << 1) & 0xFE;
        // Byte 7: rms
        buf[7] = rms;
        break;

      case EpcTagType.audio:
        buf[0] = type.value;
        buf[1] = (trackId << 4) & 0xF0;
        for (int i = 0; i < 4; i++) buf[2 + i] = subBands[i];
        buf[6] = centroid;
        buf[7] = zcr;
        buf[8] = spread;
        for (int i = 4; i < 6; i++) buf[10 + (i - 4)] = subBands[i];
        break;
    }

    return buf;
  }

  static EpcTag unpack(Uint8List data) {
    final type = EpcTagType.fromValue(data[0]);
    final tag = EpcTag(type: type);

    switch (type) {
      case EpcTagType.spectrum:
        tag.trackId = (data[1] >> 4) & 0x0F;
        tag.codebookIdx = (data[2] << 4) | ((data[3] >> 4) & 0x0F);
        tag.midiNote = (data[4] >> 1) & 0x7F;
        tag.onsetFlag = data[4] & 1;
        tag.cent = ((data[5] >> 2) & 0x3F) - 32;
        tag.velocity = (data[6] >> 1) & 0x7F;
        tag.rms = data[7];
        break;

      case EpcTagType.audio:
        tag.trackId = (data[1] >> 4) & 0x0F;
        for (int i = 0; i < 4; i++) tag.subBands[i] = data[2 + i];
        tag.centroid = data[6];
        tag.zcr = data[7];
        tag.spread = data[8];
        for (int i = 4; i < 6; i++) tag.subBands[i] = data[10 + (i - 4)];
        break;
    }

    return tag;
  }
}
