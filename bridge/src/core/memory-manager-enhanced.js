import logger from './logger.js';
/**
 * 增强版内存管理器
 * 优化内存使用，防止内存泄漏
 */

export class EnhancedMemoryManager {
  constructor(options = {}) {
    // 使用弱引用存储，帮助垃圾回收
    this.sessions = new Map();
    this.users = new Map();
    this.cache = new Map();
    
    // 内存限制 (默认512MB)
    this.memoryLimit = options.memoryLimit || 512 * 1024 * 1024; // 字节
    
    // 清理间隔 (默认10分钟)
    this.cleanupInterval = options.cleanupInterval || 600000; // 10分钟
    
    // 启动定期清理
    this.startCleanupTimer();
    
    // 监听内存使用
    this.monitorMemoryUsage();
  }

  /**
   * 添加会话数据
   */
  addSession(sessionId, data, userId = null) {
    const session = {
      id: sessionId,
      data,
      userId,
      timestamp: Date.now(),
      size: this._estimateSize(data)
    };
    
    this.sessions.set(sessionId, session);
    
    // 如果有用户ID，也记录到用户数据中
    if (userId) {
      if (!this.users.has(userId)) {
        this.users.set(userId, []);
      }
      this.users.get(userId).push(sessionId);
    }
    
    // 检查内存使用
    this._checkMemoryUsage();
  }

  /**
   * 获取会话数据
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      // 更新访问时间
      session.lastAccessed = Date.now();
      return session.data;
    }
    return null;
  }

  /**
   * 删除会话
   */
  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session && session.userId) {
      const userSessions = this.users.get(session.userId);
      if (userSessions) {
        const index = userSessions.indexOf(sessionId);
        if (index > -1) {
          userSessions.splice(index, 1);
        }
      }
    }
    return this.sessions.delete(sessionId);
  }

  /**
   * 添加缓存
   */
  setCache(key, value, ttl = 300000) { // 默认5分钟TTL
    const cacheItem = {
      value,
      timestamp: Date.now(),
      ttl,
      size: this._estimateSize(value)
    };
    
    this.cache.set(key, cacheItem);
  }

  /**
   * 获取缓存
   */
  getCache(key) {
    const item = this.cache.get(key);
    if (item) {
      // 检查是否过期
      if (Date.now() - item.timestamp > item.ttl) {
        this.cache.delete(key);
        return null;
      }
      
      // 更新访问时间
      item.lastAccessed = Date.now();
      return item.value;
    }
    return null;
  }

  /**
   * 清理过期项目
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    // 清理会话
    for (const [sessionId, session] of this.sessions) {
      if (now - session.timestamp > 3600000) { // 1小时后清理
        this.removeSession(sessionId);
        cleanedCount++;
      }
    }
    
    // 清理缓存
    for (const [key, item] of this.cache) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }
    
    // 清理空的用户会话列表
    for (const [userId, sessionIds] of this.users) {
      const filtered = sessionIds.filter(id => this.sessions.has(id));
      if (filtered.length === 0) {
        this.users.delete(userId);
      } else {
        this.users.set(userId, filtered);
      }
    }

    return cleanedCount;
  }

  /**
   * 启动清理定时器
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * 停止清理定时器
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 监控内存使用
   */
  monitorMemoryUsage() {
    this.memoryMonitor = setInterval(() => {
      this._checkMemoryUsage();
    }, 30000); // 每30秒检查一次
  }

  /**
   * 检查内存使用情况
   */
  _checkMemoryUsage() {
    if (global.gc) {
      global.gc(); // 如果启用了--expose-gc，强制垃圾回收
    }
    
    const used = this._getCurrentMemoryUsage();
    const percentage = (used / this.memoryLimit) * 100;
    
    if (percentage > 80) {
      logger.warn(`[MemoryManager] High memory usage: ${percentage.toFixed(2)}%`);
      if (percentage > 90) {
        // 严重高内存使用，进行强制清理
        this._aggressiveCleanup();
      }
    }
  }

  /**
   * 获取当前估计内存使用
   */
  _getCurrentMemoryUsage() {
    let totalSize = 0;
    
    // 估算会话数据大小
    for (const session of this.sessions.values()) {
      totalSize += session.size;
    }
    
    // 估算缓存数据大小
    for (const item of this.cache.values()) {
      totalSize += item.size;
    }
    
    return totalSize;
  }

  /**
   * 激进的清理策略
   */
  _aggressiveCleanup() {
    // 清理一半最旧的会话
    const sessionsArray = Array.from(this.sessions.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const halfPoint = Math.floor(sessionsArray.length / 2);
    for (let i = 0; i < halfPoint; i++) {
      this.removeSession(sessionsArray[i][0]);
    }

    // 清理一半最旧的缓存
    const cacheArray = Array.from(this.cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const cacheHalfPoint = Math.floor(cacheArray.length / 2);
    for (let i = 0; i < cacheHalfPoint; i++) {
      this.cache.delete(cacheArray[i][0]);
    }
  }

  /**
   * 估算对象大小
   */
  _estimateSize(obj) {
    try {
      const str = JSON.stringify(obj);
      return new Blob([str]).size;
    } catch (e) {
      // 如果无法序列化，返回保守估计
      return obj ? String(obj).length : 0;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      sessionCount: this.sessions.size,
      userCount: this.users.size,
      cacheCount: this.cache.size,
      estimatedMemoryUsage: this._getCurrentMemoryUsage(),
      memoryLimit: this.memoryLimit,
      memoryPercentage: (this._getCurrentMemoryUsage() / this.memoryLimit) * 100
    };
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.stopCleanupTimer();
    if (this.memoryMonitor) {
      clearInterval(this.memoryMonitor);
    }
    
    this.sessions.clear();
    this.users.clear();
    this.cache.clear();
  }
}

// 单例模式
let instance = null;
export const getEnhancedMemoryManager = (options = {}) => {
  if (!instance) {
    instance = new EnhancedMemoryManager(options);
  }
  return instance;
};