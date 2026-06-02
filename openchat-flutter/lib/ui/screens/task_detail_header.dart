import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class TaskDetailHeader extends StatelessWidget {
  final String agentId;
  final AppTheme theme;
  const TaskDetailHeader({super.key, required this.agentId, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.gradientPrimary[0].withValues(alpha: 0.2),
            theme.gradientPrimary[1].withValues(alpha: 0.1),
          ],
        ),
        borderRadius: BorderRadius.circular(theme.radiusLarge),
        border: Border.all(
          color: theme.gradientPrimary[0].withValues(alpha: 0.3),
          width: 1,
        ),
        boxShadow: theme.useGlow ? [
          BoxShadow(
            color: theme.primary.withValues(alpha: 0.15),
            blurRadius: 25,
            spreadRadius: -5,
          ),
        ] : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: theme.gradientPrimary),
                  borderRadius: BorderRadius.circular(theme.radiusMedium - 4),
                  boxShadow: theme.useGlow ? [
                    BoxShadow(
                      color: theme.primary.withValues(alpha: 0.4),
                      blurRadius: 15,
                      spreadRadius: 2,
                    ),
                  ] : null,
                ),
                child: const Icon(
                  Icons.task_alt,
                  color: Colors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Code Review #$agentId',
                      style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '鍒涘缓浜?024-01-15',
                      style: TextStyle(
                        color: theme.textTertiary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Review project code for security vulnerabilities and performance issues.',
            style: TextStyle(
              color: theme.textSecondary,
              fontSize: 14,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}
