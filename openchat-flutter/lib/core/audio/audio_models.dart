import 'dart:typed_data';

class ProcessedFrame {
  Uint8List data;
  final int timestamp;
  double? vad;
  bool? isSpeech;
  double? speechProbability;

  ProcessedFrame({required this.data, required this.timestamp});
}

class AudioPipelineStats {
  final int totalFrames;
  final int speechFrames;
  final int noiseFrames;
  final String speechRatio;
  final String totalSpeechTime;
  final bool vadEnabled;
  final bool rnnoiseEnabled;
  final bool rnnoiseReady;
  final String rnnoiseAvgTime;

  AudioPipelineStats({
    required this.totalFrames,
    required this.speechFrames,
    required this.noiseFrames,
    required this.speechRatio,
    required this.totalSpeechTime,
    required this.vadEnabled,
    required this.rnnoiseEnabled,
    required this.rnnoiseReady,
    required this.rnnoiseAvgTime,
  });
}
