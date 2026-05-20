/**
 * CodeReviewer — 居民代码审查引擎
 *
 * 让 residents 不只是解小学数学题，而是审计 bridge 自身代码、
 * 发现 bug、提出修复方案。
 *
 * 安全措施：
 * - 只读，不自动写文件
 * - 审查结果写入 .openchat/reviews/ 而非直接修改源码
 * - 每个发现记录为问题，由 Agent 验证后才接受
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, extname, relative, resolve } from 'path';
import { homedir } from 'os';
import logger from '../logger.js';

const REVIEW_DIR = join(homedir(), '.openchat', 'reviews');
const BRIDGE_SRC = join(resolve('.'), 'bridge', 'src');

const REVIEW_TARGETS = [
  { path: 'core/learning-core.js', focus: '问题求解逻辑、收敛引擎、验证流程' },
  { path: 'core/resident-manager.js', focus: '居民生命周期、特质管理' },
  { path: 'core/knowledge-base.js', focus: '知识库索引、答案缓存' },
  { path: 'core/strategy-registry.js', focus: '策略注册、自动求解器' },
  { path: 'main.js', focus: 'HTTP 路由、启动流程、P2P 集成' },
  { path: 'p2p/swarm.js', focus: 'P2P 连接管理、消息路由' },
];

export class CodeReviewer {
  constructor() {
    this._ensureDir();
    this.reviews = [];
    this.bugsFound = 0;
  }

  _ensureDir() {
    try { if (!existsSync(REVIEW_DIR)) mkdirSync(REVIEW_DIR, { recursive: true }); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  /**
   * 生成代码审查问题
   */
  generateReviewProblems() {
    const problems = [];

    for (const target of REVIEW_TARGETS) {
      const fullPath = join(BRIDGE_SRC, target.path);
      if (!existsSync(fullPath)) continue;

      const lines = readFileSync(fullPath, 'utf8').split('\n');
      const lineCount = lines.length;

      problems.push({
        id: `review_${target.path.replace(/[/\\]/g, '_')}`,
        question: `审查 ${target.path}（${lineCount}行）：重点检查 ${target.focus}。找出潜在的 bug、逻辑错误、边界条件遗漏、空 catch 块等问题。`,
        domain: 'code_review',
        difficulty: lineCount > 500 ? 3 : 2,
        answer: null,
        source: 'code_review',
        filePath: fullPath,
        fileLines: lineCount
      });
    }

    // 添加跨文件审查
    problems.push({
      id: 'review_cross_import',
      question: '跨文件审查：检查 bridge/src/core/ 下所有模块的 import 依赖是否有循环引用、未使用的 import、或缺少的依赖。',
      domain: 'code_review',
      difficulty: 3,
      answer: null,
      source: 'code_review',
      scope: 'cross_module'
    });

    return problems;
  }

  /**
   * 为 Agent 准备代码审查 prompt
   */
  buildReviewPrompt(problem, kbHint) {
    let prompt = `你是 OpenChat Bridge 的代码审查员。请审查以下代码文件：

**文件**: bridge/src/${problem.filePath ? relative(BRIDGE_SRC, problem.filePath) : problem.id}
**重点**: ${problem.question}

`;

    if (problem.filePath && existsSync(problem.filePath)) {
      const stats = statSync(problem.filePath);
      const content = readFileSync(problem.filePath, 'utf8');
      const truncated = content.length > 8000
        ? content.substring(0, 8000) + '\n\n... (文件过长，已截断，共 ' + content.length + ' 字符)'
        : content;

      prompt += `\`\`\`javascript
${truncated}
\`\`\`

`;
    }

    prompt += `请按以下格式返回审查结果（JSON）：

\`\`\`json
{
  "findings": [
    {
      "severity": "high|medium|low",
      "line": 行号,
      "type": "bug|logic_error|missing_check|style|perf",
      "description": "问题描述",
      "suggestion": "修复建议",
      "code_before": "当前代码",
      "code_after": "建议修改后的代码"
    }
  ],
  "summary": "总体评价"
}
\`\`\`

只返回 JSON，不要其他文字。`;

    if (kbHint) {
      prompt += '\n\n## 知识库参考\n' + kbHint;
    }

    return prompt;
  }

  /**
   * 解析 Agent 的审查结果
   */
  parseReviewResult(problem, agentOutput) {
    try {
      const jsonMatch = agentOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const result = JSON.parse(jsonMatch[0]);
      if (!result.findings || !Array.isArray(result.findings)) return null;

      const review = {
        problemId: problem.id,
        filePath: problem.filePath,
        timestamp: Date.now(),
        findings: result.findings,
        summary: result.summary || '',
        accepted: false
      };

      this.reviews.push(review);
      this._saveReview(review);

      // 统计严重 bug
      const bugCount = result.findings.filter(f => f.severity === 'high' && f.type === 'bug').length;
      this.bugsFound += bugCount;

      logger.info(`[CodeReview] ${problem.id}: 发现 ${result.findings.length} 个问题，其中 ${bugCount} 个严重 bug`);

      return review;
    } catch (e) {
      logger.info(`[CodeReview] 解析审查结果失败: ${e.message}`);
      return null;
    }
  }

  _saveReview(review) {
    try {
      const file = join(REVIEW_DIR, `${review.problemId}_${Date.now()}.json`);
      writeFileSync(file, JSON.stringify(review, null, 2));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  /**
   * 获取所有审查发现
   */
  getFindings(severity = null) {
    const all = [];
    try {
      if (existsSync(REVIEW_DIR)) {
        for (const file of readdirSync(REVIEW_DIR)) {
          if (!file.endsWith('.json')) continue;
          try {
            const review = JSON.parse(readFileSync(join(REVIEW_DIR, file), 'utf8'));
            if (review.findings) {
              for (const f of review.findings) {
                if (!severity || f.severity === severity) {
                  all.push({ ...f, file: review.filePath, reviewId: review.problemId });
                }
              }
            }
          } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
        }
      }
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return all;
  }

  /**
   * 获取审查摘要
   */
  getSummary() {
    return {
      totalReviews: this.reviews.length,
      totalFindings: this.reviews.reduce((s, r) => s + (r.findings?.length || 0), 0),
      bugsFound: this.bugsFound,
      highSeverity: this.getFindings('high').length,
      recentReviews: this.reviews.slice(-3).map(r => ({
        problemId: r.problemId,
        findingsCount: r.findings?.length || 0,
        summary: r.summary?.substring(0, 80)
      }))
    };
  }
}
