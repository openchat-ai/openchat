/**
 * SecurityChecker 类：Skill 安全审查框架
 *
 * 功能：
 * - 文件系统操作检查
 * - 网络请求检查
 * - 系统命令检查
 * - 可扩展规则系统
 * - 安全评分和报告
 */
class SecurityChecker {
  constructor() {
    this.rules = [];
    this.results = [];

    // 注册默认规则
    this.registerDefaultRules();
  }

  /**
   * 注册默认安全规则
   */
  registerDefaultRules() {
    // 规则 1: 文件系统操作检查
    this.registerRule({
      id: 'file-system-check',
      name: '文件系统操作检查',
      severity: 'high',
      check: (code) => {
        const dangerousPatterns = [
          /fs\.rmSync\s*\(/gi,
          /fs\.unlink/gi,
          /rm\s+-rf/gi,
          /\.\.\/\.\.\//gi, // 目录遍历
        ];

        const violations = [];
        for (const pattern of dangerousPatterns) {
          if (pattern.test(code)) {
            violations.push(pattern.source);
          }
        }

        if (violations.length > 0) {
          return {
            status: 'violation',
            message: `检测到危险的文件系统操作: ${violations.join(', ')}`,
            patterns: violations,
          };
        }

        return { status: 'pass' };
      },
    });

    // 规则 2: 网络请求检查
    this.registerRule({
      id: 'network-check',
      name: '网络请求检查',
      severity: 'medium',
      check: (code) => {
        const patterns = [
          /fetch\s*\(/gi,
          /http\.get/gi,
          /https\.get/gi,
          /XMLHttpRequest/gi,
          /axios\./gi,
        ];

        const found = [];
        for (const pattern of patterns) {
          if (pattern.test(code)) {
            found.push(pattern.source);
          }
        }

        if (found.length > 0) {
          return {
            status: 'warning',
            message: `检测到网络请求操作: ${found.join(', ')}`,
            operations: found,
          };
        }

        return { status: 'pass' };
      },
    });

    // 规则 3: 系统命令检查
    this.registerRule({
      id: 'system-command-check',
      name: '系统命令检查',
      severity: 'high',
      check: (code) => {
        const dangerousPatterns = [
          /exec\s*\(/gi,
          /spawn\s*\(/gi,
          /shell:\s*true/gi,
          /eval\s*\(/gi,
          /Function\s*\(/gi,
        ];

        const violations = [];
        for (const pattern of dangerousPatterns) {
          if (pattern.test(code)) {
            violations.push(pattern.source);
          }
        }

        if (violations.length > 0) {
          return {
            status: 'violation',
            message: `检测到危险的系统命令执行: ${violations.join(', ')}`,
            commands: violations,
          };
        }

        return { status: 'pass' };
      },
    });
  }

  /**
   * 注册自定义安全规则
   * @param {object} rule - 规则对象 { id, name, severity, check }
   */
  registerRule(rule) {
    if (!rule.id || !rule.name || !rule.severity || !rule.check) {
      throw new Error('Rule must have id, name, severity, and check function');
    }
    this.rules.push(rule);
  }

  /**
   * 检查 Skill 代码安全性
   * @param {string} code - Skill 代码
   * @param {object} metadata - 元数据（可选）
   * @returns {object} 审查结果
   */
  check(code, metadata = {}) {
    if (!code || typeof code !== 'string') {
      throw new Error('Code must be a non-empty string');
    }

    const checkResults = {
      timestamp: new Date().toISOString(),
      codeLength: code.length,
      metadata,
      rules: [],
      summary: {
        total: this.rules.length,
        passed: 0,
        warnings: 0,
        violations: 0,
      },
      overallStatus: 'pass', // pass, warning, violation
      details: [],
    };

    // 执行所有规则
    for (const rule of this.rules) {
      try {
        const ruleResult = rule.check(code);
        const result = {
          ruleId: rule.id,
          ruleName: rule.name,
          severity: rule.severity,
          status: ruleResult.status || 'pass',
          message: ruleResult.message || 'Passed',
          details: ruleResult,
        };

        // 更新统计
        if (ruleResult.status === 'pass') {
          checkResults.summary.passed++;
        } else if (ruleResult.status === 'warning') {
          checkResults.summary.warnings++;
          if (checkResults.overallStatus === 'pass') {
            checkResults.overallStatus = 'warning';
          }
        } else if (ruleResult.status === 'violation') {
          checkResults.summary.violations++;
          checkResults.overallStatus = 'violation';
        }

        checkResults.rules.push(result);
      } catch (error) {
        checkResults.rules.push({
          ruleId: rule.id,
          ruleName: rule.name,
          status: 'error',
          message: `规则检查错误: ${error.message}`,
        });
      }
    }

    // 生成详细信息
    checkResults.details = this.generateDetails(checkResults);

    // 保存结果
    this.results.push(checkResults);

    return checkResults;
  }

  /**
   * 生成详细的安全报告
   * @param {object} checkResults - 检查结果
   * @returns {Array} 详细信息数组
   */
  generateDetails(checkResults) {
    const details = [];

    for (const rule of checkResults.rules) {
      if (rule.status !== 'pass') {
        details.push({
          severity: rule.severity,
          status: rule.status,
          message: rule.message,
          ruleId: rule.ruleId,
          details: rule.details,
        });
      }
    }

    return details;
  }

  /**
   * 获取安全审查结果
   * @returns {Array} 所有审查结果
   */
  getResults() {
    return this.results;
  }

  /**
   * 清空审查历史
   */
  clearResults() {
    this.results = [];
  }

  /**
   * 生成安全评分（0-100）
   * @param {object} checkResults - 检查结果
   * @returns {number} 安全评分
   */
  calculateSecurityScore(checkResults) {
    const { passed, warnings, violations, total } = checkResults.summary;

    let score = 100;
    score -= violations * 30; // 每个违规扣 30 分
    score -= warnings * 10; // 每个警告扣 10 分

    return Math.max(0, score);
  }

  /**
   * 是否可以执行（违规检查）
   * @param {object} checkResults - 检查结果
   * @returns {boolean} 是否可以执行
   */
  canExecute(checkResults) {
    return checkResults.overallStatus !== 'violation';
  }

  /**
   * 获取规则列表
   * @returns {Array} 注册的规则列表
   */
  getRules() {
    return this.rules.map(r => ({
      id: r.id,
      name: r.name,
      severity: r.severity,
    }));
  }

  /**
   * 生成安全报告
   * @param {object} checkResults - 检查结果
   * @returns {string} 可读的报告
   */
  generateReport(checkResults) {
    const lines = [
      '╔════════════════════════════════════════════════════════╗',
      '║        Skill 安全审查报告                           ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
      `时间: ${checkResults.timestamp}`,
      `代码行数: ${checkResults.codeLength} 字符`,
      '',
      '规则检查结果:',
      `  总规则数: ${checkResults.summary.total}`,
      `  ✅ 通过: ${checkResults.summary.passed}`,
      `  ⚠️  警告: ${checkResults.summary.warnings}`,
      `  ❌ 违规: ${checkResults.summary.violations}`,
      '',
      `总体状态: ${this.getStatusIcon(checkResults.overallStatus)} ${checkResults.overallStatus.toUpperCase()}`,
      `安全评分: ${this.calculateSecurityScore(checkResults)}/100`,
      `可执行: ${this.canExecute(checkResults) ? '是 ✅' : '否 ❌'}`,
      '',
      '详细信息:',
    ];

    if (checkResults.details.length === 0) {
      lines.push('  无安全问题');
    } else {
      for (const detail of checkResults.details) {
        lines.push(`  - [${detail.severity}] ${detail.status.toUpperCase()}`);
        lines.push(`    ${detail.message}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取状态图标
   * @param {string} status - 状态
   * @returns {string} 图标
   */
  getStatusIcon(status) {
    const icons = {
      pass: '✅',
      warning: '⚠️',
      violation: '❌',
      error: '🔴',
    };
    return icons[status] || '❓';
  }
}

export default SecurityChecker;
