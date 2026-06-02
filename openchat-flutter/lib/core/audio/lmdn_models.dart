import 'dart:typed_data';

class LmdnEncoded {
  final Uint8List data;
  final int frameCount;
  LmdnEncoded({required this.data, required this.frameCount});
}

class ScoreNote {
  final int midi;
  final double startSec;
  final double durSec;
  const ScoreNote({required this.midi, required this.startSec, required this.durSec});
}

class ProcessedAudioResult {
  final Uint8List pcm;
  final List<ScoreNote> notes;
  ProcessedAudioResult({required this.pcm, required this.notes});
}

class LmdnDecoded {
  final Uint8List pcm;
  final int decodeTime;
  final List<ScoreNote> notes;
  LmdnDecoded({required this.pcm, required this.decodeTime, List<ScoreNote>? notes})
      : notes = notes ?? const [];
}
