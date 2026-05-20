import logger from '../core/logger.js';
/**
 * Priority Queue for P2P Messages
 * 优先级队列实现
 */

class PriorityQueue {
  constructor() {
    this.queues = {
      CRITICAL: [],
      HIGH: [],
      NORMAL: [],
      LOW: []
    };

    this.maxDelays = {
      CRITICAL: 1000,   // 1s
      HIGH: 10000,      // 10s
      NORMAL: 300000,   // 5min
      LOW: 86400000     // 1day
    };

    this.processing = false;
  }

  /**
   * 添加消息到队列
   */
  enqueue(message, priority = 'NORMAL') {
    const validPriorities = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];
    priority = validPriorities.includes(priority) ? priority : 'NORMAL';

    const queueItem = {
      message,
      priority,
      enqueuedAt: Date.now(),
      retries: 0
    };

    this.queues[priority].push(queueItem);
    return queueItem;
  }

  /**
   * 获取下一条要处理的消息
   */
  dequeue() {
    // 按优先级顺序获取
    const priorities = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];

    for (const priority of priorities) {
      const queue = this.queues[priority];

      if (queue.length > 0) {
        // 检查是否超时
        const now = Date.now();
        const item = queue[0];
        const age = now - item.enqueuedAt;

        if (age <= this.maxDelays[priority]) {
          return queue.shift();
        } else {
          // 超时，移除并记录
          logger.info(`[PriorityQueue] ${priority} message timed out after ${age}ms`);
          queue.shift();
        }
      }
    }

    return null;
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      CRITICAL: this.queues.CRITICAL.length,
      HIGH: this.queues.HIGH.length,
      NORMAL: this.queues.NORMAL.length,
      LOW: this.queues.LOW.length,
      total: Object.values(this.queues).reduce((sum, q) => sum + q.length, 0)
    };
  }

  /**
   * 清空队列
   */
  clear() {
    for (const priority of Object.keys(this.queues)) {
      this.queues[priority] = [];
    }
  }

  /**
   * 获取指定优先级的消息（不移除）
   */
  peek(priority = 'NORMAL') {
    return this.queues[priority][0] || null;
  }

  /**
   * 批量添加消息
   */
  enqueueBatch(messages) {
    const results = [];
    for (const { message, priority } of messages) {
      results.push(this.enqueue(message, priority));
    }
    return results;
  }
}

module.exports = PriorityQueue;