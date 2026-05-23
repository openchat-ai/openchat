import 'package:flutter/material.dart';

class CodeItem {
  final String name;
  final String type;
  final int line;
  CodeItem(this.name, this.type, this.line);
}

class CodeNavigatorBar extends StatelessWidget {
  final String currentPath;
  final List<String> pathParts;
  final Function(String) onPathTap;

  const CodeNavigatorBar({
    super.key,
    required this.currentPath,
    required this.pathParts,
    required this.onPathTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      color: const Color(0xFF2D2D3F),
      child: Row(
        children: [
          const Icon(Icons.folder, color: Colors.amber, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (int i = 0; i < pathParts.length; i++) ...[
                    GestureDetector(
                      onTap: () => onPathTap(pathParts.sublist(0, i + 1).join('/')),
                      child: Text(
                        pathParts[i],
                        style: TextStyle(
                          color: i == pathParts.length - 1 ? Colors.white : Colors.cyan,
                          fontFamily: 'monospace',
                          fontSize: 13,
                        ),
                      ),
                    ),
                    if (i < pathParts.length - 1)
                      const Text(' / ', style: TextStyle(color: Colors.grey, fontFamily: 'monospace')),
                  ],
                ],
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.arrow_drop_down, color: Colors.white70, size: 20),
            onPressed: () {},
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
          ),
        ],
      ),
    );
  }
}

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

class OutlinePanel extends StatelessWidget {
  final List<CodeItem> items;
  final Function(String name, String type, int line) onItemTap;

  const OutlinePanel({
    super.key,
    required this.items,
    required this.onItemTap,
  });

  @override
  Widget build(BuildContext context) {
    final grouped = <String, List<CodeItem>>{};
    for (final item in items) {
      grouped.putIfAbsent(item.type, () => []).add(item);
    }

    return Container(
      width: 200,
      color: const Color(0xFF252536),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            color: const Color(0xFF2D2D3F),
            child: const Row(
              children: [
                Icon(Icons.account_tree, color: Colors.green, size: 16),
                SizedBox(width: 8),
                Text('大纲', style: TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              children: grouped.entries.expand((entry) => [
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
                  child: Text(
                    _getTypeName(entry.key),
                    style: TextStyle(color: _getTypeColor(entry.key), fontSize: 11, fontWeight: FontWeight.bold),
                  ),
                ),
                ...entry.value.map((item) => ListTile(
                  dense: true,
                  leading: Icon(_getTypeIcon(item.type), color: _getTypeColor(item.type), size: 16),
                  title: Text(item.name, style: const TextStyle(color: Colors.white70, fontSize: 12, fontFamily: 'monospace')),
                  trailing: Text('${item.line}', style: const TextStyle(color: Colors.grey, fontSize: 10)),
                  onTap: () => onItemTap(item.name, item.type, item.line),
                )),
              ]).toList(),
            ),
          ),
        ],
      ),
    );
  }

  String _getTypeName(String type) {
    switch (type) {
      case 'class': return '�?(Classes)';
      case 'function': return '函数 (Functions)';
      case 'method': return '方法 (Methods)';
      case 'variable': return '变量 (Variables)';
      case 'import': return '导入 (Imports)';
      default: return type;
    }
  }

  Color _getTypeColor(String type) {
    switch (type) {
      case 'class': return Colors.purple;
      case 'function': return Colors.green;
      case 'method': return Colors.cyan;
      case 'variable': return Colors.orange;
      case 'import': return Colors.cyan;
      default: return Colors.grey;
    }
  }

  IconData _getTypeIcon(String type) {
    switch (type) {
      case 'class': return Icons.class_;
      case 'function': return Icons.functions;
      case 'method': return Icons.build;
      case 'variable': return Icons.data_object;
      case 'import': return Icons.download;
      default: return Icons.code;
    }
  }
}
