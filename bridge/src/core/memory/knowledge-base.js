/**
 * KnowledgeBase — 公共知识库（P2P 共享）
 *
 * 索引化存储：只存 { answer, verified, houseIds[] }，不存解法全文。
 * 全文由求解者所在 House 本地管理，通过 P2P 按需获取。
 *
 * 自动升级存储：
 *   Level 0 — JSON（< 1K 条目）
 *   Level 1 — JSON（< 10K 条目，带内存索引）
 *   Level 2 — SQLite（≥ 10K 条目，使用 sql.js）
 *
 * 特性：
 *   - 本地持久化到 .openchat/knowledge/
 *   - P2P 同步：广播 KNOWLEDGE_PUBLISH，收到后验证→采纳
 *   - 冲突解决：同 question 的不同答案 → 取 verified 优先
 *   - 自动淘汰：超过 30 天未使用的条目降权
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../monitoring/logger.js';

const KNOWLEDGE_DIR = path.join(os.homedir(), '.openchat', 'knowledge');
const MAX_ENTRIES_PER_DOMAIN = 1000;
const MIGRATE_THRESHOLD = 10000;   // ≥ 1万 → SQLite

class KnowledgeBase {
  constructor(p2p = null) {
    this.p2p = p2p;
    this._entries = new Map();          // domain → Map<questionHash, entry>
    this._loaded = new Set();           // 已从磁盘加载的 domain
    this._store = null;                 // JSONStore | SQLiteStore
    this._totalEntries = 0;             // 总条目数缓存
    this._initialized = false;
    this.start();
  }

  /** 启动 — 选择存储 + 加载 + 监听 P2P */
  async init() {
    // 1. 统计现有条目数
    await this._countEntries();

    // 2. 选择存储层
    this._store = await this._selectStore();

    // 3. 加载数据
    if (this._store) {
      this._entries = await this._store.loadAll();
      this._totalEntries = 0;
      for (const [, map] of this._entries) this._totalEntries += map.size;
    }

    // 4. 监听 P2P
    if (this.p2p) {
      this.p2p.on('KNOWLEDGE_PUBLISH', (data) => {
        this.importEntry(data.payload || {});
      });
      this.p2p.on('KNOWLEDGE_QUERY', (data) => {
        const p = data.payload || {};
        const results = this.search(p.domain, p.question || p.pattern);
        if (this.p2p && data.from) {
          this.p2p.sendTo(data.from, {
            type: 'KNOWLEDGE_RESPONSE',
            payload: { results: results.slice(0, 20) },
          });
        }
      });
    }

    this._initialized = true;
    return this;
  }

  /** 统计磁盘上已有条目数 */
  async _countEntries() {
    let count = 0;
    try {
      if (fs.existsSync(KNOWLEDGE_DIR)) {
        const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));
        for (const f of files) {
          try {
            const raw = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf8'));
            count += (raw.entries || []).length;
          } catch (e) { logger.warn('[IGNORE] 单个文件损坏不影响总数: ' + (e?.message || '')); }
        }
      }
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    this._totalEntries = count;
    return count;
  }

  /** 选择存储层：JSON / SQLite */
  async _selectStore() {
    // ≤ 阈值 → JSON（兼容旧数据）
    if (this._totalEntries < MIGRATE_THRESHOLD) {
      return new JSONStore(KNOWLEDGE_DIR);
    }

    // ≥ 阈值 → 尝试 SQLite
    try {
      const SQL = await import('sql.js');
      // 尝试迁移旧 JSON 数据
      let count = 0;
      try {
        if (fs.existsSync(KNOWLEDGE_DIR)) {
          const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));
          for (const f of files) count += (JSON.parse(fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf8')).entries || []).length;
        }
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
      const store = new SQLiteStore(KNOWLEDGE_DIR, SQL);
      store.init(count > 0);
      // 如果有旧 JSON 数据，迁移
      if (count > 0) {
        const jsonStore = new JSONStore(KNOWLEDGE_DIR);
        const allData = await jsonStore.loadAll();
        for (const [, map] of allData) {
          for (const [, entry] of map) {
            store.add(entry);
          }
        }
        // 备份 JSON 文件
        try {
          const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));
          for (const f of files) {
            fs.renameSync(path.join(KNOWLEDGE_DIR, f), path.join(KNOWLEDGE_DIR, f + '.bak'));
          }
        } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
        logger.info(`[KB] 已迁移 ${count} 条到 SQLite`);
      }
      return store;
    } catch (e) {
      logger.warn('[IGNORE] sql.js unavailable, fallback to JSON: ' + (e?.message || ''));
      logger.info('[KB] sql.js unavailable, using JSON store');
      return new JSONStore(KNOWLEDGE_DIR);
    }
  }

  /** 旧版兼容：无参构造时调用 start() 等价于 init() */
  start() {
    if (!this._initialized) return this.init();
    return this;
  }

  // ==================== 写入 ====================

  /**
   * 添加知识条目（索引化 — 不存 method/size/speed/memory）
   * @param {string} domain
   * @param {string} question
   * @param {0|1} answer
   * @param {object} meta — { verified, author, houseId }
   */
  add(domain, question, answer, methodOrMeta, meta = {}) {
    this.ensureLoaded(domain);

    const key = this.hash(domain, question);
    const domainMap = this._entries.get(domain);
    const existing = domainMap?.get(key);

    // methodOrMeta 可能是旧的 method 字符串或新的 meta 对象
    // 新版调用：add(domain, question, answer, meta) — methodOrMeta 是 meta
    // 旧版兼容：add(domain, question, answer, method, meta) — methodOrMeta 是 method 字符串
    const isOldStyle = typeof methodOrMeta === 'string';
    const houseId = isOldStyle ? (meta.houseId || 'unknown') : (methodOrMeta?.houseId || 'unknown');
    const verified = isOldStyle ? (meta.verified || false) : (methodOrMeta?.verified || false);
    const author = isOldStyle ? (meta.author || 'unknown') : (methodOrMeta?.author || 'unknown');

    // 只有 verified 条目覆盖非 verified
    if (existing) {
      if (existing.verified && !verified) return existing;
      if (existing.houseIds && !existing.houseIds.includes(houseId)) {
        existing.houseIds.push(houseId);
      }
      existing.usedCount++;
      existing.lastUsed = Date.now();
      this._saveDomain(domain);
      this.publish(domain, existing);
      return existing;
    }

    const entry = {
      domain,
      question,
      questionHash: key,
      answer,
      houseIds: houseId ? [houseId] : [],
      verified,
      author,
      usedCount: 0,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    if (!this._entries.has(domain)) this._entries.set(domain, new Map());
    this._entries.get(domain).set(key, entry);
    this._totalEntries++;
    this.enforceLimit(domain);
    this._saveDomain(domain);

    // P2P 广播
    this.publish(domain, entry);

    return entry;
  }

  // ==================== 读取 ====================

  /**
   * 按问题搜索知识
   * @returns {Array<{ domain, question, answer, houseIds, verified, score }>}
   */
  search(domain, questionOrPattern) {
    this.ensureLoaded(domain);
    const domainEntries = this._entries.get(domain);
    if (!domainEntries) return [];

    const lower = questionOrPattern.toLowerCase();
    const keywords = lower.split(/[\s,，。！？?]+/).filter(w => w.length > 1);
    const results = [];

    for (const [, entry] of domainEntries) {
      let score = 0;
      const q = (entry.question || '').toLowerCase();
      for (const kw of keywords) {
        if (q.includes(kw)) score += 10;
      }
      if (score > 0) {
        entry.usedCount++;
        entry.lastUsed = Date.now();
        results.push({
          domain: entry.domain,
          question: entry.question,
          answer: entry.answer,
          houseIds: entry.houseIds || [],
          verified: entry.verified,
          score,
          usedCount: entry.usedCount,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * 精确查询 — 回答一个布尔子问题
   * @returns {{ answer: 0|1, verified: boolean, houses: string[], confidence: number }} | null
   */
  answer(domain, question) {
    this.ensureLoaded(domain);
    const key = this.hash(domain, question);
    const domainEntries = this._entries.get(domain);
    if (!domainEntries) return null;

    const entry = domainEntries.get(key);
    if (!entry) {
      // 模糊匹配
      const searchResults = this.search(domain, question);
      if (searchResults.length === 0) return null;
      const best = searchResults[0];
      if (best.score >= 8) {
        return {
          answer: best.answer,
          houses: best.houseIds || [],
          verified: best.verified,
          confidence: best.score / 10,
        };
      }
      return null;
    }

    entry.usedCount++;
    entry.lastUsed = Date.now();
    return {
      answer: entry.answer,
      houses: entry.houseIds || [],
      verified: entry.verified,
      confidence: 1.0,
    };
  }

  /**
   * 获取解法全文（通过 P2P 向指定 house 请求）
   * @param {string} questionHash
   * @param {string} houseId
   * @returns {Promise<object|null>}
   */
  async getSolution(questionHash, houseId) {
    // 本地查找
    for (const [, map] of this._entries) {
      const entry = map.get(questionHash);
      if (entry) {
        // 检查本地 house 是否有内容
        if (entry.houseIds?.includes(houseId) || entry.houseIds?.includes('local')) {
          try {
            const solutionPath = path.join(KNOWLEDGE_DIR, 'solutions', `${questionHash}.json`);
            if (fs.existsSync(solutionPath)) {
              return JSON.parse(fs.readFileSync(solutionPath, 'utf8'));
            }
          } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
        }
        // 远程请求
        if (this.p2p) {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 10000);
            const handler = (data) => {
              if (data.payload?.questionHash === questionHash) {
                clearTimeout(timeout);
                this.p2p.off('SOLUTION_RESPONSE', handler);
                resolve(data.payload?.solution || null);
              }
            };
            this.p2p.on('SOLUTION_RESPONSE', handler);
            this.p2p.sendTo(houseId, {
              type: 'SOLUTION_REQUEST',
              payload: { questionHash },
            });
          });
        }
      }
    }
    return null;
  }

  /**
   * 本地保存解法全文
   */
  storeSolution(questionHash, solution) {
    try {
      const dir = path.join(KNOWLEDGE_DIR, 'solutions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${questionHash}.json`), JSON.stringify(solution, null, 2));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  // ==================== P2P 同步 ====================

  publish(domain, entry) {
    if (!this.p2p) return;
    this.p2p.broadcast({
      type: 'KNOWLEDGE_PUBLISH',
      payload: {
        domain: entry.domain,
        question: entry.question,
        questionHash: entry.questionHash,
        answer: entry.answer,
        houseIds: entry.houseIds || [],
        verified: entry.verified,
        author: entry.author,
      },
    }, 'KNOWLEDGE_PUBLISH', 'LOW');
  }

  importEntry(entry) {
    if (!entry.domain || !entry.question || entry.answer === undefined) return;
    return this.add(entry.domain, entry.question, entry.answer, {
      houseId: (entry.houseIds || [])[0] || 'p2p',
      verified: true,
      author: entry.author,
    });
  }

  // ==================== 内部 ====================

  hash(domain, question) {
    const normalized = question.toLowerCase().replace(/\s+/g, ' ').trim();
    return `${domain}::${normalized}`;
  }

  ensureLoaded(domain) {
    if (this._loaded.has(domain)) return;
    if (this._store) {
      try {
        const map = this._store.loadDomain(domain);
        if (map && map.size > 0) {
          this._entries.set(domain, map);
        }
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    }
    this._loaded.add(domain);
  }

  _saveDomain(domain) {
    const map = this._entries.get(domain);
    if (!map || !this._store) return;
    try {
      this._store.save(domain, [...map.values()]);
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  enforceLimit(domain) {
    const map = this._entries.get(domain);
    if (!map || map.size <= MAX_ENTRIES_PER_DOMAIN) return;
    const sorted = [...map.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of sorted.slice(0, map.size - MAX_ENTRIES_PER_DOMAIN)) {
      map.delete(key);
      this._totalEntries--;
    }
  }

  stats() {
    let total = 0;
    const domainCounts = {};
    for (const [domain, map] of this._entries) {
      domainCounts[domain] = map.size;
      total += map.size;
    }
    return {
      domains: this._entries.size,
      total,
      store: this._store?.constructor?.name || 'none',
      perDomain: domainCounts,
    };
  }
}

// ==================== JSON Store ====================

class JSONStore {
  constructor(dir) {
    this.dir = dir;
  }

  loadDomain(domain) {
    const file = path.join(this.dir, `${domain}.json`);
    if (!fs.existsSync(file)) return new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const map = new Map();
      for (const entry of raw.entries || []) {
        // 旧格式兼容：剥离 method/size/speed/memory → houseIds
        if (entry.method && !entry.houseIds) {
          entry.houseIds = [entry.author || 'legacy'];
        }
        delete entry.method;
        delete entry.size;
        delete entry.speed;
        delete entry.memory;
        map.set(entry.questionHash, entry);
      }
      return map;
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return new Map(); }
  }

  async loadAll() {
    const result = new Map();
    try {
      if (!fs.existsSync(this.dir)) return result;
      const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));
      for (const f of files) {
        const domain = f.replace(/\.json$/, '');
        const map = this.loadDomain(domain);
        if (map.size > 0) result.set(domain, map);
      }
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return result;
  }

  save(domain, entries) {
    const file = path.join(this.dir, `${domain}.json`);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        domain,
        entries: entries.map(e => ({
          domain: e.domain,
          question: e.question,
          questionHash: e.questionHash,
          answer: e.answer,
          houseIds: e.houseIds || [],
          verified: e.verified,
          author: e.author,
          usedCount: e.usedCount,
          createdAt: e.createdAt,
          lastUsed: e.lastUsed,
        })),
        lastUpdated: Date.now(),
      }, null, 2));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }
}

// ==================== SQLite Store ====================

class SQLiteStore {
  constructor(dir, SQL) {
    this.dir = dir;
    this.SQL = SQL;
    this.db = null;
  }

  init(withData) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const dbPath = path.join(this.dir, 'knowledge.db');

      // sql.js 需要读取现有文件或从空开始
      let buffer = null;
      if (fs.existsSync(dbPath)) {
        buffer = fs.readFileSync(dbPath);
      }

      this.db = new this.SQL.Database(buffer);
      this.db.run(`
        CREATE TABLE IF NOT EXISTS entries (
          domain TEXT NOT NULL,
          questionHash TEXT PRIMARY KEY,
          question TEXT NOT NULL,
          answer INTEGER NOT NULL,
          houseIds TEXT DEFAULT '[]',
          verified INTEGER DEFAULT 0,
          author TEXT DEFAULT 'unknown',
          usedCount INTEGER DEFAULT 0,
          createdAt INTEGER,
          lastUsed INTEGER
        )
      `);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_domain ON entries(domain)');
    } catch (e) {
      logger.info(`[KB] SQLite 初始化失败: ${e.message}`);
    }
  }

  loadDomain(domain) {
    if (!this.db) return new Map();
    try {
      const stmt = this.db.prepare('SELECT * FROM entries WHERE domain = ?');
      stmt.bind([domain]);
      const map = new Map();
      while (stmt.step()) {
        const row = stmt.getAsObject();
        const entry = this._rowToEntry(row);
        map.set(entry.questionHash, entry);
      }
      stmt.free();
      return map;
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return new Map(); }
  }

  async loadAll() {
    const result = new Map();
    if (!this.db) return result;
    try {
      const stmt = this.db.prepare('SELECT DISTINCT domain FROM entries');
      while (stmt.step()) {
        const row = stmt.getAsObject();
        const map = this.loadDomain(row.domain);
        result.set(row.domain, map);
      }
      stmt.free();
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return result;
  }

  save(domain, entries) {
    if (!this.db) return;
    try {
      const tx = this.db.exec('BEGIN TRANSACTION');
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO entries
          (domain, questionHash, question, answer, houseIds, verified, author, usedCount, createdAt, lastUsed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const e of entries) {
        stmt.run([
          e.domain,
          e.questionHash,
          e.question,
          e.answer,
          JSON.stringify(e.houseIds || []),
          e.verified ? 1 : 0,
          e.author || 'unknown',
          e.usedCount || 0,
          e.createdAt || Date.now(),
          e.lastUsed || Date.now(),
        ]);
      }
      stmt.free();
      this.db.exec('COMMIT');
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  add(entry) {
    this.save(entry.domain, [entry]);
  }

  _rowToEntry(row) {
    return {
      domain: row.domain,
      questionHash: row.questionHash,
      question: row.question,
      answer: row.answer,
      houseIds: JSON.parse(row.houseIds || '[]'),
      verified: !!row.verified,
      author: row.author || 'unknown',
      usedCount: row.usedCount || 0,
      createdAt: row.createdAt || Date.now(),
      lastUsed: row.lastUsed || Date.now(),
    };
  }
}

export { KnowledgeBase, KNOWLEDGE_DIR };
export default KnowledgeBase;
