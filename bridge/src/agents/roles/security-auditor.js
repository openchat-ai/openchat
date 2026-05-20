import logger from '../../core/monitoring/logger.js';
/**
 * Security Auditor Agent
 * 安全审计和漏洞检测
 */

const BaseAgent = require('./base-agent');

class SecurityAuditorAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      role: 'security_auditor',
      name: options.name || 'Security Auditor',
      capabilities: [
        'vulnerability_scan',
        'security_audit',
        'threat_detection',
        'dependency_check'
      ]
    });

    this.severityLevels = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  }

  /**
   * 运行安全审计任务
   */
  async runTask(task) {
    logger.info(`[SecurityAuditor] Analyzing: ${task.code?.slice(0, 50) || task.description || 'unknown'}`);

    const results = {
      vulnerabilities: [],
      risks: [],
      recommendations: []
    };

    // 模拟安全分析
    // 1. 代码审计
    if (task.code) {
      const codeIssues = this.analyzeCode(task.code);
      results.vulnerabilities.push(...codeIssues);
    }

    // 2. 依赖检查
    if (task.dependencies) {
      const depIssues = this.checkDependencies(task.dependencies);
      results.vulnerabilities.push(...depIssues);
    }

    // 3. 风险评估
    results.risks = this.assessRisks(results.vulnerabilities);

    // 4. 建议
    results.recommendations = this.generateRecommendations(results.vulnerabilities);

    // 生成反馈
    this.addFeedback({
      type: 'security_analysis',
      severity: results.vulnerabilities.length > 0 ? 'HIGH' : 'LOW',
      vulnerabilities: results.vulnerabilities,
      risks: results.risks,
      recommendations: results.recommendations,
      summary: `Found ${results.vulnerabilities.length} vulnerabilities, ${results.risks.length} risks`
    });

    return results;
  }

  /**
   * 分析代码寻找漏洞
   */
  analyzeCode(code) {
    const vulnerabilities = [];

    // 简单的模式匹配检测常见漏洞
    const patterns = [
      { pattern: /eval\s*\(/, type: 'Code Injection', severity: 'CRITICAL' },
      { pattern: /SQL\s*injection/i, type: 'SQL Injection', severity: 'CRITICAL' },
      { pattern: /password\s*=\s*['"]/, type: 'Hardcoded Password', severity: 'HIGH' },
      { pattern: /api[_-]?key\s*=\s*['"]/i, type: 'Hardcoded API Key', severity: 'HIGH' },
      { pattern: /\.innerHTML\s*=/, type: 'XSS Risk', severity: 'MEDIUM' },
      { pattern: /Math\.random\(\)/, type: 'Insecure Random', severity: 'LOW' }
    ];

    for (const { pattern, type, severity } of patterns) {
      if (pattern.test(code)) {
        vulnerabilities.push({
          type,
          severity,
          location: 'code',
          description: `Potential ${type} found in code`
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * 检查依赖项
   */
  checkDependencies(dependencies) {
    const vulnerabilities = [];
    const knownVulnerable = {
      'lodash': '<4.17.21',
      'express': '<4.17.3',
      'axios': '<0.21.1'
    };

    for (const [dep, version] of Object.entries(dependencies || {})) {
      if (knownVulnerable[dep]) {
        vulnerabilities.push({
          type: 'Vulnerable Dependency',
          severity: 'HIGH',
          location: `dependency:${dep}`,
          description: `${dep}@${version} has known vulnerabilities (fixed in ${knownVulnerable[dep]})`
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * 评估风险
   */
  assessRisks(vulnerabilities) {
    const riskCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };

    for (const v of vulnerabilities) {
      riskCounts[v.severity]++;
    }

    const risks = [];

    if (riskCounts.CRITICAL > 0) {
      risks.push({
        level: 'CRITICAL',
        description: `${riskCounts.CRITICAL} critical vulnerabilities require immediate attention`
      });
    }

    if (riskCounts.HIGH > 0) {
      risks.push({
        level: 'HIGH',
        description: `${riskCounts.HIGH} high severity issues should be addressed soon`
      });
    }

    return risks;
  }

  /**
   * 生成建议
   */
  generateRecommendations(vulnerabilities) {
    const recommendations = [];

    for (const v of vulnerabilities) {
      switch (v.type) {
        case 'Code Injection':
          recommendations.push('Avoid using eval(), use safer alternatives');
          break;
        case 'SQL Injection':
          recommendations.push('Use parameterized queries or ORM');
          break;
        case 'Hardcoded Password':
          recommendations.push('Use environment variables or secure key management');
          break;
        case 'XSS Risk':
          recommendations.push('Use textContent instead of innerHTML, or sanitize input');
          break;
        case 'Vulnerable Dependency':
          recommendations.push(`Update ${v.location.split(':')[1]} to latest version`);
          break;
      }
    }

    return [...new Set(recommendations)]; // 去重
  }
}

module.exports = SecurityAuditorAgent;