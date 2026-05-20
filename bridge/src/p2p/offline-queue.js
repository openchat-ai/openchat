import logger from '../core/monitoring/logger.js';
/**
 * Offline Queue for P2P Messages
 * 离线消息队列 - 节点离线时缓存消息
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class OfflineQueue {
  constructor(options = {}) {
    this.storageDir = options.storageDir || './data/offline-queue';
    this.maxMessages = options.maxMessages || 1000;
    this.maxAge = options.maxAge || 7 * 24 * 60 * 60 * 1000; // 7 天

    this.pendingMessages = new Map(); // peerId -> [messages]

    this.ensureStorageDir();
  }

  /**
   * 确保存储目录存在
   */
  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
      logger.info(`[OfflineQueue] Created storage directory: ${this.storageDir}`);
    }
  }

  /**
   * 存储离线消息
   */
  async store(peerId, message) {
    const messages = this.pendingMessages.get(peerId) || [];

    const queueItem = {
      id: crypto.randomUUID(),
      peerId,
      message,
      storedAt: Date.now(),
      expiresAt: Date.now() + this.maxAge
    };

    messages.push(queueItem);
    this.pendingMessages.set(peerId, messages);

    // 持久化到磁盘
    await this.persist(peerId, queueItem);

    // 检查是否超过限制
    if (this.pendingMessages.size > this.maxMessages) {
      await this.cleanup();
    }

    logger.info(`[OfflineQueue] Stored message for peer: ${peerId.slice(0, 8)}... (total: ${messages.length})`);

    return queueItem;
  }

  /**
   * 获取离线消息
   */
  async get(peerId) {
    const messages = this.pendingMessages.get(peerId) || [];

    // 过滤未过期的消息
    const now = Date.now();
    const valid = messages.filter(m => m.expiresAt > now);

    if (valid.length !== messages.length) {
      this.pendingMessages.set(peerId, valid);
    }

    return valid;
  }

  /**
   * 获取所有有离线消息的 peer
   */
  async getPeersWithMessages() {
    const peers = [];
    for (const [peerId, messages] of this.pendingMessages) {
      const now = Date.now();
      const valid = messages.filter(m => m.expiresAt > now);
      if (valid.length > 0) {
        peers.push({ peerId, messageCount: valid.length });
      }
    }
    return peers;
  }

  /**
   * 移除已发送的消息
   */
  async remove(peerId, messageIds = []) {
    const messages = this.pendingMessages.get(peerId) || [];

    if (messageIds.length === 0) {
      // 移除所有
      this.pendingMessages.delete(peerId);
      await this.deleteFile(peerId);
    } else {
      // 移除指定消息
      const remaining = messages.filter(m => !messageIds.includes(m.id));
      this.pendingMessages.set(peerId, remaining);
      await this.persistAll();
    }

    logger.info(`[OfflineQueue] Removed messages for peer: ${peerId.slice(0, 8)}...`);
  }

  /**
   * 持久化单条消息到磁盘
   */
  async persist(peerId, message) {
    const filePath = this.getFilePath(peerId);

    try {
      let messages = [];
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        messages = JSON.parse(data);
      }

      messages.push(message);

      // 限制每个 peer 的消息数量
      if (messages.length > 100) {
        messages = messages.slice(-100);
      }

      fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
    } catch (error) {
      logger.error(`[OfflineQueue] Persist error: ${error.message}`);
    }
  }

  /**
   * 持久化所有消息
   */
  async persistAll() {
    for (const [peerId, messages] of this.pendingMessages) {
      const filePath = this.getFilePath(peerId);
      try {
        fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
      } catch (error) {
        logger.error(`[OfflineQueue] Persist all error: ${error.message}`);
      }
    }
  }

  /**
   * 从磁盘加载
   */
  async load() {
    try {
      const files = fs.readdirSync(this.storageDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.storageDir, file);
        const data = fs.readFileSync(filePath, 'utf-8');
        const messages = JSON.parse(data);

        const peerId = file.replace('.json', '');
        this.pendingMessages.set(peerId, messages);
      }

      logger.info(`[OfflineQueue] Loaded ${this.pendingMessages.size} peer queues`);
    } catch (error) {
      logger.error(`[OfflineQueue] Load error: ${error.message}`);
    }
  }

  /**
   * 清理过期消息
   */
  async cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [peerId, messages] of this.pendingMessages) {
      const valid = messages.filter(m => m.expiresAt > now);
      cleaned += messages.length - valid.length;

      if (valid.length === 0) {
        this.pendingMessages.delete(peerId);
        await this.deleteFile(peerId);
      } else {
        this.pendingMessages.set(peerId, valid);
      }
    }

    if (cleaned > 0) {
      logger.info(`[OfflineQueue] Cleaned ${cleaned} expired messages`);
      await this.persistAll();
    }
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    let totalMessages = 0;
    let totalPeers = 0;

    for (const [peerId, messages] of this.pendingMessages) {
      const now = Date.now();
      const valid = messages.filter(m => m.expiresAt > now);
      if (valid.length > 0) {
        totalPeers++;
        totalMessages += valid.length;
      }
    }

    return {
      totalPeers,
      totalMessages,
      maxMessages: this.maxMessages,
      storageDir: this.storageDir
    };
  }

  getFilePath(peerId) {
    return path.join(this.storageDir, `${peerId}.json`);
  }

  async deleteFile(peerId) {
    const filePath = this.getFilePath(peerId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = OfflineQueue;