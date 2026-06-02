import 'package:flutter/material.dart';

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
