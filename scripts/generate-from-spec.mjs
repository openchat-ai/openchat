#!/usr/bin/env node
/**
 * generate-from-spec.mjs — 从 .spec.md 自动生成 Dart 骨架文件
 *
 * 用法:
 *   node scripts/generate-from-spec.mjs <spec.md路径...>
 *   node scripts/generate-from-spec.mjs --staged
 *
 * 对每个不在文件清单中的 dart 文件，生成骨架（类定义 + 方法 stub + invariants）
 * 已有文件跳过（不覆盖）。
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';

const cwd = process.cwd();

function snakeToPascal(s) {
  return s.replace(/(?:^|_)(\w)/g, (_, c) => c.toUpperCase());
}

function fileNameToClass(file) {
  return snakeToPascal(basename(file, '.dart'));
}

// ── 解析 spec ──────────────────────────────────────────────────
function parseSpec(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const specDir = dirname(resolve(cwd, filePath));

  // 解析文件清单
  const fileEntries = [];
  const fileTableRegex = /\|\s*`([^`]+\.dart)`\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/g;
  let m;
  while ((m = fileTableRegex.exec(content)) !== null) {
    fileEntries.push({ file: m[1], desc: m[2].trim(), limit: parseInt(m[3]) });
  }

  // 解析接口签名（第一个 dart 代码块）
  const ifaceMatch = content.match(/```dart\n([\s\S]*?)```/);
  const interfaceCode = ifaceMatch ? ifaceMatch[1] : '';

  // 提取类定义
  const classDefs = [];
  const classRegex = /(class\s+\w+(?:<[\s\S]*?>)?[\s\S]*?)(?=\nclass\s+\w|$)/g;
  let cm;
  while ((cm = classRegex.exec(interfaceCode)) !== null) {
    classDefs.push(cm[1]);
  }
  if (classDefs.length === 0 && interfaceCode) {
    classDefs.push(interfaceCode);
  }

  // 解析 invariants
  const invMatch = content.match(/```\n(\/\/ === invariants ===[\s\S]*?)```/);
  const invariants = invMatch ? invMatch[1].trim() : '';

  // 解析检查点
  const checkpoints = [];
  const cpRegex = /\| C(\d+) \s*\|\s*`?\[C\1\]/g;
  while ((m = cpRegex.exec(content)) !== null) {
    checkpoints.push(`C${m[1]}`);
  }

  // 提取标题
  const titleMatch = content.match(/^# spec:\s*(.*)$/m);
  const title = titleMatch ? titleMatch[1].trim() : fileNameToClass(basename(filePath, '.spec.md'));

  return { specDir, fileEntries, classDefs, invariants, checkpoints, title };
}

// ── 生成导入行 ────────────────────────────────────────────────
function generateImports(desc) {
  const imports = new Set();
  imports.add("import 'dart:async';");
  imports.add("import 'dart:developer' show log;");
  imports.add("import 'dart:math';");
  if (/S3|七牛|上传|下载|qiniu|存储/i.test(desc)) {
    imports.add("import 'dart:typed_data';");
    imports.add("import '../../core/api/qiniu_direct_client.dart';");
  }
  if (/编码|解码|codec|lmdn|processor/i.test(desc)) {
    imports.add("import '../../core/audio/lmdn_codec.dart';");
  }
  if (/录音|record/i.test(desc)) {
    imports.add("import 'package:record/record.dart';");
  }
  if (/播放|play|audio/i.test(desc)) {
    imports.add("import 'package:audioplayers/audioplayers.dart';");
  }
  if (/prefs|配置|共享/i.test(desc)) {
    imports.add("import 'package:shared_preferences/shared_preferences.dart';");
  }
  if (/UI|渲染|气泡|输入|消息|screen/i.test(desc)) {
    imports.add("import 'package:flutter/material.dart';");
    imports.add("import 'package:flutter_riverpod/flutter_riverpod.dart';");
  }
  if (/bridge|ws|websocket/i.test(desc)) {
    imports.add("import '../../core/api/bridge_ws_client.dart';");
  }
  if (/theme|主题|外观/i.test(desc)) {
    imports.add("import '../../core/theme/app_theme.dart';");
  }
  return [...imports].join('\n');
}

// ── 将裸声明 method(); 转为 method() { throw UnimplementedError; } ──
function transformClassBody(raw, classNameForErr) {
  // 替换所有方法声明: ReturnType name(params); → full stub
  const methodRe = /^(\s*)((?:\w+\s*<[^>]*>\s+|\w+\s+)(\w+)\s*\([^)]*\)\s*);\s*$/gm;
  return raw.replace(methodRe, (match, indent, sig, name) => {
    return `${indent}${sig} {\n${indent}    log('[TODO] ${classNameForErr}.${name} called');\n${indent}    throw UnimplementedError('${classNameForErr}.${name}');\n${indent}  }`;
  });
}

// ── 获取字段声明（从 raw class body 提取）──────────────────────
function extractFields(classBody) {
  const fields = [];
  const fieldRe = /^\s*(final|var|late\s+final)?\s*\S+\s+\S+\s*[=;]/gm;
  let m;
  while ((m = fieldRe.exec(classBody)) !== null) {
    fields.push(m[0].trim());
  }
  return fields;
}

// ── 生成 Dart 骨架文件 ────────────────────────────────────────
function generateDartFile({ specDir, file, desc, limit, classDefs, invariants, checkpoints, title }) {
  const fullPath = resolve(specDir, file);
  if (existsSync(fullPath)) {
    return console.log(`  SKIP ${file} (exists)`);
  }

  const className = fileNameToClass(file);
  const imports = generateImports(desc);

  // 从 spec 找对应类定义
  const classBody = classDefs.find(cd => cd.includes(`class ${className}`)) ||
                    classDefs.find(cd => cd.includes(`class ${fileNameToClass(file)}`)) || '';

  // invariants（去重）
  const invariantsBlock = invariants || `// === invariants ===\n// - TODO: 列出运行时约束`;

  // 添加检查点注释到 invariants 之后
  const cpLine = checkpoints.length > 0 ? `\n// 检查点: ${checkpoints.join(', ')}` : '';

  // 生成类声明
  const isWidget = /UI|渲染|screen/i.test(desc);
  let classDecl;
  if (isWidget) {
    classDecl = `class ${className} extends ConsumerStatefulWidget {
  const ${className}({super.key});
  @override
  ConsumerState<${className}> createState() => _${className}State();
}

class _${className}State extends ConsumerState<${className}> {
  @override
  Widget build(BuildContext context) {
    // TODO: impl build per spec
    return const Placeholder();
  }
}`;
  } else if (classBody) {
    const transformed = transformClassBody(classBody, className);
    classDecl = transformed;
  } else {
    classDecl = `class ${className} {
  // TODO: impl per spec
}`;
  }

  const content = `// Generated from ${basename(specDir)}/${file.replace('.dart', '.spec.md')}
// spec: ${title}

${imports}

${invariantsBlock}${cpLine}

${classDecl}
`;

  writeFileSync(fullPath, content, 'utf-8');
  console.log(`  CREATE ${file} (${desc}, ≤${limit}行)`);
}

// ── 主入口 ─────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  let specFiles = [];

  if (args.includes('--staged')) {
    const raw = execSync('git diff --cached --name-only --diff-filter=ACMR', { cwd, encoding: 'utf-8' });
    specFiles = raw.split('\n').filter(f => f.endsWith('.spec.md'));
    if (specFiles.length === 0) {
      console.log('No staged .spec.md files found.');
      process.exit(0);
    }
  } else if (args.length === 0) {
    console.error('Usage: node scripts/generate-from-spec.mjs <spec.md paths...>');
    console.error('       node scripts/generate-from-spec.mjs --staged');
    process.exit(1);
  } else {
    specFiles = args;
  }

  for (const sf of specFiles) {
    const fullPath = resolve(cwd, sf);
    if (!existsSync(fullPath)) {
      console.error(`Spec not found: ${sf}`);
      continue;
    }
    console.log(`\nParsing: ${sf}`);
    const parsed = parseSpec(sf);
    if (parsed.fileEntries.length === 0) {
      console.log('  No file entries found in spec.');
      continue;
    }
    for (const entry of parsed.fileEntries) {
      generateDartFile({
        specDir: parsed.specDir,
        file: entry.file,
        desc: entry.desc,
        limit: entry.limit,
        classDefs: parsed.classDefs,
        invariants: parsed.invariants,
        checkpoints: parsed.checkpoints,
        title: parsed.title,
      });
    }
  }
}

main();
