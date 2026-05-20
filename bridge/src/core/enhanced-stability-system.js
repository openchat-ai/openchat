/**
 * 增强稳定性系统主模块
 * 整合错误处理、内存管理、性能监控和健康检查
 */

import { globalErrorBoundary } from './error-boundary.js';
import { getEnhancedMemoryManager } from './memory-manager-enhanced.js';
import { getPerformanceMonitor } from './performance-monitor.js';
import { getSystemHealthChecker } from './system-health-checker.js';
// 使用已有的 multi-agent-coordinator.js
import multiAgentCoordinator from './multi-agent-coordinator.js';
const getGlobalCoordinator = () => multiAgentCoordinator;

export class EnhancedStabilitySystem {
  constructor(options = {}) {
    this.options = {
      enableErrorHandling: options.enableErrorHandling !== false,
      enableMemoryManagement: options.enableMemoryManagement !== false,
      enablePerformanceMonitoring: options.enablePerformanceMonitoring !== false,
      enableHealthChecking: options.enableHealthChecking !== false,
      enableMultiAgent: options.enableMultiAgent !== false,
      ...options
    };
    
    // 初始化各组件
    this.components = {};
    
    if (this.options.enableErrorHandling) {
      this.components.errorBoundary = globalErrorBoundary;
    }
    
    if (this.options.enableMemoryManagement) {
      this.components.memoryManager = getEnhancedMemoryManager(options.memoryOptions);
    }
    
    if (this.options.enablePerformanceMonitoring) {
      this.components.performanceMonitor = getPerformanceMonitor(options.performanceOptions);
    }
    
    if (this.options.enableHealthChecking) {
      this.components.healthChecker = getSystemHealthChecker(options.healthOptions);
    }

    if (this.options.enableMultiAgent) {
      this.components.coordinator = getGlobalCoordinator(options.agentOptions);
    }
  }

  /**
   * 执行带完整保护的操作
   */
  async executeProtectedOperation(operation, context = {}) {
    if (!this.options.enableErrorHandling) {
      // 如果没有错误处理，直接执行
      return await operation(context);
    }
    
    // 使用错误边界执行
    return await this.components.errorBoundary.execute(operation, context);
  }

  /**
   * 执行带性能监控的操作
   */
  async executeMonitoredOperation(operation, operationName = 'operation', context = {}) {
    if (!this.options.enablePerformanceMonitoring) {
      return await operation(context);
    }
    
    const requestInfo = this.components.performanceMonitor.startRequest();
    
    try {
      const result = await operation(context);
      this.components.performanceMonitor.endRequest(requestInfo);
      return result;
    } catch (error) {
      this.components.performanceMonitor.endRequest(requestInfo, error);
      throw error;
    }
  }

  /**
   * 执行带内存管理的操作
   */
  async executeWithMemoryManagement(operation, sessionId, context = {}) {
    if (!this.options.enableMemoryManagement) {
      return await operation(context);
    }
    
    // 添加会话到内存管理器
    this.components.memoryManager.addSession(sessionId, context);
    
    try {
      const result = await operation(context);
      return result;
    } finally {
      // 操作完成后可选择保留或删除会话
      // 这里可以选择性地清理会话
    }
  }

  /**
   * 并行执行多个操作
   */
  async executeParallel(operations, context = {}) {
    if (!this.options.enableMultiAgent) {
      // 如果没有多代理支持，顺序执行
      const results = [];
      for (const op of operations) {
        try {
          const result = await this.executeProtectedOperation(op, context);
          results.push({ success: true, result });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }
      return results;
    }
    
    // 使用多代理协调器执行
    const tasks = operations.map(op => ({ operation: op, context }));
    return await this.components.coordinator.executeParallel(tasks);
  }

  /**
   * 运行健康检查
   */
  async runHealthCheck() {
    if (!this.options.enableHealthChecking) {
      return { status: 'healthy', message: 'Health checking disabled' };
    }
    
    return await this.components.healthChecker.runAllChecks();
  }

  /**
   * 获取系统状态
   */
  getSystemStatus() {
    const status = {
      timestamp: Date.now(),
      components: Object.keys(this.components),
      errorHandling: this.options.enableErrorHandling,
      memoryManagement: this.options.enableMemoryManagement,
      performanceMonitoring: this.options.enablePerformanceMonitoring,
      healthChecking: this.options.enableHealthChecking,
      multiAgent: this.options.enableMultiAgent
    };
    
    // 添加各组件的状态
    if (this.components.performanceMonitor) {
      status.performance = this.components.performanceMonitor.getMetrics();
    }
    
    if (this.components.memoryManager) {
      status.memory = this.components.memoryManager.getStats();
    }
    
    if (this.components.healthChecker) {
      status.health = this.components.healthChecker.getSummary();
    }
    
    if (this.components.coordinator) {
      status.agents = this.components.coordinator.getStatus ? this.components.coordinator.getStatus() : {};
    }
    
    return status;
  }

  /**
   * 启动系统
   */
  start() {
    // 启动健康检查
    if (this.components.healthChecker) {
      this.components.healthChecker.startAutoCheck();
    }

    // 注册一些基本的健康检查
    if (this.components.healthChecker) {
      this.components.healthChecker.registerCheck('stability-system', async () => {
        return {
          healthy: true,
          details: {
            components: Object.keys(this.components),
            timestamp: Date.now()
          }
        };
      });
    }
  }

  /**
   * 停止系统
   */
  stop() {
    // 停止健康检查
    if (this.components.healthChecker) {
      this.components.healthChecker.stopAutoCheck();
    }

    // 销毁内存管理器
    if (this.components.memoryManager) {
      this.components.memoryManager.destroy();
    }
    
  }

  /**
   * 创建中间件
   */
  createMiddleware() {
    const system = this;
    
    return async (ctx, next) => {
      if (!system.options.enablePerformanceMonitoring) {
        await next();
        return;
      }
      
      const requestInfo = system.components.performanceMonitor.startRequest();
      
      try {
        await next();
        system.components.performanceMonitor.endRequest(requestInfo);
      } catch (error) {
        system.components.performanceMonitor.endRequest(requestInfo, error);
        throw error;
      }
    };
  }
}

// 全局实例
let globalStabilitySystem = null;

export const getEnhancedStabilitySystem = (options = {}) => {
  if (!globalStabilitySystem) {
    globalStabilitySystem = new EnhancedStabilitySystem(options);
  }
  return globalStabilitySystem;
};

// 便捷函数
export const withEnhancedStability = (fn, options = {}) => {
  return async (...args) => {
    const system = getEnhancedStabilitySystem(options);
    return await system.executeProtectedOperation(() => fn(...args));
  };
};

// 默认导出
export default EnhancedStabilitySystem;