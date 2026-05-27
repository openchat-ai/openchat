/// EPC-96: 96 bits, 12 bytes. Spectrum tag (0x02) carries 7 harmonic bands × 8b,
/// positioned dynamically at F0 × 1..7. Byte[5-11] = band[0..6] directly.
///
/// Audio tag (0x03): unpitched noise — unchanged.
import 'dart:typed_data';

const int epcBytes = 12;
const int subBandCount = 7;
const int subBandBits = 8;

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
  final List<int> subBands = List.filled(subBandCount, 0); // 8 bits each, 0..255, F0-tracking

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
        // 7 × 8b harmonic bands → bytes 5-11 directly
        for (int i = 0; i < subBandCount; i++) buf[5 + i] = subBands[i];
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
        // 7 × 8b harmonic bands from bytes 5-11
        for (int i = 0; i < subBandCount; i++) tag.subBands[i] = data[5 + i];
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
