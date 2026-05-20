import logger from '../core/logger.js';
/**
 * P2P 路由引擎
 *
 * 功能：
 * - 消息路由
 * - 智能路由选择
 * - 消息转发
 * - 网络拓扑维护
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class RoutingEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.routingTable = new Map();      // peerId -> routing info
    this.routes = new Map();            // messageId -> route
    this.forwardingTable = new Map();   // peerId -> next hops
    this.messageQueue = new Map();      // pending messages
    this.maxHops = options.maxHops || 5;
    this.routeCacheSize = options.routeCacheSize || 100;
    this.routeCache = new Map();        // cached routes
  }

  /**
   * 添加路由
   */
  addRoute(peerId, info = {}) {
    const routingInfo = {
      peerId,
      address: info.address,
      port: info.port,
      lastSeen: Date.now(),
      latency: info.latency || 0,
      reliability: info.reliability || 1.0,
      cost: info.cost || 1,
      publicKey: info.publicKey,
      metadata: info.metadata || {}
    };

    this.routingTable.set(peerId, routingInfo);
    this.emit('routeAdded', { peerId, routingInfo });

    return routingInfo;
  }

  /**
   * 移除路由
   */
  removeRoute(peerId) {
    const removed = this.routingTable.delete(peerId);
    if (removed) {
      this.emit('routeRemoved', { peerId });
    }
    return removed;
  }

  /**
   * 获取路由
   */
  getRoute(peerId) {
    return this.routingTable.get(peerId);
  }

  /**
   * 获取所有路由
   */
  getAllRoutes() {
    return Array.from(this.routingTable.values());
  }

  /**
   * 查找最佳路由
   */
  findBestRoute(targetPeerId, excludePeers = []) {
    const direct = this.routingTable.get(targetPeerId);
    if (direct) {
      return {
        path: [targetPeerId],
        cost: direct.cost,
        hops: 0
      };
    }

    // 简单的泛洪查找（实际应该用更复杂的算法如 DHT）
    let bestRoute = null;
    let minCost = Infinity;

    for (const [peerId, info] of this.routingTable) {
      if (excludePeers.includes(peerId)) continue;
      if (peerId === targetPeerId) continue;

      // 启发式：选择延迟低、可靠性高的
      const cost = info.latency * (1 - info.reliability) + info.cost;
      if (cost < minCost) {
        minCost = cost;
        bestRoute = {
          path: [peerId, targetPeerId],
          cost,
          hops: 1
        };
      }
    }

    return bestRoute;
  }

  /**
   * 路由消息
   */
  routeMessage(message, options = {}) {
    const { target, source, priority = 'NORMAL' } = options;

    if (!target) {
      // 广播
      return this.broadcastMessage(message, options);
    }

    // 检查缓存
    const cacheKey = `${source}-${target}`;
    const cached = this.routeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return this.forwardMessage(message, cached.peerId, options);
    }

    // 查找最佳路由
    const route = this.findBestRoute(target);
    if (!route) {
      logger.warn(`[RoutingEngine] No route found for ${target}`);
      return null;
    }

    // 缓存路由
    if (this.routeCache.size >= this.routeCacheSize) {
      const firstKey = this.routeCache.keys().next().value;
      this.routeCache.delete(firstKey);
    }
    this.routeCache.set(cacheKey, { peerId: route.path[0], timestamp: Date.now() });

    return this.forwardMessage(message, route.path[0], options);
  }

  /**
   * 转发消息
   */
  forwardMessage(message, nextHop, options = {}) {
    const messageId = message.id || crypto.randomUUID();

    const route = {
      messageId,
      source: options.source,
      target: options.target,
      nextHop,
      path: [options.source, nextHop].filter(Boolean),
      hops: 1,
      timestamp: Date.now(),
      status: 'FORWARDING'
    };

    this.routes.set(messageId, route);
    this.emit('messageRouted', { messageId, nextHop, route });

    return {
      messageId,
      nextHop,
      route
    };
  }

  /**
   * 广播消息
   */
  broadcastMessage(message, options = {}) {
    const { exclude = [], maxRecipients = 10 } = options;
    const recipients = [];

    for (const [peerId] of this.routingTable) {
      if (exclude.includes(peerId)) continue;
      if (recipients.length >= maxRecipients) break;
      recipients.push(peerId);
    }

    const results = recipients.map(peerId =>
      this.forwardMessage(message, peerId, options)
    );

    this.emit('broadcast', {
      messageId: message.id,
      recipients,
      count: recipients.length
    });

    return results;
  }

  /**
   * 记录消息传递结果
   */
  recordDelivery(messageId, success, error = null) {
    const route = this.routes.get(messageId);
    if (route) {
      route.status = success ? 'DELIVERED' : 'FAILED';
      route.deliveredAt = Date.now();
      route.error = error;

      this.emit('deliveryRecorded', { messageId, success, error });
    }
  }

  /**
   * 更新路由信息
   */
  updateRoute(peerId, updates) {
    const current = this.routingTable.get(peerId);
    if (!current) return null;

    const updated = { ...current, ...updates, lastSeen: Date.now() };
    this.routingTable.set(peerId, updated);

    return updated;
  }

  /**
   * 更新延迟
   */
  updateLatency(peerId, latency) {
    return this.updateRoute(peerId, { latency });
  }

  /**
   * 更新可靠性
   */
  updateReliability(peerId, success) {
    const current = this.routingTable.get(peerId);
    if (!current) return null;

    // 指数移动平均
    const newReliability = current.reliability * 0.9 + (success ? 0.1 : 0);
    return this.updateRoute(peerId, { reliability: newReliability });
  }

  /**
   * 获取路由统计
   */
  getStats() {
    const routes = this.getAllRoutes();
    const avgLatency = routes.reduce((sum, r) => sum + r.latency, 0) / (routes.length || 1);
    const avgReliability = routes.reduce((sum, r) => sum + r.reliability, 0) / (routes.length || 1);

    return {
      totalRoutes: routes.length,
      avgLatency: Math.round(avgLatency),
      avgReliability: Math.round(avgReliability * 100) / 100,
      cachedRoutes: this.routeCache.size,
      pendingMessages: this.messageQueue.size
    };
  }

  /**
   * 清理过期路由
   */
  cleanup(maxAge = 300000) {  // 5分钟
    const now = Date.now();
    const toRemove = [];

    for (const [peerId, info] of this.routingTable) {
      if (now - info.lastSeen > maxAge) {
        toRemove.push(peerId);
      }
    }

    for (const peerId of toRemove) {
      this.removeRoute(peerId);
    }

    return toRemove.length;
  }

  /**
   * 停止引擎
   */
  stop() {
    this.routingTable.clear();
    this.routes.clear();
    this.routeCache.clear();
    this.messageQueue.clear();
  }
}

module.exports = { RoutingEngine };