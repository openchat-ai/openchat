import logger from '../../core/monitoring/logger.js';
/**
 * Code Quality Analyzer Agent
 * 代码质量和最佳实践分析
 */

const BaseAgent = require('./base-agent');

class CodeQualityAnalyzerAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      role: 'code_quality_analyzer',
      name: options.name || 'Code Quality Analyzer',
      capabilities: [
        'code_review',
        'style_check',
        'complexity_analysis',
        'best_practices_check'
      ]
    });
  }

  /**
   * 运行代码质量分析任务
   */
  async runTask(task) {
    logger.info(`[CodeQualityAnalyzer] Analyzing code quality...`);

    const results = {
      issues: [],
      score: 0,
      complexity: {},
      suggestions: []
    };

    // 分析代码
    if (task.code) {
      // 1. 复杂度分析
      results.complexity = this.analyzeComplexity(task.code);

      // 2. 风格检查
      const styleIssues = this.checkStyle(task.code, task.language || 'javascript');
      results.issues.push(...styleIssues);

      // 3. 最佳实践检查
      const practiceIssues = this.checkBestPractices(task.code);
      results.issues.push(...practiceIssues);

      // 4. 计算质量分数
      results.score = this.calculateScore(results.issues, results.complexity);
    }

    // 5. 生成建议
    results.suggestions = this.generateSuggestions(results.issues, results.complexity);

    // 生成反馈
    this.addFeedback({
      type: 'code_quality_analysis',
      issues: results.issues,
      score: results.score,
      complexity: results.complexity,
      suggestions: results.suggestions,
      summary: `Code quality score: ${results.score}/100, ${results.issues.length} issues found`
    });

    return results;
  }

  /**
   * 分析代码复杂度
   */
  analyzeComplexity(code) {
    const lines = code.split('\n');

    // 统计函数
    const functions = (code.match(/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|=>\s*{/g) || []).length;

    // 统计条件
    const conditionals = (code.match(/\bif\b|\belse\b|\bswitch\b|\bcase\b/g) || []).length;

    // 统计循环
    const loops = (code.match(/\bfor\b|\bwhile\b|\bdo\b/g) || []).length;

    // 圈复杂度估算
    const cyclomatic = 1 + conditionals + loops;

    // 代码行数
    const linesOfCode = lines.filter(l => l.trim().length > 0).length;

    return {
      linesOfCode,
      functions,
      conditionals,
      loops,
      cyclomaticComplexity: cyclomatic,
      rating: cyclomatic < 10 ? 'LOW' : cyclomatic < 20 ? 'MEDIUM' : 'HIGH'
    };
  }

  /**
   * 检查代码风格
   */
  checkStyle(code, language) {
    const issues = [];

    // 检查行长
    const lines = code.split('\n');
    lines.forEach((line, index) => {
      if (line.length > 120) {
        issues.push({
          type: 'style',
          severity: 'LOW',
          line: index + 1,
          message: `Line exceeds 120 characters (${line.length})`
        });
      }
    });

    // 检查未使用的变量（简化）
    const unusedVarMatch = code.match(/const\s+(\w+)\s*=.*(?=;)/g);
    if (unusedVarMatch && unusedVarMatch.length > 10) {
      issues.push({
        type: 'style',
        severity: 'LOW',
        message: 'Potential unused variables detected'
      });
    }

    // 检查 console.log（生产环境不应有）
    if (code.includes('console.log') || code.includes('console.error')) {
      issues.push({
        type: 'best_practice',
        severity: 'MEDIUM',
        message: 'Console statements should be removed in production'
      });
    }

    return issues;
  }

  /**
   * 检查最佳实践
   */
  checkBestPractices(code) {
    const issues = [];

    // 检查 try-catch 缺失
    if (code.includes('await ') && !code.includes('try') && !code.includes('catch')) {
      issues.push({
        type: 'best_practice',
        severity: 'MEDIUM',
        message: 'Async/await should be wrapped in try-catch'
      });
    }

    // 检查硬编码值
    if (code.includes('1000') || code.includes('5000')) {
      issues.push({
        type: 'best_practice',
        severity: 'LOW',
        message: 'Consider extracting magic numbers to constants'
      });
    }

    // 检查深层嵌套
    const maxDepth = this.getMaxNestingDepth(code);
    if (maxDepth > 4) {
      issues.push({
        type: 'complexity',
        severity: 'MEDIUM',
        message: `Code has ${maxDepth} levels of nesting, consider refactoring`
      });
    }

    return issues;
  }

  /**
   * 获取最大嵌套深度
   */
  getMaxNestingDepth(code) {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of code) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }

    return maxDepth;
  }

  /**
   * 计算质量分数
   */
  calculateScore(issues, complexity) {
    let score = 100;

    // 扣分
    for (const issue of issues) {
      switch (issue.severity) {
        case 'CRITICAL': score -= 10; break;
        case 'HIGH': score -= 5; break;
        case 'MEDIUM': score -= 2; break;
        case 'LOW': score -= 1; break;
      }
    }

    // 复杂度扣分
    if (complexity.rating === 'HIGH') score -= 20;
    else if (complexity.rating === 'MEDIUM') score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 生成改进建议
   */
  generateSuggestions(issues, complexity) {
    const suggestions = [];

    // 基于问题
    for (const issue of issues) {
      if (issue.message.includes('nesting')) {
        suggestions.push('Extract nested code into separate functions');
      }
      if (issue.message.includes('try-catch')) {
        suggestions.push('Add error handling for async operations');
      }
      if (issue.message.includes('console')) {
        suggestions.push('Use a proper logging library');
      }
    }

    // 基于复杂度
    if (complexity.rating === 'HIGH') {
      suggestions.push('Consider breaking down complex functions');
      suggestions.push('Apply the Single Responsibility Principle');
    }

    return [...new Set(suggestions)];
  }
}

module.exports = CodeQualityAnalyzerAgent;