import 'package:flutter/material.dart';
import 'code_item.dart';

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
      case 'class': return '类 (Classes)';
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
