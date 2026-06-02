import 'package:flutter/material.dart';
import 'code_item.dart';

class CodeBlock extends StatelessWidget {
  final List<Map<String, dynamic>> lines;
  final Map<String, List<CodeItem>> codeItems;
  final Function(String name, String type, int line) onItemTap;

  const CodeBlock({
    super.key,
    required this.lines,
    required this.codeItems,
    required this.onItemTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF1E1E2E),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: lines.length,
        itemBuilder: (context, i) {
          final line = lines[i];
          final lineNum = i + 1;
          final allItems = codeItems['all'] ?? [];
          final lineItems = allItems.where((item) => item.line == lineNum).toList();
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 40,
                child: Text('$lineNum', style: const TextStyle(color: Colors.grey, fontSize: 13, fontFamily: 'monospace')),
              ),
              Expanded(
                child: _buildLineWithLinks(line['text'] as String, line['color'] as Color, lineItems),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildLineWithLinks(String text, Color baseColor, List<CodeItem> items) {
    if (items.isEmpty) {
      return Text(text, style: TextStyle(color: baseColor, fontSize: 13, fontFamily: 'monospace', height: 1.6));
    }
    final spans = <TextSpan>[];
    int lastEnd = 0;
    for (final item in items) {
      final idx = text.indexOf(item.name, lastEnd);
      if (idx >= 0 && idx >= lastEnd) {
        if (idx > lastEnd) {
          spans.add(TextSpan(text: text.substring(lastEnd, idx), style: TextStyle(color: baseColor)));
        }
        spans.add(TextSpan(
          text: item.name,
          style: TextStyle(
            color: _getTypeColor(item.type),
            decoration: TextDecoration.underline,
            decorationColor: _getTypeColor(item.type).withValues(alpha: 0.5),
          ),
        ));
        lastEnd = idx + item.name.length;
      }
    }
    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd), style: TextStyle(color: baseColor)));
    }
    return RichText(
      text: TextSpan(
        style: TextStyle(fontSize: 13, fontFamily: 'monospace', height: 1.6),
        children: spans,
      ),
    );
  }

  Color _getTypeColor(String type) {
    switch (type) {
      case 'class': return Colors.purple;
      case 'function': return Colors.green;
      case 'method': return Colors.cyan;
      case 'variable': return Colors.orange;
      case 'import': return Colors.cyan;
      default: return Colors.white;
    }
  }
}
