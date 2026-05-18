import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const MEMORY_FILE = path.join(os.homedir(), '.openchat', 'memory', 'evolution-memory.json');

export class EvolutionMemory {
  constructor() {
    this.memory = new Map(); // 临时内存存储
    this._maxEntries = 1000; // 最多保留 1000 条
    this._ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 天过期
    this._ensureDir();
    this.loadFromConfig(); // 从文件加载持久化记忆
  }

  _ensureDir() {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // 保存记忆到独立文件（不再塞进 config.json）
  saveToConfig() {
    try {
      this._cleanup();
      this._ensureDir();
      const memoryArray = Array.from(this.memory.entries());
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryArray, null, 2));
    } catch (e) {
      console.log('[EvolutionMemory] 保存记忆失败:', e.message);
    }
  }

  // 从文件加载记忆
  loadFromConfig() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        const savedMemory = JSON.parse(raw);
        this.memory = new Map(savedMemory);
      }
    } catch (e) {
      console.log('[EvolutionMemory] 加载记忆失败:', e.message);
      this.memory = new Map();
    }
  }

  // 删除过期记忆 + 限制条目数
  _cleanup() {
    const now = Date.now();
    let deleted = 0;
    for (const [key, entry] of this.memory) {
      if (now - entry.timestamp > this._ttlMs) {
        this.memory.delete(key);
        deleted++;
      }
    }
    if (this.memory.size > this._maxEntries) {
      const sorted = [...this.memory.entries()].sort((a, b) => b[1].timestamp - a[1].timestamp);
      const keep = sorted.slice(0, this._maxEntries);
      this.memory = new Map(keep);
      deleted += sorted.length - keep.length;
    }
    if (deleted > 0) console.log(`[EvolutionMemory] cleaned ${deleted} expired entries`);
  }

  // 记住一条信息（scope 可选）
  remember(key, value, metadata = {}) {
    const scope = metadata.scope || '_default';
    const scopedKey = `${scope}:${key}`;
    const memoryEntry = {
      value,
      timestamp: Date.now(),
      scope,
      metadata: {
        ...metadata,
        lastUpdated: Date.now()
      }
    };

    this.memory.set(scopedKey, memoryEntry);
    this.saveToConfig();

    return true;
  }

  // 回忆信息
  recall(key) {
    const entry = this.memory.get(key);
    if (entry) {
      return entry;
    }
    return null;
  }

  // 搜索相关的记忆（options.scope 可选，只搜该 scope 内的记忆）
  search(query, options = {}) {
    const results = [];
    const queryLower = query.toLowerCase();
    const scopeFilter = options.scope ? `${options.scope}:` : null;
    
    for (const [key, entry] of this.memory) {
      // scope 过滤：指定 scope 时只搜该 scope 内
      if (scopeFilter && !key.startsWith(scopeFilter)) continue;
      // 检查键是否匹配
      if (key.toLowerCase().includes(queryLower)) {
        results.push({ key, ...entry });
        continue;
      }
      
      // 检查值是否匹配（如果是字符串）
      if (typeof entry.value === 'string' && entry.value.toLowerCase().includes(queryLower)) {
        results.push({ key, ...entry });
        continue;
      }
      
      // 检查元数据是否匹配
      if (entry.metadata && typeof entry.metadata === 'object') {
        for (const [metaKey, metaValue] of Object.entries(entry.metadata)) {
          if (metaKey.toLowerCase().includes(queryLower) || 
              (typeof metaValue === 'string' && metaValue.toLowerCase().includes(queryLower))) {
            results.push({ key, ...entry });
            break;
          }
        }
      }
    }
    
    // 根据时间戳排序（最新的在前）
    results.sort((a, b) => b.timestamp - a.timestamp);
    
    // 应用限制
    if (options.limit) {
      return results.slice(0, options.limit);
    }
    
    return results;
  }

  // 获取所有记忆的键
  getAllKeys() {
    return Array.from(this.memory.keys());
  }

  // 删除记忆
  forget(key) {
    const existed = this.memory.delete(key);
    if (existed) {
      this.saveToConfig();
    }
    return existed;
  }

  // 清空所有记忆
  clear() {
    const count = this.memory.size;
    this.memory.clear();
    this.saveToConfig();
  }

  // 获取记忆统计
  getStats() {
    return {
      totalMemories: this.memory.size,
      keys: Array.from(this.memory.keys())
    };
  }

  // 记住进度
  rememberProgress(task, status = 'in-progress', details = {}) {
    const progressKey = `progress:${task}`;
    const progressData = {
      task,
      status,
      details,
      updatedAt: Date.now()
    };

    return this.remember(progressKey, progressData, { type: 'progress', status });
  }

  // 查询进度
  getProgress(task) {
    const progressKey = `progress:${task}`;
    return this.recall(progressKey);
  }

  // 更新进度
  updateProgress(task, status, details = {}) {
    const current = this.getProgress(task);
    const mergedDetails = current ? { ...current.value.details, ...details } : details;
    
    return this.rememberProgress(task, status, mergedDetails);
  }
}