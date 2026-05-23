/**
 * 分层缓存系统
 *
 * 功能：
 * - L1/L2 多层缓存
 * - 缓存淘汰策略
 * - 缓存预热
 * - 缓存一致性
 */

class TieredCache {
  constructor(options = {}) {
    // L1: 内存缓存（快速，小容量）
    this.l1Cache = new Map();
    this.l1MaxSize = options.l1MaxSize || 100;
    this.l1TTL = options.l1TTL || 60000; // 1分钟

    // L2: 磁盘缓存（慢速，大容量）
    this.l2Cache = new Map();
    this.l2MaxSize = options.l2MaxSize || 1000;
    this.l2TTL = options.l2TTL || 3600000; // 1小时

    // 统计
    this.stats = {
      l1Hits: 0,
      l2Hits: 0,
      misses: 0,
      writes: 0,
      evictions: 0
    };

    // 淘汰策略
    this.evictionPolicy = options.evictionPolicy || 'lru';

    // 定期清理过期
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * 设置缓存
   */
  set(key, value, options = {}) {
    const { ttl = this.l1TTL, tier = 'both' } = options;

    const cacheEntry = {
      value,
      createdAt: Date.now(),
      ttl,
      accessCount: 0,
      lastAccessed: Date.now(),
      tier
    };

    // L1 缓存
    if (tier === 'both' || tier === 'l1') {
      this.evictL1IfNeeded();
      this.l1Cache.set(key, { ...cacheEntry, tier: 'l1' });
      this.stats.writes++;
    }

    // L2 缓存
    if (tier === 'both' || tier === 'l2') {
      this.evictL2IfNeeded();
      this.l2Cache.set(key, { ...cacheEntry, tier: 'l2' });
    }

    return true;
  }

  /**
   * 获取缓存
   */
  get(key) {
    // 先查 L1
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry) {
      if (this.isExpired(l1Entry)) {
        this.l1Cache.delete(key);
      } else {
        this.updateAccess(key, 'l1');
        this.stats.l1Hits++;
        return l1Entry.value;
      }
    }

    // 再查 L2
    const l2Entry = this.l2Cache.get(key);
    if (l2Entry) {
      if (this.isExpired(l2Entry)) {
        this.l2Cache.delete(key);
      } else {
        // 提升到 L1
        this.stats.l2Hits++;
        this.set(key, l2Entry.value, { tier: 'l1', ttl: l2Entry.ttl });
        return l2Entry.value;
      }
    }

    this.stats.misses++;
    return null;
  }

  /**
   * 删除缓存
   */
  delete(key) {
    const l1Deleted = this.l1Cache.delete(key);
    const l2Deleted = this.l2Cache.delete(key);
    return l1Deleted || l2Deleted;
  }

  /**
   * 检查是否存在
   */
  has(key) {
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && !this.isExpired(l1Entry)) return true;

    const l2Entry = this.l2Cache.get(key);
    if (l2Entry && !this.isExpired(l2Entry)) return true;

    return false;
  }

  /**
   * 更新访问信息
   */
  updateAccess(key, tier) {
    if (tier === 'l1') {
      const entry = this.l1Cache.get(key);
      if (entry) {
        entry.accessCount++;
        entry.lastAccessed = Date.now();
      }
    }
  }

  /**
   * 检查是否过期
   */
  isExpired(entry) {
    return Date.now() - entry.createdAt > entry.ttl;
  }

  /**
   * L1 淘汰
   */
  evictL1IfNeeded() {
    if (this.l1Cache.size >= this.l1MaxSize) {
      this.evict('l1');
    }
  }

  /**
   * L2 淘汰
   */
  evictL2IfNeeded() {
    if (this.l2Cache.size >= this.l2MaxSize) {
      this.evict('l2');
    }
  }

  /**
   * 淘汰
   */
  evict(tier) {
    const cache = tier === 'l1' ? this.l1Cache : this.l2Cache;

    let keyToEvict;
    switch (this.evictionPolicy) {
      case 'lru':
        // 最近最少使用
        keyToEvict = this.findLRU(cache);
        break;
      case 'lfu':
        // 最不经常使用
        keyToEvict = this.findLFU(cache);
        break;
      case 'fifo':
        // 先进先出
        keyToEvict = cache.keys().next().value;
        break;
      default:
        keyToEvict = cache.keys().next().value;
    }

    if (keyToEvict) {
      cache.delete(keyToEvict);
      this.stats.evictions++;
    }
  }

  /**
   * 查找 LRU
   */
  findLRU(cache) {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [key, entry] of cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldest = key;
      }
    }

    return oldest;
  }

  /**
   * 查找 LFU
   */
  findLFU(cache) {
    let leastUsed = null;
    let minCount = Infinity;

    for (const [key, entry] of cache) {
      if (entry.accessCount < minCount) {
        minCount = entry.accessCount;
        leastUsed = key;
      }
    }

    return leastUsed;
  }

  /**
   * 清理过期
   */
  cleanup() {
    let cleaned = 0;

    for (const [key, entry] of this.l1Cache) {
      if (this.isExpired(entry)) {
        this.l1Cache.delete(key);
        cleaned++;
      }
    }

    for (const [key, entry] of this.l2Cache) {
      if (this.isExpired(entry)) {
        this.l2Cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 预热缓存
   */
  async warmup(keys, fetcher) {
    const results = [];
    for (const key of keys) {
      if (!this.has(key)) {
        const value = await fetcher(key);
        if (value !== null && value !== undefined) {
          this.set(key, value);
          results.push(key);
        }
      }
    }
    return results;
  }

  /**
   * 清空缓存
   */
  clear(tier = 'both') {
    if (tier === 'both' || tier === 'l1') {
      this.l1Cache.clear();
    }
    if (tier === 'both' || tier === 'l2') {
      this.l2Cache.clear();
    }
  }

  /**
   * 获取统计
   */
  getStats() {
    const total = this.stats.l1Hits + this.stats.l2Hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.l1Hits + this.stats.l2Hits) / total * 100).toFixed(2) : 0;

    return {
      l1: {
        size: this.l1Cache.size,
        maxSize: this.l1MaxSize,
        hits: this.stats.l1Hits
      },
      l2: {
        size: this.l2Cache.size,
        maxSize: this.l2MaxSize,
        hits: this.stats.l2Hits
      },
      total,
      hitRate: `${hitRate}%`,
      misses: this.stats.misses,
      writes: this.stats.writes,
      evictions: this.stats.evictions
    };
  }

  /**
   * 获取所有键
   */
  keys(tier = 'both') {
    const keys = [];
    if (tier === 'both' || tier === 'l1') {
      for (const key of this.l1Cache.keys()) {
        keys.push(key);
      }
    }
    if (tier === 'both' || tier === 'l2') {
      for (const key of this.l2Cache.keys()) {
        if (!keys.includes(key)) {
          keys.push(key);
        }
      }
    }
    return keys;
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

module.exports = { TieredCache };