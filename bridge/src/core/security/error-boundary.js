import logger from '../logger.js';
/**
 * 错误边界处理器 - 提升系统稳定性
 * 实现更完善的错误处理机制
 */

export class ErrorBoundary {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.timeout = options.timeout || 30000; // 30秒超时
    this.onError = options.onError || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    
    // 错误统计
    this.errorStats = {
      totalErrors: 0,
      retriedOperations: 0,
      failedOperations: 0,
      successfulOperations: 0
    };
  }

  /**
   * 执行带有错误处理的操作
   */
  async execute(operation, context = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // 创建带超时的Promise
        const result = await this._executeWithTimeout(operation, context);
        
        // 操作成功
        this.errorStats.successfulOperations++;
        this.onSuccess(result, { attempt, context });
        
        return result;
      } catch (error) {
        lastError = error;
        this.errorStats.totalErrors++;
        
        logger.warn(`[ErrorBoundary] Operation failed on attempt ${attempt}:`, error.message);
        
        // 如果不是最后一次尝试，等待后重试
        if (attempt < this.maxRetries) {
          this.errorStats.retriedOperations++;
          await this._delay(Math.min(this.retryDelay * attempt, 5000)); // 递增延迟，最大5秒
          continue;
        }
      }
    }
    
    // 所有重试都失败了
    this.errorStats.failedOperations++;
    this.onError(lastError, { context });
    
    throw lastError;
  }

  /**
   * 带超时控制的执行
   */
  async _executeWithTimeout(operation, context) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${this.timeout}ms`));
      }, this.timeout);

      // 执行操作
      Promise.resolve()
        .then(() => operation(context))
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 延迟函数
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取错误统计
   */
  getStats() {
    return { ...this.errorStats };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.errorStats = {
      totalErrors: 0,
      retriedOperations: 0,
      failedOperations: 0,
      successfulOperations: 0
    };
  }
}

// 全局错误边界实例
export const globalErrorBoundary = new ErrorBoundary({
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000
});

// 导出便捷函数
export const withErrorHandling = (operation, options = {}) => {
  const boundary = new ErrorBoundary(options);
  return boundary.execute.bind(boundary);
};