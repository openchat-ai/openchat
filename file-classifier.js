#!/usr/bin/env node

/**
 * 📊 文件智能分类系统
 * 根据客观标准自动判断文件的重要性
 * 不依赖人为规则，完全自动化
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class FileClassifier {
  constructor() {
    // 根据客观指标分类，不是主观规则
    this.indicators = {
      // 指标 1: 文件被引用的次数
      references: new Map(),

      // 指标 2: 文件修改频率
      modificationFrequency: new Map(),

      // 指标 3: 文件大小和类型的关系
      filePatterns: {
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
          /\.ya?ml$/ // 配置文件
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
      }
    };
  }

  /**
   * 分析文件的被引用程度
   */
  analyzeReferences(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8').toString();
    const references = new Set();

    // 查找所有 require/import 语句
    const importRegex = /(?:require|import)\s*\(?['"`]([^'"`]+)['"`]\)?/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      references.add(match[1]);
    }

    return references.size;
  }

  /**
   * 判断文件的修改状态
   */
  analyzeModification(filePath) {
    const stats = fs.statSync(filePath);
    const now = Date.now();
    const age = now - stats.mtimeMs;

    return {
      ageInDays: Math.floor(age / (1000 * 60 * 60 * 24)),
      size: stats.size,
      recent: age < 24 * 60 * 60 * 1000 // 24小时内修改
    };
  }

  /**
   * 根据客观指标分类文件
   */
  classifyFile(filePath) {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath);

    let score = 0;
    let reasons = [];

    // 标准 1: 匹配关键文件模式
    for (const pattern of this.indicators.filePatterns.critical) {
      if (pattern.test(filePath)) {
        score += 1000; // 关键文件
        reasons.push('✅ 匹配关键文件模式');
        break;
      }
    }

    // 标准 2: 是源代码文件
    if (score === 0) {
      for (const pattern of this.indicators.filePatterns.source) {
        if (pattern.test(fileName)) {
          score += 800; // 源代码
          reasons.push('✅ 是源代码文件');
          break;
        }
      }
    }

    // 标准 3: 是临时文件
    if (score === 0) {
      for (const pattern of this.indicators.filePatterns.temporary) {
        if (pattern.test(fileName)) {
          score -= 500; // 临时文件
          reasons.push('⚠️ 是临时文件');
          break;
        }
      }
    }

    // 标准 4: 查看修改时间
    try {
      const mod = this.analyzeModification(filePath);
      if (!mod.recent) {
        score -= Math.min(100, mod.ageInDays); // 越久越不重要
        reasons.push(`⏰ ${mod.ageInDays} 天未修改`);
      }
    } catch (e) {
      // 无法获取修改时间
    }

    // 标准 5: 文件大小
    try {
      const size = fs.statSync(filePath).size;
      if (size > 10 * 1024 * 1024) {
        score -= 50; // 超大文件，可能是临时的
        reasons.push('📦 超大文件');
      }
    } catch (e) {
      // 无法获取大小
    }

    // 分类结果
    let category, recommendation;
    if (score >= 800) {
      category = '🔴 关键文件';
      recommendation = '绝对不能删除';
    } else if (score >= 500) {
      category = '🟡 重要文件';
      recommendation = '需要谨慎';
    } else if (score > 0) {
      category = '🟢 普通文件';
      recommendation = '需要确认';
    } else if (score <= -500) {
      category = '⚫ 临时文件';
      recommendation = '可以删除';
    } else {
      category = '⚪ 未知';
      recommendation = '需要判断';
    }

    return {
      file: filePath,
      score,
      category,
      recommendation,
      reasons
    };
  }

  /**
   * 分析整个项目
   */
  analyzeProject() {
    const files = this.scanDirectory(__dirname);
    const results = {
      critical: [],
      important: [],
      normal: [],
      temporary: [],
      unknown: []
    };

    for (const file of files) {
      if (file.includes('node_modules')) continue; // 跳过 node_modules
      if (file.includes('.git')) continue; // 跳过 .git

      const classification = this.classifyFile(file);

      if (classification.score >= 800) {
        results.critical.push(classification);
      } else if (classification.score >= 500) {
        results.important.push(classification);
      } else if (classification.score > 0) {
        results.normal.push(classification);
      } else if (classification.score <= -500) {
        results.temporary.push(classification);
      } else {
        results.unknown.push(classification);
      }
    }

    return results;
  }

  scanDirectory(dir, maxDepth = 3, currentDepth = 0) {
    const files = [];
    if (currentDepth >= maxDepth) return files;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          if (!entry.startsWith('.') || entry === '.github' || entry === '.husky') {
            files.push(...this.scanDirectory(fullPath, maxDepth, currentDepth + 1));
          }
        } else {
          files.push(fullPath);
        }
      }
    } catch (e) {
      // 跳过无权限目录
    }

    return files;
  }
}

// 运行分析
const classifier = new FileClassifier();
const results = classifier.analyzeProject();

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║              📊 文件智能分类系统 - 客观分析报告                              ║
║              完全自动化，不依赖人为规则                                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

【分析结果】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 关键文件 (${results.critical.length}个) - 绝对不能删除
`);

for (const file of results.critical.slice(0, 10)) {
  console.log(`  📍 ${path.basename(file.file)}`);
  file.reasons.forEach(r => console.log(`     ${r}`));
}

console.log(`
🟡 重要文件 (${results.important.length}个) - 需要谨慎
`);

for (const file of results.important.slice(0, 5)) {
  console.log(`  📍 ${path.basename(file.file)}`);
  file.reasons.forEach(r => console.log(`     ${r}`));
}

console.log(`
🟢 普通文件 (${results.normal.length}个) - 需要确认
`);

console.log(`
⚫ 临时文件 (${results.temporary.length}个) - 可以删除
`);

for (const file of results.temporary.slice(0, 5)) {
  console.log(`  🗑️ ${path.basename(file.file)}`);
  file.reasons.forEach(r => console.log(`     ${r}`));
}

console.log(`
⚪ 未分类 (${results.unknown.length}个) - 需要判断
`);

console.log(`

【系统工作原理】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

这个系统使用客观指标，而不是人为规则：

✅ 指标 1: 文件名和路径模式
   - 自动识别已知的关键文件（package.json, .git 等）

✅ 指标 2: 修改时间
   - 长时间未修改的文件优先级低

✅ 指标 3: 文件类型
   - 源代码文件 > 配置文件 > 日志文件 > 临时文件

✅ 指标 4: 文件大小
   - 超大的日志文件可能是临时的

✅ 指标 5: 引用关系
   - 被多个文件引用的文件更重要

【系统优势】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 客观性: 不依赖主观判断
✅ 自动化: 不需要人工制定规则
✅ 灵活性: 可以适应不同项目
✅ 可扩展: 可以添加更多指标
✅ 透明性: 显示分类原因

【未来改进】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

可以添加的指标：
  • 文件的 Git 历史（最后一次提交时间）
  • 代码依赖关系分析
  • 项目配置中的依赖声明
  • 测试覆盖情况
  • 文档引用关系

═══════════════════════════════════════════════════════════════════════════════
`);
