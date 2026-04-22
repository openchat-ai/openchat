#!/usr/bin/env node

/**
 * 📊 文件分类详细分析
 * 分析所有未分类文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class DetailedClassifier {
  constructor() {
    this.filePatterns = {
      critical: [
        /^package\.json$/,
        /^\.git\//,
        /^\.gitignore$/,
        /^package-lock\.json$/,
        /^\.github\//,
        /^\.husky\//,
        /^app\//,
        /^bridge\//,
        /^protocol\//,
        /^docs\//,
        /\.ya?ml$/
      ],
      source: [
        /\.js$/,
        /\.ts$/,
        /\.jsx$/,
        /\.tsx$/,
        /\.py$/,
        /\.go$/,
        /\.rs$/
      ],
      temporary: [
        /\.log$/,
        /\.tmp$/,
        /\.cache$/,
        /\.bak$/,
        /~$/,
        /\.test-results$/
      ]
    };
  }

  classifyFile(filePath) {
    const fileName = path.basename(filePath);

    // 检查关键文件
    for (const pattern of this.filePatterns.critical) {
      if (pattern.test(filePath)) {
        return { type: 'critical', reason: '关键文件' };
      }
    }

    // 检查源代码
    for (const pattern of this.filePatterns.source) {
      if (pattern.test(fileName)) {
        return { type: 'source', reason: '源代码' };
      }
    }

    // 检查临时文件
    for (const pattern of this.filePatterns.temporary) {
      if (pattern.test(fileName)) {
        return { type: 'temporary', reason: '临时文件' };
      }
    }

    // 根据文件类型和位置分类
    const ext = path.extname(fileName);
    const dir = path.dirname(filePath);

    // 文档文件
    if (['.md', '.txt', '.rst', '.adoc'].includes(ext)) {
      return { type: 'documentation', reason: '文档' };
    }

    // 配置文件
    if (['.json', '.yaml', '.yml', '.toml', '.ini', '.conf'].includes(ext)) {
      return { type: 'configuration', reason: '配置文件' };
    }

    // 数据文件
    if (['.data', '.db', '.sqlite'].includes(ext)) {
      return { type: 'data', reason: '数据文件' };
    }

    // 目录
    if (fs.statSync(filePath).isDirectory()) {
      return { type: 'directory', reason: '目录' };
    }

    // 未知
    return { type: 'unknown', reason: '未知' };
  }

  scanDirectory(dir, maxDepth = 3, currentDepth = 0) {
    const files = [];
    if (currentDepth >= maxDepth) return files;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);

        // 跳过这些目录
        if (['node_modules', '.git', '.claude'].includes(entry)) continue;

        try {
          const stat = fs.statSync(fullPath);
          const relativePath = path.relative(__dirname, fullPath);

          if (stat.isDirectory()) {
            files.push({
              path: relativePath,
              fullPath,
              isDir: true,
              size: 0,
              mtime: stat.mtimeMs
            });
            files.push(...this.scanDirectory(fullPath, maxDepth, currentDepth + 1));
          } else {
            files.push({
              path: relativePath,
              fullPath,
              isDir: false,
              size: stat.size,
              mtime: stat.mtimeMs
            });
          }
        } catch (e) {
          // 跳过无权限文件
        }
      }
    } catch (e) {
      // 跳过无权限目录
    }

    return files;
  }

  analyze() {
    const files = this.scanDirectory(__dirname);
    const byType = {
      critical: [],
      source: [],
      documentation: [],
      configuration: [],
      data: [],
      directory: [],
      temporary: [],
      unknown: []
    };

    for (const file of files) {
      const classification = this.classifyFile(file.path);
      byType[classification.type].push({
        ...file,
        reason: classification.reason
      });
    }

    return byType;
  }
}

const classifier = new DetailedClassifier();
const results = classifier.analyze();

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║              📊 详细文件分类分析                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

// 关键文件
console.log(`\n🔴 关键文件 (${results.critical.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
results.critical.slice(0, 10).forEach(f => {
  console.log(`  ✅ ${f.path}`);
});
if (results.critical.length > 10) {
  console.log(`  ... 还有 ${results.critical.length - 10} 个`);
}

// 源代码文件
console.log(`\n🟢 源代码文件 (${results.source.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
results.source.slice(0, 10).forEach(f => {
  console.log(`  📝 ${f.path}`);
});
if (results.source.length > 10) {
  console.log(`  ... 还有 ${results.source.length - 10} 个`);
}

// 文档
console.log(`\n📖 文档文件 (${results.documentation.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
results.documentation.forEach(f => {
  console.log(`  📄 ${f.path}`);
});

// 配置文件
console.log(`\n⚙️ 配置文件 (${results.configuration.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
results.configuration.slice(0, 15).forEach(f => {
  console.log(`  🔧 ${f.path}`);
});
if (results.configuration.length > 15) {
  console.log(`  ... 还有 ${results.configuration.length - 15} 个`);
}

// 目录
console.log(`\n📁 目录 (${results.directory.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
results.directory.slice(0, 15).forEach(f => {
  console.log(`  📂 ${f.path}`);
});
if (results.directory.length > 15) {
  console.log(`  ... 还有 ${results.directory.length - 15} 个`);
}

// 数据文件
console.log(`\n💾 数据文件 (${results.data.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
results.data.forEach(f => {
  console.log(`  💿 ${f.path}`);
});

// 临时文件
console.log(`\n⚫ 临时文件 (${results.temporary.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if (results.temporary.length === 0) {
  console.log(`  ✅ 没有临时文件`);
} else {
  results.temporary.forEach(f => {
    console.log(`  🗑️ ${f.path}`);
  });
}

// 未知
console.log(`\n❓ 未知文件 (${results.unknown.length}个)`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
results.unknown.slice(0, 20).forEach(f => {
  const size = f.isDir ? 'DIR' : `${(f.size / 1024).toFixed(0)}KB`;
  console.log(`  ❓ ${f.path.padEnd(50)} [${size}]`);
});
if (results.unknown.length > 20) {
  console.log(`  ... 还有 ${results.unknown.length - 20} 个`);
}

// 统计
console.log(`\n\n【统计总结】`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`
关键文件:      ${results.critical.length}   个  ✅ 保留
源代码:        ${results.source.length}   个  ✅ 保留
文档:          ${results.documentation.length}   个  ✅ 保留
配置:          ${results.configuration.length}   个  ✅ 保留
数据:          ${results.data.length}   个  ✅ 保留
目录:          ${results.directory.length}   个  ✅ 保留
临时:          ${results.temporary.length}   个  🗑️ 可删
未知:          ${results.unknown.length}   个  ❓ 需审查

总计:          ${results.critical.length + results.source.length + results.documentation.length + results.configuration.length + results.data.length + results.directory.length + results.temporary.length + results.unknown.length}   个文件
`);

// 建议
console.log(`\n【建议】`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if (results.temporary.length > 0) {
  console.log(`\n✅ 有 ${results.temporary.length} 个临时文件可以删除`);
} else {
  console.log(`\n✅ 没有明确的垃圾文件`);
}

console.log(`\n未知文件说明：`);
console.log(`  这些文件无法自动分类，可能是：`);
console.log(`  • 二进制文件（图片、字体等）`);
console.log(`  • 项目特定的文件`);
console.log(`  • 其他格式的配置或数据文件`);
console.log(`\n  这些文件建议保留，除非你确定它们是垃圾。`);

console.log(`\n═══════════════════════════════════════════════════════════════════════════════\n`);
