import logger from '../../core/monitoring/logger.js';
/**
 * Performance Analyzer Agent
 * 性能分析和优化建议
 */

const BaseAgent = require('./base-agent');

class PerformanceAnalyzerAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      role: 'performance_analyzer',
      name: options.name || 'Performance Analyzer',
      capabilities: [
        'profiling',
        'bottleneck_detection',
        'optimization_suggestions',
        'resource_analysis'
      ]
    });
  }

  /**
   * 运行性能分析任务
   */
  async runTask(task) {
    logger.info(`[PerformanceAnalyzer] Analyzing performance...`);

    const results = {
      metrics: {},
      bottlenecks: [],
      recommendations: [],
      optimizationPotential: 0
    };

    // 分析代码性能特征
    if (task.code) {
      // 1. 算法复杂度分析
      results.algorithms = this.analyzeAlgorithmComplexity(task.code);

      // 2. 资源使用分析
      results.resources = this.analyzeResourceUsage(task.code);

      // 3. 瓶颈检测
      results.bottlenecks = this.detectBottlenecks(task.code, results.algorithms);

      // 4. 生成优化建议
      results.recommendations = this.generateOptimizations(results.bottlenecks);

      // 5. 计算优化潜力
      results.optimizationPotential = this.calculateOptimizationPotential(results.bottlenecks);
    }

    // 生成反馈
    this.addFeedback({
      type: 'performance_analysis',
      metrics: results.metrics,
      bottlenecks: results.bottlenecks,
      recommendations: results.recommendations,
      optimizationPotential: results.optimizationPotential,
      summary: `Found ${results.bottlenecks.length} bottlenecks, potential ${results.optimizationPotential}% improvement`
    });

    return results;
  }

  /**
   * 分析算法复杂度
   */
  analyzeAlgorithmComplexity(code) {
    const algorithms = [];

    // 检测常见的算法模式
    const patterns = [
      { pattern: /\.map\s*\(/, complexity: 'O(n)', name: 'Map operation' },
      { pattern: /\.filter\s*\(/, complexity: 'O(n)', name: 'Filter operation' },
      { pattern: /\.reduce\s*\(/, complexity: 'O(n)', name: 'Reduce operation' },
      { pattern: /\.find\s*\(/, complexity: 'O(n)', name: 'Find operation' },
      { pattern: /\bfor\s*\(.*\*\*/gi, complexity: 'O(n²)', name: 'Nested loop' },
      { pattern: /\.sort\s*\(/, complexity: 'O(n log n)', name: 'Sort operation' },
      { pattern: /JSON\.parse/g, complexity: 'O(n)', name: 'JSON parsing' },
      { pattern: /recursive/gi, complexity: 'O(2^n)', name: 'Recursive call' }
    ];

    for (const { pattern, complexity, name } of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        algorithms.push({
          name,
          complexity,
          occurrences: matches.length,
          impact: complexity === 'O(n²)' || complexity === 'O(2^n)' ? 'HIGH' : 'MEDIUM'
        });
      }
    }

    return algorithms;
  }

  /**
   * 分析资源使用
   */
  analyzeResourceUsage(code) {
    const resources = {
      memory: { estimate: 'LOW', concerns: [] },
      cpu: { estimate: 'LOW', concerns: [] },
      network: { estimate: 'LOW', concerns: [] }
    };

    // 内存分析
    if (code.includes('.push(') || code.includes('concat(')) {
      resources.memory.concerns.push('Array modifications may cause memory churn');
    }
    if (code.includes('...') && !code.includes('...args')) {
      resources.memory.concerns.push('Spread operator creates new allocations');
    }
    if (code.match(/new\s+Array|new\s+Object/)) {
      resources.memory.concerns.push('Object/Array creation may impact memory');
    }

    // CPU 分析
    if (code.includes('while') || code.includes('for')) {
      resources.cpu.concerns.push('Loop operations may be CPU intensive');
    }
    if (code.includes('JSON.stringify')) {
      resources.cpu.concerns.push('JSON serialization is CPU intensive');
    }

    // 网络分析
    if (code.includes('fetch') || code.includes('axios')) {
      resources.network.concerns.push('Network calls detected');
    }
    if (code.includes('.then(') || code.includes('await ')) {
      resources.network.concerns.push('Async operations may involve network');
    }

    // 评估
    resources.memory.estimate = resources.memory.concerns.length > 2 ? 'HIGH' : 'LOW';
    resources.cpu.estimate = resources.cpu.concerns.length > 1 ? 'MEDIUM' : 'LOW';
    resources.network.estimate = resources.network.concerns.length > 0 ? 'MEDIUM' : 'LOW';

    return resources;
  }

  /**
   * 检测瓶颈
   */
  detectBottlenecks(code, algorithms) {
    const bottlenecks = [];

    // 基于算法复杂度
    for (const algo of algorithms) {
      if (algo.complexity === 'O(n²)' || algo.complexity === 'O(2^n)') {
        bottlenecks.push({
          type: 'algorithm',
          severity: 'HIGH',
          location: 'code',
          description: `${algo.name} has ${algo.complexity} complexity`,
          impact: `${algo.occurrences} occurrences`
        });
      }
    }

    // 基于常见反模式
    const antiPatterns = [
      { pattern: /for.*in\s+/, issue: 'for...in on arrays', severity: 'MEDIUM' },
      { pattern: /\bDOM\b.*\bDOM\b/, issue: 'Multiple DOM reads/writes', severity: 'MEDIUM' },
      { pattern: /setTimeout.*0/, issue: 'setTimeout in loop', severity: 'LOW' },
      { pattern: /document\.getElementById.*document\.getElementById/g, issue: 'Repeated DOM queries', severity: 'MEDIUM' }
    ];

    for (const { pattern, issue, severity } of antiPatterns) {
      if (pattern.test(code)) {
        bottlenecks.push({
          type: 'anti_pattern',
          severity,
          location: 'code',
          description: issue
        });
      }
    }

    return bottlenecks;
  }

  /**
   * 生成优化建议
   */
  generateOptimizations(bottlenecks) {
    const recommendations = [];

    for (const bottleneck of bottlenecks) {
      switch (bottleneck.type) {
        case 'algorithm':
          if (bottleneck.description.includes('Nested loop')) {
            recommendations.push('Consider using more efficient algorithms or data structures');
            recommendations.push('Break nested loops into separate operations when possible');
          }
          if (bottleneck.description.includes('Recursive')) {
            recommendations.push('Consider memoization for recursive functions');
            recommendations.push('Evaluate if iteration can replace recursion');
          }
          break;

        case 'anti_pattern':
          if (bottleneck.description.includes('for...in')) {
            recommendations.push('Use for...of or forEach for array iteration');
          }
          if (bottleneck.description.includes('DOM')) {
            recommendations.push('Cache DOM queries and batch updates');
          }
          break;
      }
    }

    // 通用优化建议
    recommendations.push('Implement caching for expensive operations');
    recommendations.push('Use lazy loading for non-critical resources');
    recommendations.push('Consider Web Workers for CPU-intensive tasks');

    return [...new Set(recommendations)];
  }

  /**
   * 计算优化潜力
   */
  calculateOptimizationPotential(bottlenecks) {
    let potential = 0;

    for (const b of bottlenecks) {
      switch (b.severity) {
        case 'HIGH': potential += 30; break;
        case 'MEDIUM': potential += 15; break;
        case 'LOW': potential += 5; break;
      }
    }

    return Math.min(100, potential);
  }
}

module.exports = PerformanceAnalyzerAgent;