/**
 * Agent Role Factory
 * 角色工厂 - 根据类型创建合适的 Agent
 */

const SecurityAuditorAgent = require('./roles/security-auditor');
const CodeQualityAnalyzerAgent = require('./roles/code-quality-analyzer');
const PerformanceAnalyzerAgent = require('./roles/performance-analyzer');
const TestEngineerAgent = require('./roles/test-engineer');
const CustomAgent = require('./roles/custom');

class AgentRoleFactory {
  /**
   * 根据角色类型创建 Agent
   */
  static create(role, options = {}) {
    switch (role) {
      case 'security_auditor':
        return new SecurityAuditorAgent(options);

      case 'code_quality_analyzer':
        return new CodeQualityAnalyzerAgent(options);

      case 'performance_analyzer':
        return new PerformanceAnalyzerAgent(options);

      case 'test_engineer':
        return new TestEngineerAgent(options);

      case 'custom':
      default:
        return new CustomAgent(options);
    }
  }

  /**
   * 获取所有可用的角色类型
   */
  static getAvailableRoles() {
    return [
      {
        id: 'security_auditor',
        name: 'Security Auditor',
        description: '安全审计和漏洞检测',
        capabilities: [
          'vulnerability_scan',
          'security_audit',
          'threat_detection',
          'dependency_check'
        ]
      },
      {
        id: 'code_quality_analyzer',
        name: 'Code Quality Analyzer',
        description: '代码质量和最佳实践分析',
        capabilities: [
          'code_review',
          'style_check',
          'complexity_analysis',
          'best_practices_check'
        ]
      },
      {
        id: 'performance_analyzer',
        name: 'Performance Analyzer',
        description: '性能分析和优化建议',
        capabilities: [
          'profiling',
          'bottleneck_detection',
          'optimization_suggestions',
          'resource_analysis'
        ]
      },
      {
        id: 'test_engineer',
        name: 'Test Engineer',
        description: '测试用例生成和测试执行',
        capabilities: [
          'test_generation',
          'test_execution',
          'coverage_analysis',
          'test_optimization'
        ]
      },
      {
        id: 'custom',
        name: 'Custom Agent',
        description: '自定义角色',
        capabilities: []
      }
    ];
  }

  /**
   * 验证角色是否有效
   */
  static isValidRole(role) {
    const validRoles = ['security_auditor', 'code_quality_analyzer', 'performance_analyzer', 'test_engineer', 'custom'];
    return validRoles.includes(role);
  }
}

module.exports = AgentRoleFactory;