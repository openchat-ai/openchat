/// OpenChat frame protocol — RFID-style
///
/// BB | TYPE(1) | CMD(1) | PL(2) | PARAM(N) | CKSUM(1) | 7E
///
/// TYPE:
///   0x00 = command  (手机→Bridge)
///   0x01 = response (Bridge→手机)
///   0x02 = notify   (Bridge主动推送)
///
/// CMD:
///   0x01 = audio data
///   0x02 = signaling (call/accept/reject/gossip)
///   0x03 = ack
///   0x04 = route info
///   0x06 = heartbeat
///   0xFF = error
///
/// CKSUM = sum(TYPE + CMD + PL_HI + PL_LO + PARAM[0..N-1]) & 0xFF

class RfFrame {
  static const int _start = 0xBB;
  static const int _end = 0x7E;

  final int type;
  final int cmd;
  final List<int> param;

  RfFrame(this.type, this.cmd, this.param);

  /// BB | TYPE | CMD | PL(2) | PARAM | CKSUM | 7E
  List<int> encode() {
    final pl = param.length;
    final body = [type, cmd, pl >> 8, pl & 0xFF, ...param];
    final cksum = body.fold(0, (s, b) => (s + b) & 0xFF);
    return [_start, ...body, cksum, _end];
  }

  static RfFrame? decode(List<int> data) {
    if (data.length < 7) return null;
    if (data[0] != _start) return null;
    if (data.last != _end) return null;

    final type = data[1];
    final cmd = data[2];
    final pl = (data[3] << 8) | data[4];

    if (data.length < 7 + pl) return null;

    final param = data.sublist(5, 5 + pl);
    final body = [type, cmd, pl >> 8, pl & 0xFF, ...param];
    final cksum = data[5 + pl];
    final expected = body.fold(0, (s, b) => (s + b) & 0xFF);
    if (cksum != expected) return null;

    return RfFrame(type, cmd, param);
  }

  bool get isResponse => type == 0x01;
  bool get isError => type == 0x01 && cmd == 0xFF;
  int? get errorCode => isError && param.length >= 1 ? param[0] : null;
}

class Cmd {
  static const audio = 0x01;
  static const signal = 0x02;
  static const ack = 0x03;
  static const route = 0x04;
  static const heartbeat = 0x06;
  static const error = 0xFF;
}
