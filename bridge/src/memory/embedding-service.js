/**
 * EmbeddingService - Embedding API 封装
 *
 * 复用用户已配置的 Provider（OpenRouter/OpenAI）调用 Embedding API
 * 支持缓存，避免重复调用
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { USER_DIR } from '../core/persistent-config.js';
import { persistentConfig } from '../core/persistent-config.js';
import { providerManager } from 'provider-kit';

const CACHE_DIR = path.join(USER_DIR, 'vectors', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'embedding_cache.json');

// 使用 fs.promises 异步 API
const fsPromises = fs.promises;

export class EmbeddingService {
  constructor() {
    this.cache = new Map();
    this.defaultModel = 'text-embedding-3-small';
    this.dimension = 1536;
    this.batchSize = 100;
    this.initialized = false;
    this._savePending = false;  // debounce 标记
    this._pendingRequests = new Map();  // 请求去重
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) return;

    await this.loadCache();
    this.initialized = true;
  }

  /**
   * 加载缓存
   */
  async loadCache() {
    try {
      const raw = await fsPromises.readFile(CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);
      this.cache = new Map(Object.entries(data));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn('[EmbeddingService] Cache load failed:', e.message);
      }
      this.cache = new Map();
    }
  }

  /**
   * 保存缓存（带 debounce）
   */
  async saveCache() {
    if (this._savePending) return;
    this._savePending = true;

    // 延迟 500ms 保存，合并多次操作
    setTimeout(async () => {
      try {
        await fsPromises.mkdir(CACHE_DIR, { recursive: true });
        const data = Object.fromEntries(this.cache);
        await fsPromises.writeFile(CACHE_FILE, JSON.stringify(data));
      } catch (e) {
        console.warn('[EmbeddingService] Cache save failed:', e.message);
      } finally {
        this._savePending = false;
      }
    }, 500);
  }

  /**
   * 生成缓存键
   */
  getCacheKey(text, model = this.defaultModel) {
    return crypto.createHash('sha256')
      .update(`${model}:${text}`)
      .digest('hex')
      .slice(0, 32);
  }

  /**
   * 单个文本 embedding（带请求去重）
   */
  async embed(text, options = {}) {
    const { useCache = true, model = this.defaultModel } = options;

    // 检查缓存
    const cacheKey = this.getCacheKey(text, model);
    if (useCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // 请求去重：相同文本等待同一 Promise
    if (this._pendingRequests.has(cacheKey)) {
      return this._pendingRequests.get(cacheKey);
    }

    // 创建请求 Promise
    const promise = this._doEmbed(text, model, cacheKey, useCache);
    this._pendingRequests.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      this._pendingRequests.delete(cacheKey);
    }
  }

  async _doEmbed(text, model, cacheKey, useCache) {
    const embedding = await this.callEmbeddingAPI(text, model);

    if (useCache && embedding) {
      this.cache.set(cacheKey, embedding);
      this.saveCache().catch(() => {});
    }

    return embedding;
  }

  /**
   * 批量 embedding
   */
  async embedBatch(texts, options = {}) {
    const { useCache = true, model = this.defaultModel } = options;
    const results = new Array(texts.length);
    const uncachedTexts = [];
    const uncachedIndices = [];

    // 检查缓存
    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.getCacheKey(texts[i], model);
      if (useCache && this.cache.has(cacheKey)) {
        results[i] = this.cache.get(cacheKey);
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }

    // 并行批量调用 API
    if (uncachedTexts.length > 0) {
      // 分批并并行处理
      const batches = [];
      for (let i = 0; i < uncachedTexts.length; i += this.batchSize) {
        batches.push({
          texts: uncachedTexts.slice(i, i + this.batchSize),
          startIdx: i
        });
      }

      // 并行发送所有批次
      const batchResults = await Promise.all(
        batches.map(batch => this.callEmbeddingAPIBatch(batch.texts, model))
      );

      // 合并结果
      let resultIdx = 0;
      for (const batchResult of batchResults) {
        for (const embedding of batchResult) {
          const idx = uncachedIndices[resultIdx];
          results[idx] = embedding;

          if (useCache && embedding) {
            const cacheKey = this.getCacheKey(uncachedTexts[resultIdx], model);
            this.cache.set(cacheKey, embedding);
          }
          resultIdx++;
        }
      }

      if (useCache) {
        this.saveCache().catch(() => {});
      }
    }

    return results;
  }

  /**
   * 获取 Embedding Provider
   */
  getEmbeddingProvider() {
    const current = persistentConfig.getPreference('currentProvider');

    // OpenRouter 和 OpenAI 直接支持 embedding
    if (['openrouter', 'openai'].includes(current)) {
      return current;
    }

    // 其他 provider 回退到 openai 或 openrouter
    if (persistentConfig.getApiKey('openrouter')) {
      return 'openrouter';
    }
    if (persistentConfig.getApiKey('openai')) {
      return 'openai';
    }

    return current;
  }

  /**
   * 获取 Embedding 模型
   */
  getEmbeddingModel(provider) {
    const modelMap = {
      openrouter: 'openai/text-embedding-3-small',
      openai: 'text-embedding-3-small',
      siliconflow: 'BAAI/bge-large-zh-v1.5',
      deepseek: null,  // DeepSeek 暂不支持 embedding
    };

    return modelMap[provider] || 'text-embedding-3-small';
  }

  /**
   * 获取 API 配置
   */
  getApiConfig(provider) {
    const apiKey = persistentConfig.getApiKey(provider);
    if (!apiKey) {
      return null;
    }

    const providerConfig = providerManager.getProvider(provider);

    // 不同 provider 的 endpoint
    const endpointMap = {
      openrouter: 'https://openrouter.ai/api/v1',
      openai: 'https://api.openai.com/v1',
      siliconflow: 'https://api.siliconflow.cn/v1',
    };

    return {
      apiKey,
      baseUrl: endpointMap[provider] || providerConfig?.baseUrl || 'https://api.openai.com/v1',
      model: this.getEmbeddingModel(provider)
    };
  }

  /**
   * 调用 Embedding API
   */
  async callEmbeddingAPI(text, model) {
    const provider = this.getEmbeddingProvider();
    const config = this.getApiConfig(provider);

    if (!config) {
      throw new Error(`No API key configured for embedding. Run: connect ${provider}`);
    }

    const { apiKey, baseUrl } = config;
    const embeddingModel = model || config.model;

    // OpenAI 兼容 API
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: text
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }

  /**
   * 批量调用 Embedding API
   */
  async callEmbeddingAPIBatch(texts, model) {
    const provider = this.getEmbeddingProvider();
    const config = this.getApiConfig(provider);

    if (!config) {
      throw new Error(`No API key configured for embedding. Run: connect ${provider}`);
    }

    const { apiKey, baseUrl } = config;
    const embeddingModel = model || config.model;

    const allResults = [];

    // 分批处理
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: embeddingModel,
          input: batch
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `Embedding API error: ${response.status}`);
      }

      const data = await response.json();
      // 按 index 排序
      const sorted = data.data.sort((a, b) => a.index - b.index);
      allResults.push(...sorted.map(d => d.embedding));
    }

    return allResults;
  }

  /**
   * 获取支持的模型列表
   */
  getSupportedModels() {
    return [
      { id: 'text-embedding-3-small', dimension: 1536, provider: 'openai', cost: '$0.02/1M tokens' },
      { id: 'text-embedding-3-large', dimension: 3072, provider: 'openai', cost: '$0.13/1M tokens' },
      { id: 'openai/text-embedding-3-small', dimension: 1536, provider: 'openrouter' },
      { id: 'BAAI/bge-large-zh-v1.5', dimension: 1024, provider: 'siliconflow' }
    ];
  }

  /**
   * 清理缓存
   */
  clearCache() {
    this.cache.clear();
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
    console.log('[EmbeddingService] Cache cleared');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      file: fs.existsSync(CACHE_FILE)
    };
  }
}

// 单例
export const embeddingService = new EmbeddingService();
export default embeddingService;
