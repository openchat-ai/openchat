/// Custom binary frame protocol for P2P voice
///
/// Frame format (binary):
/// ┌─────┬──────┬────────┬──────────┬──────────┐
/// │ MAG │ TYPE │ LEN(2) │ PAYLOAD  │ CRC(1)   │
/// │ 2B  │ 1B   │ 2B     │ 0-65535  │ 1B       │
/// └─────┴──────┴────────┴──────────┴──────────┘
///
/// MAG: 0xOC 0x7A (OpenChat magic)
/// TYPE: 0x01=audio 0x02=signal 0x03=ack 0x04=route 0x05=ping 0x06=pong
/// LEN: payload length (big-endian)
/// CRC: XOR of all bytes in MAG+TYPE+LEN+PAYLOAD

class FrameType {
  static const int audio = 0x01;
  static const int signal = 0x02;
  static const int ack = 0x03;
  static const int route = 0x04;
  static const int ping = 0x05;
  static const int pong = 0x06;
}

class VoiceFrame {
  static const List<int> _magic = [0x0C, 0x7A];

  final int type;
  final List<int> payload;

  VoiceFrame(this.type, this.payload);

  List<int> encode() {
    final len = payload.length;
    final header = [..._magic, type, len >> 8, len & 0xFF];
    final crc = _checksum([...header, ...payload]);
    return [...header, ...payload, crc];
  }

  static VoiceFrame? decode(List<int> data) {
    if (data.length < 6) return null; // header(5) + crc(1)
    if (data[0] != _magic[0] || data[1] != _magic[1]) return null;

    final type = data[2];
    final len = (data[3] << 8) | data[4];
    if (data.length < 6 + len) return null; // incomplete

    final payload = data.sublist(5, 5 + len);
    final crc = data[5 + len];
    if (_checksum([...data.sublist(0, 5 + len)]) != crc) return null;

    return VoiceFrame(type, payload);
  }

  static int _checksum(List<int> data) {
    return data.fold(0, (sum, b) => sum ^ b);
  }
}
