/// EPC-96 tag: 96 bits, 12 bytes per frame component.
/// Spectrum tag (0x02) carries raw subband energies (no codebook):
///   Byte[0]:    tagType=0x02                         8b
///   Byte[1]:    trackId(4) | instrument(4)           8b  ← 乐器类型(0-15)
///   Byte[2]:    midiNote(7) | onset(1)               8b
///   Byte[3]:    vel(7) | spare(1)                    8b
///   Byte[4]:    rms                                  8b
///   Byte[5-11]: subBands[0..10] × 5b each (mel-spaced)
///              bit-packed: 11×5 = 55b across 7 bytes
///              spare(1b)
///   Total: 8+8+8+8+8+55+1 = 96b ✓
///
/// Audio tag (0x03): unpitched noise — unchanged.
import 'dart:typed_data';

const int epcBytes = 12;
const int subBandCount = 11;
const int subBandBits = 5;

enum EpcTagType {
  spectrum(0x02),
  audio(0x03);

  final int value;
  const EpcTagType(this.value);
  static EpcTagType fromValue(int v) =>
      EpcTagType.values.firstWhere((e) => e.value == v, orElse: () => audio);
}

class EpcTag {
  final EpcTagType type;
  int trackId = 0;

  // Spectrum fields
  int instrument = 0; // 0=piano, 1=voice, 2=guitar, 3=strings
  int midiNote = 60;
  int onsetFlag = 0;
  int velocity = 64;
  int rms = 0;
  final List<int> subBands = List.filled(subBandCount, 0); // 5 bits each, 0..31

  // Audio fields (unchanged)
  final List<int> audioSubBands = List.filled(6, 0);
  int centroid = 0, zcr = 0, spread = 0;

  EpcTag({required this.type});

  Uint8List pack() {
    final buf = Uint8List(epcBytes);
    buf[0] = type.value;
    buf[1] = (trackId << 4) & 0xF0;

    switch (type) {
      case EpcTagType.spectrum:
        buf[1] = (trackId << 4) | (instrument & 0x0F);
        buf[2] = ((midiNote & 0x7F) << 1) | (onsetFlag & 1);
        buf[3] = (velocity << 1) & 0xFE;
        buf[4] = rms;
        // Pack 11 × 5b subbands into bytes 5-11 (55 bits, 1 spare)
        int bit = 0;
        for (int i = 0; i < subBandCount; i++) {
          for (int b = 0; b < subBandBits; b++) {
            final byteIdx = 5 + (bit >> 3);
            final bitIdx = bit & 7;
            final mask = 1 << (7 - bitIdx);
            if ((subBands[i] >> (subBandBits - 1 - b) & 1) != 0) {
              if (byteIdx < epcBytes) buf[byteIdx] |= mask;
            }
            bit++;
          }
        }
        break;

      case EpcTagType.audio:
        buf[1] = (trackId << 4) & 0xF0;
        for (int i = 0; i < 4; i++) buf[2 + i] = audioSubBands[i];
        buf[6] = centroid;
        buf[7] = zcr;
        buf[8] = spread;
        for (int i = 4; i < 6; i++) buf[10 + (i - 4)] = audioSubBands[i];
        break;
    }
    return buf;
  }

  static EpcTag unpack(Uint8List data) {
    final type = EpcTagType.fromValue(data[0]);
    final tag = EpcTag(type: type);
    tag.trackId = (data[1] >> 4) & 0x0F;

    switch (type) {
      case EpcTagType.spectrum:
        tag.instrument = data[1] & 0x0F;
        tag.midiNote = (data[2] >> 1) & 0x7F;
        tag.onsetFlag = data[2] & 1;
        tag.velocity = (data[3] >> 1) & 0x7F;
        tag.rms = data[4];
        // Unpack 11 × 5b subbands from bytes 5-11
        int bit = 0;
        for (int i = 0; i < subBandCount; i++) {
          int val = 0;
          for (int b = 0; b < subBandBits; b++) {
            final byteIdx = 5 + (bit >> 3);
            final bitIdx = bit & 7;
            val = (val << 1) | ((data[byteIdx] >> (7 - bitIdx)) & 1);
            bit++;
          }
          tag.subBands[i] = val;
        }
        break;

      case EpcTagType.audio:
        for (int i = 0; i < 4; i++) tag.audioSubBands[i] = data[2 + i];
        tag.centroid = data[6];
        tag.zcr = data[7];
        tag.spread = data[8];
        for (int i = 4; i < 6; i++) tag.audioSubBands[i] = data[10 + (i - 4)];
        break;
    }
    return tag;
  }
}
