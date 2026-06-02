import 'dart:math';
import 'package:flutter/material.dart';
import '../../../core/audio/audio.dart';

class ResidentMusicScore extends StatefulWidget {
  final String title;
  final List<ScoreNote> notes;
  final double bpm;
  const ResidentMusicScore({super.key, required this.title, required this.notes, this.bpm = 120});

  @override
  State<ResidentMusicScore> createState() => _ResidentMusicScoreState();
}

class _ResidentMusicScoreState extends State<ResidentMusicScore> with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  bool _playing = false;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(seconds: 4));
    _ctrl.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _toggle() {
    if (_playing) { _ctrl.stop(); }
    else { _ctrl.forward(from: _ctrl.value); }
    setState(() => _playing = !_playing);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      height: 260,
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(children: [
            Text(widget.title, style: theme.textTheme.titleSmall),
            const Spacer(),
            IconButton(
              icon: Icon(_playing ? Icons.stop_rounded : Icons.play_arrow_rounded, size: 28),
              onPressed: _toggle,
            ),
          ]),
        ),
        Expanded(child: LayoutBuilder(builder: (context, cons) {
          final totalSec = widget.notes.isEmpty
              ? 4.0
              : widget.notes.map((n) => n.startSec + n.durSec).reduce(max).clamp(4.0, 3600.0);
          return CustomPaint(
            size: Size(cons.maxWidth, cons.maxHeight),
            painter: _StaffPainter(
              notes: widget.notes,
              totalSec: totalSec,
              progress: _ctrl.value,
            ),
          );
        })),
      ]),
    );
  }
}

class _StaffPainter extends CustomPainter {
  final List<ScoreNote> notes;
  final double totalSec;
  final double progress;

  _StaffPainter({required this.notes, required this.totalSec, required this.progress});

  @override
  void paint(Canvas c, Size s) {
    final h = s.height, w = s.width;
    final marginT = 16.0, marginB = 24.0;
    final staffH = h - marginT - marginB;
    final lineGap = staffH / 8;
    final staffTop = marginT;
    final staffBot = marginT + lineGap * 4;

    final lineP = Paint()..color = Colors.grey[700]!..strokeWidth = 1;
    for (int i = 0; i < 5; i++) {
      final y = staffTop + i * lineGap;
      c.drawLine(Offset(0, y), Offset(w, y), lineP);
    }

    final now = progress * totalSec;
    final scrollW = (w - 40).clamp(200.0, 2000.0);
    final scrollOff = now / totalSec * scrollW;

    final refMidi = 64;
    final dotR = lineGap * 0.35;

    for (final note in notes) {
      final nx = w - 20 - ((note.startSec / totalSec) * scrollW - scrollOff);
      if (nx < -40 || nx > w + 40) continue;
      final nw = (note.durSec / totalSec) * scrollW;
      final staffPos = (note.midi - refMidi) / 2.0;
      final ny = staffBot - staffPos * lineGap;

      final played = note.startSec + note.durSec <= now;
      final noteP = Paint()..color = played ? Colors.grey : const Color(0xFF4FC3F7);
      c.drawOval(Rect.fromCenter(center: Offset(nx, ny), width: nw.clamp(6, nw), height: dotR * 2), noteP);

      if (staffPos < 0) {
        final ledgerY = staffBot - (-1) * lineGap;
        c.drawLine(Offset(nx - nw / 2 - 2, ledgerY), Offset(nx + nw / 2 + 2, ledgerY), lineP);
      }
      if (staffPos == 0) {
        final ledgerY = staffBot - 0 * lineGap;
        c.drawLine(Offset(nx - nw / 2 - 2, ledgerY), Offset(nx + nw / 2 + 2, ledgerY), lineP);
      }
      if (note.midi >= 72 && staffPos > 3.5) {
        for (double p = 4; p <= staffPos; p += 1) {
          final ledgerY = staffBot - p * lineGap;
          c.drawLine(Offset(nx - nw / 2 - 2, ledgerY), Offset(nx + nw / 2 + 2, ledgerY), lineP);
        }
      }
      if (note.midi <= 60 && staffPos < -0.5) {
        for (double p = -1; p >= staffPos; p -= 1) {
          final ledgerY = staffBot - p * lineGap;
          c.drawLine(Offset(nx - nw / 2 - 2, ledgerY), Offset(nx + nw / 2 + 2, ledgerY), lineP);
        }
      }
    }

    final playP = Paint()..color = Colors.orangeAccent..strokeWidth = 2;
    final px = w - 20 - (0 - scrollOff);
    c.drawLine(Offset(px, marginT - 4), Offset(px, staffBot + 4), playP);
  }

  @override
  bool shouldRepaint(_StaffPainter old) => old.progress != progress || old.notes != notes;
}
