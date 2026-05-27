/// EPC protocol version management.
/// Bump when the frame format changes (new instrument types, different bit layouts).

const int epcVersionMajor = 0;
const int epcVersionMinor = 1;

const int epcVersion = (epcVersionMajor << 8) | epcVersionMinor;

const int epcMagic1 = 0x45; // 'E'
const int epcMagic2 = 0x50; // 'P'
const int epcMagic3 = 0x43; // 'C'
const int epcMagic4 = 0x31; // '1'
const int epcHeaderSize = 8; // 4B magic + 2B version + 2B spare

/// Check if a recording header is valid and decodable by this version.
/// Returns null if OK, or an error string if not.
String? checkRecordingHeader(List<int> header) {
  if (header.length < epcHeaderSize) return 'Header too short';
  if (header[0] != epcMagic1 || header[1] != epcMagic2 ||
      header[2] != epcMagic3 || header[3] != epcMagic4) {
    return 'Invalid magic (not an EPC recording)';
  }
  final ver = (header[4] << 8) | header[5];
  final maj = ver >> 8;
  if (maj != epcVersionMajor) {
    return 'Unsupported EPC version: $maj.x (decoder: ${epcVersionMajor}.x)';
  }
  return null;
}
