const fs = require('fs');
const { execSync } = require('child_process');
const files = execSync('git ls-files "openchat-flutter/**/*.dart"', { encoding: 'utf-8' }).split('\n').filter(Boolean);

const issues = [];

for (const f of files) {
  let c;
  try { c = fs.readFileSync(f, 'utf-8'); } catch { continue; }
  const lines = c.split('\n');

  // 检查重复 import
  const imports = new Map();
  lines.forEach((l, i) => {
    const m = l.match(/^import\s+['"]([^'"]+)['"]/);
    if (m) {
      const p = m[1];
      if (imports.has(p)) {
        issues.push(`${f}:${i+1} 重复 import: ${p}`);
      } else {
        imports.set(p, i+1);
      }
    }
  });

  // 检查缺少分号（函数返回 + 下一行不是空行/结束符）
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i];
    // 跳过注释
    if (l.trim().startsWith('//') || l.trim().startsWith('/*') || l.trim().startsWith('*')) continue;
    if (l.trim() === '') continue;
    // 找到 { 开头的方法
    if (l.match(/^\s*(void|Future|String|int|bool|double|FutureOr|Widget|Map|List)\s+\w+\s*\([^)]*\)\s*(async\s*)?\{\s*$/)) {
      // 检查方法体内是否 return 时缺少分号
      // skip - hard to detect
    }
  }

  // 检查类不匹配 (extends ConsumerWidget 但是没有 import)
  if (c.includes('extends ConsumerWidget') && !c.includes("import 'package:flutter_riverpod/flutter_riverpod.dart'") && !c.includes("package:flutter_riverpod/")) {
    issues.push(`${f}: extends ConsumerWidget 但未导入 flutter_riverpod`);
  }

  // 检查 .of() 调用是否有效 (最常见的)
  // 跳过，因为是动态的
}

if (issues.length) {
  for (const i of issues) console.log(i);
} else {
  console.log('No issues found');
}
console.log('Total:', issues.length);
