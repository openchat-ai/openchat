/**
 * P2P 故障检测和重试机制
 *
 * 功能：
 * - 故障检测
 * - 心跳机制
 * - 消息重试
 * - 离线队列管理
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class FaultTolerance extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.maxRetryDelay = options.maxRetryDelay || 30000;
    this.heartbeatTimeout = options.heartbeatTimeout || 60000;
    this.offlineQueue = new Map();       // offline messages
    this.pendingMessages = new Map();    // awaiting ack
    this.messageHistory = new Map();     // for deduplication
    this.peerStatus = new Map();         // peer health status
    this.retryTimers = new Map();
  }

  /**
   * 发送消息（带重试）
   */
  async sendWithRetry(message, sendFn, options = {}) {
    const messageId = message.id || crypto.randomUUID();
    const { maxRetries = this.maxRetries, priority = 'NORMAL' } = options;

    const envelope = {
      messageId,
      message,
      attempts: 0,
      maxRetries,
      sendFn,
      priority,
      createdAt: Date.now(),
      lastAttempt: null,
      status: 'PENDING'
    };

    this.pendingMessages.set(messageId, envelope);

    return this.attemptSend(envelope);
  }

  /**
   * 尝试发送
   */
  async attemptSend(envelope) {
    const { messageId, message, attempts, maxRetries, sendFn } = envelope;

    if (attempts >= maxRetries) {
      envelope.status = 'FAILED';
      this.emit('messageFailed', { messageId, attempts, message });
      return { success: false, messageId, attempts, error: 'Max retries reached' };
    }

    envelope.attempts++;
    envelope.lastAttempt = Date.now();

    try {
      const result = await sendFn(message);

      if (result && result.success !== false) {
        envelope.status = 'SENT';
        this.emit('messageSent', { messageId, attempts, result });
        return { success: true, messageId, attempts, result };
      } else {
        // 发送失败，计划重试
        return this.scheduleRetry(envelope, result?.error);
      }
    } catch (error) {
      console.error(`[FaultTolerance] Send error:`, error.message);
      return this.scheduleRetry(envelope, error.message);
    }
  }

  /**
   * 计划重试
   */
  scheduleRetry(envelope, error) {
    const { messageId, attempts, maxRetries } = envelope;

    // 指数退避
    const delay = Math.min(
      this.retryDelay * Math.pow(2, attempts - 1),
      this.maxRetryDelay
    );

    console.log(`[FaultTolerance] Scheduling retry ${attempts}/${maxRetries} for ${messageId} in ${delay}ms`);

    const timer = setTimeout(async () => {
      this.retryTimers.delete(messageId);
      await this.attemptSend(envelope);
    }, delay);

    this.retryTimers.set(messageId, timer);
    envelope.status = 'RETRYING';

    this.emit('retryScheduled', { messageId, attempts, delay, error });

    return { success: false, messageId, attempts, retrying: true, delay };
  }

  /**
   * 添加到离线队列
   */
  addToOfflineQueue(peerId, message) {
    if (!this.offlineQueue.has(peerId)) {
      this.offlineQueue.set(peerId, []);
    }

    const queue = this.offlineQueue.get(peerId);
    const envelope = {
      id: crypto.randomUUID(),
      message,
      queuedAt: Date.now(),
      priority: message.priority || 'NORMAL'
    };

    // 按优先级排序
    const priorities = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    const insertIndex = queue.findIndex(
      e => priorities[e.priority] > priorities[envelope.priority]
    );

    if (insertIndex === -1) {
      queue.push(envelope);
    } else {
      queue.splice(insertIndex, 0, envelope);
    }

    this.emit('queued', { peerId, queueSize: queue.length });

    return envelope;
  }

  /**
   * 获取离线队列
   */
  getOfflineQueue(peerId) {
    return this.offlineQueue.get(peerId) || [];
  }

  /**
   * 获取所有离线队列
   */
  getAllOfflineQueues() {
    const queues = [];
    for (const [peerId, messages] of this.offlineQueue) {
      queues.push({
        peerId,
        count: messages.length,
        oldestMessage: messages[0]?.queuedAt
      });
    }
    return queues;
  }

  /**
   * 处理离线消息
   */
  async processOfflineQueue(peerId, sendFn) {
    const queue = this.offlineQueue.get(peerId);
    if (!queue || queue.length === 0) return { processed: 0 };

    const processed = [];
    const failed = [];

    while (queue.length > 0) {
      const envelope = queue.shift();

      try {
        await sendFn(envelope.message);
        processed.push(envelope.id);
      } catch (error) {
        failed.push({ id: envelope.id, error: error.message });
        // 放回队列末尾
        queue.push(envelope);
      }
    }

    this.emit('offlineQueueProcessed', { peerId, processed: processed.length, failed: failed.length });

    return { processed: processed.length, failed: failed.length };
  }

  /**
   * 更新 Peer 状态
   */
  updatePeerStatus(peerId, status) {
    const current = this.peerStatus.get(peerId) || {
      peerId,
      status: 'UNKNOWN',
      lastHeartbeat: null,
      consecutiveFailures: 0,
      lastCheck: null
    };

    current.status = status;
    current.lastCheck = Date.now();

    if (status === 'ALIVE') {
      current.consecutiveFailures = 0;
      current.lastHeartbeat = Date.now();
    } else if (status === 'FAILED') {
      current.consecutiveFailures++;
    }

    this.peerStatus.set(peerId, current);
    this.emit('peerStatusChanged', { peerId, status, consecutiveFailures: current.consecutiveFailures });

    return current;
  }

  /**
   * 检查 Peer 是否健康
   */
  isPeerHealthy(peerId) {
    const status = this.peerStatus.get(peerId);
    if (!status) return true;  // 未知默认为健康

    // 检查心跳超时
    if (status.lastHeartbeat) {
      const timeSinceHeartbeat = Date.now() - status.lastHeartbeat;
      if (timeSinceHeartbeat > this.heartbeatTimeout) {
        return false;
      }
    }

    // 检查连续失败次数
    if (status.consecutiveFailures >= 3) {
      return false;
    }

    return status.status === 'ALIVE' || status.status === 'UNKNOWN';
  }

  /**
   * 获取不健康的 Peer
   */
  getUnhealthyPeers() {
    const unhealthy = [];
    for (const [peerId] of this.peerStatus) {
      if (!this.isPeerHealthy(peerId)) {
        unhealthy.push(peerId);
      }
    }
    return unhealthy;
  }

  /**
   * 记录消息历史（去重）
   */
  recordMessage(messageId, peerId) {
    const key = `${peerId}:${messageId}`;
    this.messageHistory.set(key, Date.now());

    // 清理旧记录
    if (this.messageHistory.size > 10000) {
      const now = Date.now();
      for (const [k, time] of this.messageHistory) {
        if (now - time > 3600000) {  // 1小时
          this.messageHistory.delete(k);
        }
      }
    }
  }

  /**
   * 检查消息是否已处理（去重）
   */
  isMessageProcessed(messageId, peerId) {
    const key = `${peerId}:${messageId}`;
    return this.messageHistory.has(key);
  }

  /**
   * 取消重试
   */
  cancelRetry(messageId) {
    const timer = this.retryTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(messageId);
    }

    const envelope = this.pendingMessages.get(messageId);
    if (envelope) {
      envelope.status = 'CANCELLED';
    }
  }

  /**
   * 获取统计
   */
  getStats() {
    let pending = 0;
    let retrying = 0;

    for (const envelope of this.pendingMessages.values()) {
      if (envelope.status === 'PENDING') pending++;
      else if (envelope.status === 'RETRYING') retrying++;
    }

    let offlineQueueTotal = 0;
    for (const queue of this.offlineQueue.values()) {
      offlineQueueTotal += queue.length;
    }

    return {
      pendingMessages: pending,
      retryingMessages: retrying,
      totalPending: this.pendingMessages.size,
      offlineQueueTotal,
      offlineQueues: this.offlineQueue.size,
      unhealthyPeers: this.getUnhealthyPeers().length,
      messageHistorySize: this.messageHistory.size
    };
  }

  /**
   * 清理
   */
  clear() {
    // 取消所有重试定时器
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    this.pendingMessages.clear();
    this.offlineQueue.clear();
    this.peerStatus.clear();
  }
}

module.exports = { FaultTolerance };