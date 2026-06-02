import 'package:flutter/material.dart';

const Color backgroundDark = Color(0xFF0A0A0F);
const Color backgroundCard = Color(0xFF12121A);
const Color backgroundElevated = Color(0xFF1A1A25);

const Color neonCyan = Color(0xFF00F0FF);
const Color neonPurple = Color(0xFFB829F7);
const Color neonPink = Color(0xFFFF2E8C);
const Color neonBlue = Color(0xFF2979FF);
const Color neonGreen = Color(0xFF00E676);
const Color neonOrange = Color(0xFFFF9100);

const Color textPrimary = Color(0xFFFFFFFF);
const Color textSecondary = Color(0xFFB0B0C0);
const Color textTertiary = Color(0xFF707080);

const double glassOpacity = 0.12;
const double glassBlur = 20.0;
const double glassBorderRadius = 24.0;
const double glassBorderRadiusSmall = 16.0;

const LinearGradient gradientCyanPurple = LinearGradient(
  colors: [neonCyan, neonPurple],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

const LinearGradient gradientPinkBlue = LinearGradient(
  colors: [neonPink, neonBlue],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

const LinearGradient gradientMulti = LinearGradient(
  colors: [neonCyan, neonPurple, neonPink],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

final BoxShadow glowCyan = BoxShadow(
  color: neonCyan.withValues(alpha: 0.4),
  blurRadius: 20,
  spreadRadius: 2,
);

final BoxShadow glowPurple = BoxShadow(
  color: neonPurple.withValues(alpha: 0.4),
  blurRadius: 20,
  spreadRadius: 2,
);

final BoxShadow glowPink = BoxShadow(
  color: neonPink.withValues(alpha: 0.4),
  blurRadius: 20,
  spreadRadius: 2,
);
