/**
 * 快速集成版 AdversarialTest
 * 核心功能：对抗验证测试框架
 */

class AdversarialTest {
  constructor() {
    this.results = [];
  }

  /**
   * 执行逻辑投毒测试
   * @param {string} code - 要测试的代码
   * @returns {object} 测试结果
   */
  testLogicPoisoning(code) {
    const dangerous = [
      /process\.exit\s*\(/gi,
      /while\s*\(\s*true\s*\)/gi,
      /eval\s*\(/gi,
      /setInterval.*function.*{.*}.*setInterval/gi,
    ];

    const violations = [];
    for (const pattern of dangerous) {
      if (pattern.test(code)) {
        violations.push(pattern.source);
      }
    }

    return {
      testType: '逻辑投毒',
      codeLength: code.length,
      passed: violations.length === 0,
      violations,
      severity: violations.length > 0 ? 'high' : 'pass',
      message: violations.length > 0
        ? `检测到 ${violations.length} 个危险模式`
        : '通过逻辑投毒测试',
    };
  }

  /**
   * 执行提示词注入测试
   * @param {string} code - 要测试的代码
   * @returns {object} 测试结果
   */
  testPromptInjection(code) {
    const injectionPatterns = [
      /select\s+.*\s+from/gi, // SQL 注入
      /\${.*}/gi, // 模板注入
      /<script>/gi, // XSS
      /on\w+\s*=/gi, // 事件处理
    ];

    const violations = [];
    for (const pattern of injectionPatterns) {
      if (pattern.test(code)) {
        violations.push(pattern.source);
      }
    }

    return {
      testType: '提示词注入',
      codeLength: code.length,
      passed: violations.length === 0,
      violations,
      severity: violations.length > 0 ? 'medium' : 'pass',
      message: violations.length > 0
        ? `检测到 ${violations.length} 个注入向量`
        : '通过提示词注入测试',
    };
  }

  /**
   * 执行边界值攻击测试
   * @param {string} code - 要测试的代码
   * @returns {object} 测试结果
   */
  testBoundaryAttack(code) {
    // 检查是否有足够的防御措施
    const defensePatterns = [
      /\|\|/g, // 逻辑或
      /&&/g, // 逻辑与
      /\.length/g, // 长度检查
      /if\s*\(/g, // 条件检查
    ];

    let defenseCount = 0;
    for (const pattern of defensePatterns) {
      const matches = code.match(pattern);
      if (matches) {
        defenseCount += matches.length;
      }
    }

    // 需要至少2个防御措施
    const hasAdequateDefense = defenseCount >= 2;

    return {
      testType: '边界值攻击',
      codeLength: code.length,
      defenseCount,
      passed: hasAdequateDefense,
      severity: hasAdequateDefense ? 'pass' : 'low',
      message: hasAdequateDefense
        ? `检测到充分的防御措施（${defenseCount}个）`
        : `防御措施不足（${defenseCount}个，需要至少2个）`,
    };
  }

  /**
   * 运行完整的对抗测试
   * @param {string} code - 要测试的代码
   * @returns {object} 综合测试结果
   */
  runFullTest(code) {
    if (!code || typeof code !== 'string') {
      throw new Error('Code must be a non-empty string');
    }

    const tests = [
      this.testLogicPoisoning(code),
      this.testPromptInjection(code),
      this.testBoundaryAttack(code),
    ];

    const passed = tests.filter(t => t.passed).length;
    const failed = tests.filter(t => !t.passed).length;

    const result = {
      timestamp: new Date().toISOString(),
      codeLength: code.length,
      totalTests: tests.length,
      passed,
      failed,
      overallStatus: failed === 0 ? 'pass' : failed === 1 ? 'warning' : 'critical',
      tests,
      summary: {
        logicPoisoning: tests[0].passed ? '✅ 通过' : '❌ 失败',
        promptInjection: tests[1].passed ? '✅ 通过' : '❌ 失败',
        boundaryAttack: tests[2].passed ? '✅ 通过' : '⚠️  警告',
      },
    };

    this.results.push(result);
    return result;
  }

  /**
   * 生成对抗测试报告
   * @param {object} testResult - 测试结果对象
   * @returns {string} 可读的报告
   */
  generateReport(testResult) {
    const lines = [
      '╔════════════════════════════════════════════════════════╗',
      '║          对抗验证测试报告                              ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
      `时间: ${testResult.timestamp}`,
      `代码长度: ${testResult.codeLength} 字符`,
      '',
      '测试统计:',
      `  总测试数: ${testResult.totalTests}`,
      `  ✅ 通过: ${testResult.passed}`,
      `  ❌ 失败: ${testResult.failed}`,
      '',
      '详细结果:',
      `  逻辑投毒: ${testResult.summary.logicPoisoning}`,
      `  提示词注入: ${testResult.summary.promptInjection}`,
      `  边界值攻击: ${testResult.summary.boundaryAttack}`,
      '',
      `总体状态: ${this.getStatusIcon(testResult.overallStatus)} ${testResult.overallStatus.toUpperCase()}`,
      '',
    ];

    return lines.join('\n');
  }

  /**
   * 获取建议
   * @param {object} testResult - 测试结果对象
   * @returns {Array} 建议列表
   */
  generateRecommendations(testResult) {
    const recommendations = [];

    for (const test of testResult.tests) {
      if (!test.passed) {
        switch (test.testType) {
          case '逻辑投毒':
            recommendations.push('添加进程隔离机制以防止恶意进程退出');
            break;
          case '提示词注入':
            recommendations.push('对用户输入进行严格验证和转义');
            break;
          case '边界值攻击':
            recommendations.push('添加更多的输入验证和边界检查');
            break;
        }
      }
    }

    return recommendations;
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
      critical: '❌',
      error: '🔴',
    };
    return icons[status] || '❓';
  }

  /**
   * 获取所有结果
   * @returns {Array} 所有测试结果
   */
  getResults() {
    return this.results;
  }

  /**
   * 清空结果
   */
  clearResults() {
    this.results = [];
  }
}

export default AdversarialTest;
