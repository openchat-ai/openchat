import logger from '../core/logger.js';
/**
 * VectorStore - 轻量级向量存储
 *
 * 使用 JSON 文件存储向量和元数据，无需外部依赖
 * 支持：
 * - 向量相似度搜索（余弦相似度）
 * - 关键词搜索（简单匹配）
 * - 混合检索
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { USER_DIR } from '../core/persistent-config.js';

const VECTOR_DIR = path.join(USER_DIR, 'vectors');
const INDEX_FILE = path.join(VECTOR_DIR, 'index.json');
const EMBEDDINGS_DIR = path.join(VECTOR_DIR, 'embeddings');

// 使用 fs.promises 异步 API
const fsPromises = fs.promises;

export class VectorStore {
  constructor() {
    this.index = new Map();  // id -> metadata
    this.cache = new Map();  // id -> { embedding, content, metadata }
    this.dimension = 1536;   // OpenAI text-embedding-3-small
    this.initialized = false;
    this._savePending = false;  // debounce 标记
    this._cacheMaxSize = 500;   // LRU 缓存最大条目
  }

  /**
   * 初始化存储
   */
  async initialize() {
    if (this.initialized) return;

    await this.ensureDirs();
    await this.loadIndex();
    this.initialized = true;
  }

  async ensureDirs() {
    for (const dir of [VECTOR_DIR, EMBEDDINGS_DIR]) {
      try {
        await fsPromises.mkdir(dir, { recursive: true });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
  }

  /**
   * 加载索引
   */
  async loadIndex() {
    try {
      const raw = await fsPromises.readFile(INDEX_FILE, 'utf8');
      const data = JSON.parse(raw);
      this.index = new Map(Object.entries(data));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        logger.warn('[VectorStore] Failed to load index:', e.message);
      }
      this.index = new Map();
    }
  }

  /**
   * 保存索引（带 debounce）
   */
  async saveIndex() {
    if (this._savePending) return;
    this._savePending = true;

    // 延迟 100ms 保存，合并多次操作
    setTimeout(async () => {
      try {
        const data = Object.fromEntries(this.index);
        await fsPromises.writeFile(INDEX_FILE, JSON.stringify(data, null, 2));
      } catch (e) {
        logger.warn('[VectorStore] Failed to save index:', e.message);
      } finally {
        this._savePending = false;
      }
    }, 100);
  }

  /**
   * LRU 缓存淘汰
   */
  _evictCache() {
    if (this.cache.size <= this._cacheMaxSize) return;
    // 删除最早的条目
    const keysToDelete = [...this.cache.keys()].slice(0, this.cache.size - this._cacheMaxSize);
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * 内容哈希
   */
  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * 添加向量
   */
  async addVector({ id, type, content, embedding, userId, sessionId, metadata = {} }) {
    const vectorId = id || `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const contentHash = this.hashContent(content);
    const now = Date.now();

    // 存储向量到 JSON 文件（异步）
    const vectorFile = path.join(EMBEDDINGS_DIR, `${vectorId}.json`);
    const vectorData = {
      id: vectorId,
      embedding,
      content,
      metadata: {
        type,
        userId,
        sessionId,
        contentHash,
        createdAt: now,
        ...metadata
      }
    };

    await fsPromises.writeFile(vectorFile, JSON.stringify(vectorData));

    // 更新索引
    this.index.set(vectorId, {
      id: vectorId,
      type,
      content,
      contentHash,
      userId,
      sessionId,
      createdAt: now,
      ...metadata
    });

    // 更新缓存并检查大小
    this.cache.set(vectorId, vectorData);
    this._evictCache();

    await this.saveIndex();

    return { id: vectorId, stored: true };
  }

  /**
   * 批量添加向量（并行）
   */
  async addBatch(vectors) {
    return Promise.all(vectors.map(v => this.addVector(v)));
  }

  /**
   * 获取向量
   */
  async getVector(id) {
    // 先查内存缓存
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }

    // 从文件加载（异步）
    const vectorFile = path.join(EMBEDDINGS_DIR, `${id}.json`);
    try {
      const raw = await fsPromises.readFile(vectorFile, 'utf8');
      const data = JSON.parse(raw);
      this.cache.set(id, data);
      this._evictCache();
      return data;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        logger.warn('[VectorStore] Failed to read vector:', e.message);
      }
      return null;
    }
  }

  /**
   * 删除向量
   */
  async deleteVector(id) {
    const vectorFile = path.join(EMBEDDINGS_DIR, `${id}.json`);
    try {
      await fsPromises.unlink(vectorFile);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    this.index.delete(id);
    this.cache.delete(id);
    await this.saveIndex();
  }

  /**
   * 余弦相似度计算
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }

  /**
   * 向量相似度搜索
   */
  async similaritySearch(queryEmbedding, options = {}) {
    const {
      topK = 10,
      type = null,
      userId = null,
      sessionId = null,
      threshold = 0.5
    } = options;

    const results = [];

    // 遍历索引
    for (const [id, meta] of this.index) {
      // 过滤条件
      if (type && meta.type !== type) continue;
      if (userId && meta.userId !== userId) continue;
      if (sessionId && meta.sessionId !== sessionId) continue;

      // 加载向量
      const vectorData = await this.getVector(id);
      if (!vectorData) continue;

      // 计算相似度
      const similarity = this.cosineSimilarity(queryEmbedding, vectorData.embedding);

      if (similarity >= threshold) {
        results.push({
          id,
          type: meta.type,
          content: vectorData.content,
          similarity,
          metadata: vectorData.metadata
        });
      }
    }

    // 按相似度排序，取 topK
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  /**
   * 关键词搜索
   */
  async keywordSearch(query, options = {}) {
    const { topK = 10, type = null, userId = null } = options;
    const results = [];
    const queryLower = query.toLowerCase();

    for (const [id, meta] of this.index) {
      // 过滤条件
      if (type && meta.type !== type) continue;
      if (userId && meta.userId !== userId) continue;

      // 简单关键词匹配
      const contentLower = meta.content.toLowerCase();
      if (contentLower.includes(queryLower)) {
        results.push({
          id,
          type: meta.type,
          content: meta.content,
          keywordMatch: true,
          metadata: meta
        });
      }
    }

    return results.slice(0, topK);
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    const byType = {};
    for (const [id, meta] of this.index) {
      const type = meta.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      totalCount: this.index.size,
      byType,
      cacheSize: this.cache.size,
      dimension: this.dimension
    };
  }

  /**
   * 清理过期数据
   */
  async cleanup(olderThanDays = 90) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const toDelete = [];

    for (const [id, meta] of this.index) {
      if (meta.createdAt && meta.createdAt < cutoff) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      await this.deleteVector(id);
    }

    logger.info(`[VectorStore] Cleaned ${toDelete.length} old vectors`);
    return toDelete.length;
  }

  /**
   * 清空所有数据
   */
  async clear() {
    // 删除所有向量文件
    if (fs.existsSync(EMBEDDINGS_DIR)) {
      const files = fs.readdirSync(EMBEDDINGS_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(EMBEDDINGS_DIR, file));
      }
    }

    // 清空索引和缓存
    this.index.clear();
    this.cache.clear();
    await this.saveIndex();
  }
}

// 单例
export const vectorStore = new VectorStore();
export default vectorStore;
