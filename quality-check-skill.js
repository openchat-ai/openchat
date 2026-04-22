#!/usr/bin/env node

/**
 * Claude Code Quality Check Skill
 *
 * 用法：
 * 在 Claude Code 中注册这个 skill，然后可以直接调用：
 * /quality-check <content>
 *
 * 或者在代码中：
 * const skill = require('./quality-check-skill.js');
 * const result = await skill.check(content);
 */

import { QualityChecker, Corrector } from './bridge/src/core/quality-check-system.js';

// 配置
const config = {
  ai_constraints: {
    quality_check: {
      pass_threshold: 80,
      correction_max_retries: 2
    }
  }
};

const checker = new QualityChecker(config);
const corrector = new Corrector(config);

/**
 * Skill：检查内容质量
 * @param {string} content 要检查的内容
 * @returns {object} 检查结果
 */
async function checkQuality(content) {
  if (!content || typeof content !== 'string') {
    return {
      success: false,
      error: '需要提供有效的内容字符串',
      score: 0,
      passed: false
    };
  }

  try {
    const result = await checker.check(content);

    return {
      success: true,
      score: result.score,
      passed: result.passed,
      issues: result.issues,
      details: result.details,
      timestamp: result.timestamp,
      message: result.passed
        ? `✅ 质量检查通过 (${result.score}/100)`
        : `❌ 质量检查失败 (${result.score}/100)`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      score: 0,
      passed: false
    };
  }
}

/**
 * Skill：检查并纠偏
 * @param {string} content 要检查的内容
 * @returns {object} 检查和纠偏结果
 */
async function checkAndCorrect(content) {
  if (!content || typeof content !== 'string') {
    return {
      success: false,
      error: '需要提供有效的内容字符串'
    };
  }

  try {
    // 第 1 步：检查
    const check = await checker.check(content);

    if (check.passed) {
      return {
        success: true,
        passed: true,
        score: check.score,
        content: content,
        issues: [],
        message: `✅ 质量检查通过 (${check.score}/100)`
      };
    }

    // 第 2 步：生成反馈
    const feedback = corrector.generateFeedback(check.issues);

    return {
      success: true,
      passed: false,
      score: check.score,
      issues: check.issues,
      feedback: feedback,
      suggestion: '内容需要改进。建议修复以下问题：\n' +
                  check.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n'),
      message: `❌ 质量检查失败 (${check.score}/100)，已生成改进建议`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Skill：获取详细检查报告
 * @param {string} content 要检查的内容
 * @returns {object} 详细报告
 */
async function getDetailedReport(content) {
  if (!content || typeof content !== 'string') {
    return {
      success: false,
      error: '需要提供有效的内容字符串'
    };
  }

  try {
    const result = await checker.check(content);

    const report = {
      success: true,
      summary: {
        totalScore: result.score,
        passed: result.passed,
        timestamp: result.timestamp
      },
      checks: result.details.map(check => ({
        id: check.id,
        name: check.name,
        score: check.score,
        passed: check.passed,
        reason: check.reason
      })),
      issues: result.issues,
      contentStats: {
        length: content.length,
        lines: content.split('\n').length,
        hasCode: /```|function|class|const\s+|let\s+|var\s+|def\s+/.test(content),
        hasJSON: /```json/.test(content)
      }
    };

    return report;
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ==================== Claude Code Skill 导出 ====================

export const skill = {
  name: 'quality-check',
  description: '检查内容质量，支持自动纠偏',
  version: '1.0.0',

  // Skill 命令
  commands: [
    {
      name: 'check',
      description: '检查内容质量',
      handler: checkQuality,
      args: [{
        name: 'content',
        type: 'string',
        description: '要检查的内容',
        required: true
      }]
    },
    {
      name: 'check-and-correct',
      description: '检查质量并生成改进建议',
      handler: checkAndCorrect,
      args: [{
        name: 'content',
        type: 'string',
        description: '要检查的内容',
        required: true
      }]
    },
    {
      name: 'report',
      description: '生成详细的质量检查报告',
      handler: getDetailedReport,
      args: [{
        name: 'content',
        type: 'string',
        description: '要检查的内容',
        required: true
      }]
    }
  ],

  // 快捷方式 - 可以直接调用
  check: checkQuality,
  checkAndCorrect: checkAndCorrect,
  getDetailedReport: getDetailedReport
};

// ==================== 导出用于 Node.js 使用 ====================

export { checkQuality, checkAndCorrect, getDetailedReport };
