import logger from '../core/monitoring/logger.js';
/**
 * P2P 连接管理器
 *
 * 功能：
 * - 连接池管理
 * - 连接状态监控
 * - 断线重连
 * - 心跳检测
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class ConnectionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.connections = new Map();        // peerId -> connection
    this.connectionPool = [];            // 可用连接池
    this.maxConnections = options.maxConnections || 50;
    this.maxPoolSize = options.maxPoolSize || 10;
    this.heartbeatInterval = options.heartbeatInterval || 30000;  // 30秒
    this.reconnectDelay = options.reconnectDelay || 5000;          // 5秒
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.heartbeatTimers = new Map();
    this.reconnectAttempts = new Map();
  }

  /**
   * 添加连接
   */
  addConnection(peerId, connection, metadata = {}) {
    const connInfo = {
      peerId,
      connection,
      status: 'CONNECTED',
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      lastHeartbeat: Date.now(),
      metadata,
      messageCount: 0,
      bytesTransferred: 0
    };

    this.connections.set(peerId, connInfo);

    // 设置心跳
    this.startHeartbeat(peerId);

    // 监听连接关闭
    connection.on('close', () => {
      this.handleDisconnect(peerId);
    });

    // 监听错误
    connection.on('error', (err) => {
      logger.error(`[ConnectionManager] Connection error with ${peerId}:`, err.message);
      this.emit('error', { peerId, error: err });
    });

    this.emit('connected', { peerId, metadata });
    return connInfo;
  }

  /**
   * 获取连接
   */
  getConnection(peerId) {
    return this.connections.get(peerId);
  }

  /**
   * 获取所有连接
   */
  getAllConnections() {
    return Array.from(this.connections.values());
  }

  /**
   * 获取活跃连接数
   */
  getActiveCount() {
    return Array.from(this.connections.values())
      .filter(c => c.status === 'CONNECTED').length;
  }

  /**
   * 移除连接
   */
  removeConnection(peerId) {
    const conn = this.connections.get(peerId);
    if (conn) {
      this.stopHeartbeat(peerId);
      this.connections.delete(peerId);
      this.emit('disconnected', { peerId });
    }
  }

  /**
   * 更新连接状态
   */
  updateActivity(peerId) {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.lastActivity = Date.now();
    }
  }

  /**
   * 记录消息
   */
  recordMessage(peerId, bytes, isOutgoing) {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.messageCount++;
      conn.bytesTransferred += bytes;
      conn.lastActivity = Date.now();
    }
  }

  /**
   * 开始心跳
   */
  startHeartbeat(peerId) {
    this.stopHeartbeat(peerId);

    const timer = setInterval(() => {
      this.sendHeartbeat(peerId);
    }, this.heartbeatInterval);

    this.heartbeatTimers.set(peerId, timer);
  }

  /**
   * 停止心跳
   */
  stopHeartbeat(peerId) {
    const timer = this.heartbeatTimers.get(peerId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(peerId);
    }
  }

  /**
   * 发送心跳
   */
  sendHeartbeat(peerId) {
    const conn = this.connections.get(peerId);
    if (!conn || conn.status !== 'CONNECTED') {
      return;
    }

    // 检查超时
    const now = Date.now();
    if (now - conn.lastHeartbeat > this.heartbeatInterval * 3) {
      logger.warn(`[ConnectionManager] No heartbeat from ${peerId}, marking as stale`);
      this.handleDisconnect(peerId);
      return;
    }

    conn.lastHeartbeat = now;

    // 发送心跳消息
    try {
      if (conn.connection && !conn.connection.destroyed) {
        conn.connection.write(JSON.stringify({ type: 'heartbeat', timestamp: now }));
      }
    } catch (e) {
      logger.error(`[ConnectionManager] Failed to send heartbeat to ${peerId}:`, e.message);
    }
  }

  /**
   * 处理断开连接
   */
  handleDisconnect(peerId) {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    conn.status = 'DISCONNECTED';
    this.stopHeartbeat(peerId);

    // 尝试重连
    const attempts = this.reconnectAttempts.get(peerId) || 0;
    if (attempts < this.maxReconnectAttempts) {
      logger.info(`[ConnectionManager] Attempting reconnect to ${peerId} (attempt ${attempts + 1})`);
      this.reconnectAttempts.set(peerId, attempts + 1);

      setTimeout(() => {
        this.emit('reconnect', { peerId, attempt: attempts + 1 });
      }, this.reconnectDelay * (attempts + 1));
    } else {
      logger.warn(`[ConnectionManager] Max reconnect attempts reached for ${peerId}`);
      this.removeConnection(peerId);
      this.reconnectAttempts.delete(peerId);
      this.emit('connectionFailed', { peerId });
    }
  }

  /**
   * 重置重连计数
   */
  resetReconnectAttempts(peerId) {
    this.reconnectAttempts.delete(peerId);
  }

  /**
   * 添加到连接池
   */
  addToPool(peerId) {
    const conn = this.connections.get(peerId);
    if (!conn || conn.status !== 'CONNECTED') return;

    if (this.connectionPool.length < this.maxPoolSize) {
      this.connectionPool.push(peerId);
    }
  }

  /**
   * 从连接池获取
   */
  getFromPool() {
    if (this.connectionPool.length === 0) return null;
    return this.connectionPool.shift();
  }

  /**
   * 清理不活跃连接
   */
  cleanup(maxInactiveTime = 300000) {  // 5分钟
    const now = Date.now();
    const toRemove = [];

    for (const [peerId, conn] of this.connections) {
      if (now - conn.lastActivity > maxInactiveTime) {
        toRemove.push(peerId);
      }
    }

    for (const peerId of toRemove) {
      logger.info(`[ConnectionManager] Removing inactive connection: ${peerId}`);
      this.removeConnection(peerId);
    }

    return toRemove.length;
  }

  /**
   * 获取连接统计
   */
  getStats() {
    const connections = this.getAllConnections();
    const totalMessages = connections.reduce((sum, c) => sum + c.messageCount, 0);
    const totalBytes = connections.reduce((sum, c) => sum + c.bytesTransferred, 0);

    return {
      totalConnections: this.connections.size,
      activeConnections: this.getActiveCount(),
      poolSize: this.connectionPool.length,
      totalMessages,
      totalBytes,
      avgMessagesPerConnection: connections.length > 0 ? Math.round(totalMessages / connections.length) : 0,
      avgBytesPerConnection: connections.length > 0 ? Math.round(totalBytes / connections.length) : 0
    };
  }

  /**
   * 停止所有连接
   */
  stopAll() {
    for (const [peerId, timer] of this.heartbeatTimers) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    for (const [peerId, conn] of this.connections) {
      try {
        conn.connection.destroy();
      } catch (e) {
        // 忽略
      }
    }

    this.connections.clear();
    this.connectionPool = [];
    this.reconnectAttempts.clear();
  }
}

module.exports = { ConnectionManager };