// markdown_text.dart — minimal inline markdown renderer (no deps)
//
// Supports:
//   - # / ## / ### headings
//   - **bold**, *italic*, `code`
//   - ``` fenced code blocks
//   - - or * bullet lists
//   - blank-line paragraph breaks

import 'package:flutter/material.dart';

// === invariants ===
// - _parseInline 不返回 null, 至少 1 span
// - 行内正则顺序: code > bold > italic, 按 match 起点最早优先
// - flushPara 在新行 / 块级 / 列表时调用, 保证段落合并
// - 未闭合 ``` 当作普通文本 (不进入 inCode 状态)

List<InlineSpan> _parseInline(String s, TextStyle base) {
  final spans = <InlineSpan>[];
  final code = RegExp(r'`([^`\n]+)`');
  final bold = RegExp(r'\*\*([^*\n]+)\*\*');
  final italic = RegExp(r'(?<!\*)\*([^*\n]+)\*(?!\*)');
  int i = 0;
  while (i < s.length) {
    final cm = code.firstMatch(s.substring(i));
    final bm = bold.firstMatch(s.substring(i));
    final im = italic.firstMatch(s.substring(i));
    final next = <Map<String, dynamic>>[
      if (cm != null) {'k': 'c', 'm': cm, 'start': cm.start, 'end': cm.end},
      if (bm != null) {'k': 'b', 'm': bm, 'start': bm.start, 'end': bm.end},
      if (im != null) {'k': 'i', 'm': im, 'start': im.start, 'end': im.end},
    ];
    if (next.isEmpty) { spans.add(TextSpan(text: s.substring(i), style: base)); break; }
    next.sort((a, b) => (a['start'] as int).compareTo(b['start'] as int));
    final first = next.first;
    final start = first['start'] as int;
    final end = first['end'] as int;
    if (start > 0) spans.add(TextSpan(text: s.substring(i, i + start), style: base));
    final m = first['m'] as RegExpMatch;
    final inner = m.group(1) ?? '';
    switch (first['k']) {
      case 'c':
        spans.add(TextSpan(text: inner, style: base.copyWith(
          fontFamily: 'monospace',
          fontSize: (base.fontSize ?? 14) - 1,
          backgroundColor: Colors.black.withValues(alpha: 0.2),
        )));
        break;
      case 'b':
        spans.add(TextSpan(text: inner, style: base.copyWith(fontWeight: FontWeight.w600)));
        break;
      case 'i':
        spans.add(TextSpan(text: inner, style: base.copyWith(fontStyle: FontStyle.italic)));
        break;
    }
    i += end;
  }
  return spans;
}

class MarkdownText extends StatelessWidget {
  final String source;
  final TextStyle base;
  const MarkdownText({super.key, required this.source, required this.base});

  @override
  Widget build(BuildContext context) {
    final lines = source.split('\n');
    final widgets = <Widget>[];
    final buf = StringBuffer();
    bool inCode = false;
    final codeBuf = StringBuffer();

    void flushPara() {
      if (buf.isEmpty) return;
      final spans = _parseInline(buf.toString(), base);
      widgets.add(Padding(
        padding: const EdgeInsets.symmetric(vertical: 1),
        child: RichText(text: TextSpan(children: spans, style: base.copyWith(height: 1.35))),
      ));
      buf.clear();
    }

    void flushCode() {
      widgets.add(Container(
        width: double.infinity,
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.35),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          codeBuf.toString().trimRight(),
          style: base.copyWith(fontFamily: 'monospace', fontSize: (base.fontSize ?? 14) - 1, height: 1.3),
        ),
      ));
      codeBuf.clear();
    }

    for (final line in lines) {
      final fence = RegExp(r'^```(\w*)\s*$').firstMatch(line);
      if (fence != null) {
        if (inCode) { flushCode(); inCode = false; }
        else { flushPara(); inCode = true; }
        continue;
      }
      if (inCode) { codeBuf.writeln(line); continue; }
      if (line.trimLeft().startsWith('### ')) {
        flushPara();
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 6, bottom: 2),
          child: Text(line.trimLeft().substring(4), style: base.copyWith(fontWeight: FontWeight.w700, fontSize: (base.fontSize ?? 14) + 2)),
        ));
        continue;
      }
      if (line.trimLeft().startsWith('## ')) {
        flushPara();
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 2),
          child: Text(line.trimLeft().substring(3), style: base.copyWith(fontWeight: FontWeight.w700, fontSize: (base.fontSize ?? 14) + 4)),
        ));
        continue;
      }
      if (line.trimLeft().startsWith('# ')) {
        flushPara();
        widgets.add(Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 2),
          child: Text(line.trimLeft().substring(2), style: base.copyWith(fontWeight: FontWeight.w700, fontSize: (base.fontSize ?? 14) + 6)),
        ));
        continue;
      }
      final bullet = RegExp(r'^\s*[-*]\s+').firstMatch(line);
      if (bullet != null) {
        flushPara();
        widgets.add(Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(width: 4),
            Text('• ', style: base),
            Expanded(child: RichText(text: TextSpan(children: _parseInline(line.trimLeft().substring(2), base), style: base.copyWith(height: 1.3)))),
          ],
        ));
        continue;
      }
      if (line.trim().isEmpty) { flushPara(); continue; }
      buf.writeln(line);
    }
    if (inCode) flushCode();
    flushPara();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: widgets);
  }
}
