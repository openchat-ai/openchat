import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';
import '../../../core/models/resident_model.dart';

class ResidentFamily extends StatelessWidget {
  final AppTheme theme;
  final Resident resident;
  final List<Resident> children;
  const ResidentFamily({super.key, required this.theme, required this.resident, required this.children});

  @override
  Widget build(BuildContext context) {
    return SliverToBoxAdapter(child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('家庭关系', style: TextStyle(color: theme.textPrimary, fontSize: 18, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (resident.parentId != null)
          _relationCard('母体居民', resident.parentId.toString(), Icons.account_tree_outlined),
        if (children.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text('子居民 (${children.length})', style: TextStyle(color: theme.textSecondary, fontSize: 13)),
          const SizedBox(height: 8),
          ...children.map((c) => Padding(padding: const EdgeInsets.only(bottom: 8), child: _childTile(c))),
        ],
        if (resident.parentId == null && children.isEmpty)
          Padding(padding: const EdgeInsets.all(16), child: Text('暂无家庭关系', style: TextStyle(color: theme.textTertiary, fontSize: 13))),
      ]),
    ));
  }

  Widget _relationCard(String label, String value, IconData icon) => Container(
    margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12)),
    child: Row(children: [
      Icon(icon, color: theme.warning, size: 20), const SizedBox(width: 12),
      Text('$label: ', style: TextStyle(color: theme.textSecondary, fontSize: 13)),
      Text(value, style: TextStyle(color: theme.textPrimary, fontSize: 13, fontWeight: FontWeight.w500)),
    ]));

  Widget _childTile(Resident child) => Container(padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12), border: Border.all(color: theme.textTertiary.withValues(alpha: 0.08))),
    child: Row(children: [
      Container(width: 40, height: 40, decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary), borderRadius: BorderRadius.circular(10)),
        child: Center(child: Text(child.name.isNotEmpty ? child.name[0] : '?', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)))),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(child.name, style: TextStyle(color: theme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
        Text('ID: ${child.id} · ${child.home}', style: TextStyle(color: theme.textTertiary, fontSize: 11)),
      ])),
    ]));
}
