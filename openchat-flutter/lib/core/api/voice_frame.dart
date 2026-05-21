/// OpenChat frame protocol, modeled after RFID reader frame format
///
/// BB | TYPE(2) | LEN(2) | PAYLOAD(N) | CKSUM(1) | 7E
///
/// TYPE:
///   00 01 = audio frame
///   00 02 = signaling (call/accept/reject/gossip)
///   00 03 = ack
///   00 04 = route gossip
///   01 XX = response/error
///
/// CKSUM = XOR sum of bytes from TYPE[0] to last PAYLOAD byte
/// 7E = end marker (not included in checksum)

class RfFrame {
  static const int _start = 0xBB;
  static const int _end = 0x7E;

  final int typeHi;
  final int typeLo;
  final List<int> payload;

  RfFrame(this.typeHi, this.typeLo, this.payload);

  /// Encode to wire format: BB TYPE(2) LEN(2) PAYLOAD CKSUM 7E
  List<int> encode() {
    final len = payload.length;
    final body = [typeHi, typeLo, len >> 8, len & 0xFF, ...payload];
    final cksum = body.fold(0, (s, b) => (s + b) & 0xFF);
    return [_start, ...body, cksum, _end];
  }

  /// Decode from wire format. Returns null if incomplete/corrupt.
  static RfFrame? decode(List<int> data) {
    if (data.length < 7) return null;          // BB(1) + TYPE(2) + LEN(2) + CKSUM(1) + 7E = min 7
    if (data[0] != _start) return null;
    if (data.last != _end) return null;

    final typeHi = data[1];
    final typeLo = data[2];
    final len = (data[3] << 8) | data[4];

    if (data.length < 7 + len) return null;    // Incomplete frame

    final payload = data.sublist(5, 5 + len);
    final cksum = data[5 + len];

    // Verify checksum: sum from TYPE[0] to last payload byte
    final body = [typeHi, typeLo, len >> 8, len & 0xFF, ...payload];
    final expected = body.fold(0, (s, b) => (s + b) & 0xFF);
    if (cksum != expected) return null;

    return RfFrame(typeHi, typeLo, payload);
  }

  /// Check if this is a response frame (type starts with 0x01)
  bool get isResponse => typeHi == 0x01;
  bool get isError => typeHi == 0x01 && typeLo == 0xFF;

  /// Response payload helpers
  int? get errorCode => isError && payload.length >= 1 ? payload[0] : null;
}

/// Frame type constants
class FrameType {
  static const audio = [0x00, 0x01];
  static const signal = [0x00, 0x02];
  static const ack = [0x00, 0x03];
  static const route = [0x00, 0x04];
  static const responseOk = [0x01, 0x00];
  static const responseError = [0x01, 0xFF];
}
