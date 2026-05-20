import logger from '../core/monitoring/logger.js';
/**
 * Cache Manager
 * 单层缓存管理（简化版）
 */

class CacheManager {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.maxAge = options.maxAge || 3600000; // 1 小时
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 分钟

    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;

    // 定期清理过期缓存
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);

    logger.info(`[Cache] Manager initialized, maxSize: ${this.maxSize}, maxAge: ${this.maxAge}ms`);
  }

  /**
   * 设置缓存
   */
  set(key, value, options = {}) {
    const now = Date.now();

    const cacheEntry = {
      value,
      createdAt: now,
      expiresAt: options.ttl ? now + options.ttl : now + this.maxAge,
      hits: 0,
      metadata: options.metadata || {}
    };

    // 如果达到最大容量，删除最老的
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, cacheEntry);
    return true;
  }

  /**
   * 获取缓存
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // 检查过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // 更新访问统计
    entry.hits++;
    this.hits++;

    return entry.value;
  }

  /**
   * 检查缓存是否存在
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 删除缓存
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    logger.info('[Cache] Cleared');
  }

  /**
   * 清理过期缓存
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total * 100).toFixed(2) : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: `${hitRate}%`,
      totalRequests: total
    };
  }

  /**
   * 获取所有缓存键
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取缓存大小
   */
  size() {
    return this.cache.size;
  }

  /**
   * 停止管理器
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cache.clear();
    logger.info('[Cache] Manager destroyed');
  }
}

module.exports = CacheManager;