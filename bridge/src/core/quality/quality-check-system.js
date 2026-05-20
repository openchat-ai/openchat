import logger from '../logger.js';
/**

// 🚀 自动生成的改进 - 2026-04-22T09:13:04.523Z
// 目标: 增强质量检查的自动修复能力

class AutoRecoveryMixin {
  async withAutoRecovery(fn, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        const delay = Math.pow(2, attempt) * 100; // 指数退避
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async withTimeoutGuard(fn, timeoutMs = 30000) {
    return Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
      )
    ]);
  }

  async withQualityCheck(result) {
    if (!result) return null;
    const quality = this.assessQuality(result);
    return quality > 0.8 ? result : null;
  }

  assessQuality(result) {
    if (typeof result === 'string') {
      return Math.min(1, result.length / 1000);
    }
    return 0.5;
  }
}

// 增强质量检查的自动修复能力
// 自动集成到现有系统中

 * AI 质量检查与纠偏系统 - 实现
 * 极简、优雅、高效的质量保证
 *
 * 文件: bridge/src/core/quality-check-system.js
 * 版本: 1.0
 */

/**
 * 质量检查器
 * 对 LLM 输出进行 5 项检查，计算总分
 */
class QualityChecker {
  constructor(config = {}) {
    // 容错处理：如果没有配置，使用默认值
    this.config = config?.ai_constraints?.quality_check || {
      enabled: true,
      min_score: 3.0,
      correction_max_retries: 2,
      timeout_ms: 30000
    };
  }

  /**
   * 主检查函数
   */
  async check(response) {
    const checks = await Promise.all([
      this.checkResponseValidation(response),
      this.checkCodeQuality(response),
      this.checkSecurity(response),
      this.checkFormatCompliance(response),
      this.checkCompleteness(response)
    ]);

    // 计算加权总分
    const weights = [20, 20, 30, 15, 15];
    let totalScore = 0;

    for (let i = 0; i < checks.length; i++) {
      totalScore += checks[i].score * (weights[i] / 100);
    }

    const issues = checks
      .filter(c => !c.passed)
      .map(c => c.reason);

    return {
      score: Math.round(totalScore),
      passed: totalScore >= this.config.pass_threshold,
      issues,
      details: checks,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 检查 1: 响应验证 (20%)
   * - 不能空
   * - 不能包含致命错误
   * - 必须完整
   */
  async checkResponseValidation(response) {
    if (!response || response.trim().length === 0) {
      return {
        id: 1,
        name: 'response_validation',
        score: 0,  // 空响应直接 0 分
        passed: false,
        reason: '空响应'
      };
    }

    const fatalErrors = ['FATAL ERROR', 'SYSTEM CRASH', 'FATAL EXCEPTION'];
    const hasFatalError = fatalErrors.some(err => response.includes(err));

    if (hasFatalError) {
      return {
        id: 1,
        name: 'response_validation',
        score: 10,
        passed: false,
        reason: '响应包含致命错误'
      };
    }

    return {
      id: 1,
      name: 'response_validation',
      score: 100,
      passed: true,
      reason: 'OK'
    };
  }

  /**
   * 检查 2: 代码质量 (20%)
   * 只在响应包含代码时检查
   */
  async checkCodeQuality(response) {
    // 不包含代码 → 跳过此检查
    if (!this._containsCode(response)) {
      return {
        id: 2,
        name: 'skill_quality',
        score: 100,
        passed: true,
        reason: 'N/A (无代码)'
      };
    }

    const lines = response.split('\n').length;

    // 检查 2.1: 行数限制
    if (lines > 500) {
      return {
        id: 2,
        name: 'skill_quality',
        score: 20,
        passed: false,
        reason: `代码超过500行 (当前${lines}行)`
      };
    }

    // 检查 2.2: 注释
    const hasComments = /\/\/|\/\*|#|'''|"""/.test(response);
    if (!hasComments) {
      return {
        id: 2,
        name: 'skill_quality',
        score: 50,
        passed: false,
        reason: '缺少注释'
      };
    }

    // 检查 2.3: 语法有效性（简单检查）
    if (this._hasInvalidSyntax(response)) {
      return {
        id: 2,
        name: 'skill_quality',
        score: 40,
        passed: false,
        reason: '语法错误'
      };
    }

    return {
      id: 2,
      name: 'skill_quality',
      score: 100,
      passed: true,
      reason: 'OK'
    };
  }

  /**
   * 检查 3: 安全性 (30%)
   * 只在响应包含代码时检查
   */
  async checkSecurity(response) {
    if (!this._containsCode(response)) {
      return {
        id: 3,
        name: 'security',
        score: 100,
        passed: true,
        reason: 'N/A (无代码)'
      };
    }

    const dangerousPatterns = [
      { pattern: /eval\s*\(/, name: 'eval()' },
      { pattern: /exec\s*\(/, name: 'exec()' },
      { pattern: /rm\s+-rf/, name: 'rm -rf' },
      { pattern: /\.\.\//, name: '路径遍历' },
      { pattern: /process\.exit/, name: 'process.exit' },
      { pattern: /process\.kill/, name: 'process.kill' }
    ];

    for (const { pattern, name } of dangerousPatterns) {
      if (pattern.test(response)) {
        return {
          id: 3,
          name: 'security',
          score: 0,
          passed: false,
          reason: `检测到危险操作: ${name}`
        };
      }
    }

    return {
      id: 3,
      name: 'security',
      score: 100,
      passed: true,
      reason: 'OK'
    };
  }

  /**
   * 检查 4: 格式规范 (15%)
   */
  async checkFormatCompliance(response) {
    // 检查 JSON 格式
    const jsonBlockMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      try {
        JSON.parse(jsonBlockMatch[1]);
      } catch (e) {
        return {
          id: 4,
          name: 'format_compliance',
          score: 50,
          passed: false,
          reason: 'JSON 格式错误: ' + e.message
        };
      }
    }

    // 检查代码块平衡
    const codeBlocks = (response.match(/```/g) || []).length;
    if (codeBlocks % 2 !== 0) {
      return {
        id: 4,
        name: 'format_compliance',
        score: 70,
        passed: false,
        reason: '代码块未闭合'
      };
    }

    return {
      id: 4,
      name: 'format_compliance',
      score: 100,
      passed: true,
      reason: 'OK'
    };
  }

  /**
   * 检查 5: 完整性 (15%)
   */
  async checkCompleteness(response) {
    // 检查截断
    const truncationPatterns = [
      /\.\.\.$/,
      /\[继续\]$/,
      /\(未完待续\)$/,
      /to be continued/i
    ];

    const isTruncated = truncationPatterns.some(p => p.test(response.trim()));
    if (isTruncated) {
      return {
        id: 5,
        name: 'completeness',
        score: 30,
        passed: false,
        reason: '响应被截断'
      };
    }

    // 检查长度异常（可能被 API 截断）
    if (response.length > 100000) {
      return {
        id: 5,
        name: 'completeness',
        score: 80,
        passed: true,
        reason: 'OK (但非常长，可能有截断)'
      };
    }

    return {
      id: 5,
      name: 'completeness',
      score: 100,
      passed: true,
      reason: 'OK'
    };
  }

  // ==================== 辅助方法 ====================

  _containsCode(response) {
    return /```|function|class|const\s+|let\s+|var\s+|def\s+/.test(response);
  }

  _hasInvalidSyntax(response) {
    // 简单的语法检查
    const unclosedBraces = (response.match(/\{/g) || []).length !==
                          (response.match(/\}/g) || []).length;
    const unclosedBrackets = (response.match(/\[/g) || []).length !==
                            (response.match(/\]/g) || []).length;

    return unclosedBraces || unclosedBrackets;
  }
}

/**
 * 纠偏器
 * 生成反馈，让大模型重新生成
 */
class Corrector {
  constructor(config = {}) {
    // 容错处理：如果没有配置，使用默认值
    this.config = config?.ai_constraints?.quality_check || {
      enabled: true,
      correction_max_retries: 2
    };
  }

  /**
   * 生成纠偏提示
   */
  generateFeedback(issues) {
    if (issues.length === 0) return null;

    const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

    return `请重新回答上面的问题。

检测到以下问题：
${issueList}

请确保修正这些问题。`;
  }

  /**
   * 执行纠偏
   */
  async correct(response, issues, session) {
    if (issues.length === 0) return response;

    const feedback = this.generateFeedback(issues);

    // 让大模型重新生成
    return await session.llm.call(feedback);
  }
}

/**
 * 消息处理器
 * 核心流程：调用 LLM → 检查质量 → 纠偏
 */
class MessageHandler {
  constructor(config) {
    this.config = config;
    this.checker = new QualityChecker(config);
    this.corrector = new Corrector(config);
    this.logger = this._getLogger();
  }

  /**
   * 处理用户消息
   */
  async handle(message, session) {
    try {
      // 第 1 步: 调用 LLM（无需任何前置约束）
      let response = await session.llm.call(message);

      // 第 2 步: 检查质量
      let check = await this.checker.check(response);

      this.logger.info('quality_check', {
        score: check.score,
        passed: check.passed,
        issues: check.issues
      });

      if (check.passed) {
        // ✅ 合格，直接返回
        return response;
      }

      // ❌ 不合格，尝试纠偏
      return await this._correctWithRetry(
        response,
        check,
        session
      );

    } catch (error) {
      this.logger.error('message_handling_error', { error: error.message });
      throw error;
    }
  }

  /**
   * 纠偏重试
   */
  async _correctWithRetry(response, initialCheck, session) {
    let currentResponse = response;
    let currentCheck = initialCheck;

    const maxRetries = this.config.ai_constraints.quality_check.correction_max_retries;

    for (let retry = 0; retry < maxRetries; retry++) {
      // 执行纠偏
      currentResponse = await this.corrector.correct(
        currentResponse,
        currentCheck.issues,
        session
      );

      // 再检查一次
      currentCheck = await this.checker.check(currentResponse);

      this.logger.info('correction_attempt', {
        attempt: retry + 1,
        score: currentCheck.score,
        passed: currentCheck.passed
      });

      if (currentCheck.passed) {
        // ✅ 纠偏成功
        return currentResponse;
      }
    }

    // 纠偏失败，返回最好的版本 + 错误提示
    return {
      content: currentResponse,
      quality_issues: currentCheck.issues,
      failed_quality_check: true,
      message: '系统多次尝试调整但未能达到质量标准。问题：' +
               currentCheck.issues.join('; ')
    };
  }

  _getLogger() {
    // 返回简单的日志对象
    return {
      info: (event, data) => {
        logger.info(`[QC] ${event}:`, data);
      },
      error: (event, data) => {
        logger.error(`[QC] ${event}:`, data);
      }
    };
  }
}

/**
 * Session 管理器
 * 完全空白的 session，不需要预加载任何东西
 */
class SessionManager {
  async createSession(userId) {
    // 就是创建一个空 session
    const session = {
      userId,
      createdAt: new Date(),
      llm: null  // 由调用者注入
    };
    return session;
  }
}

// ==================== 导出 ====================

export {
  QualityChecker,
  Corrector,
  MessageHandler,
  SessionManager
};
