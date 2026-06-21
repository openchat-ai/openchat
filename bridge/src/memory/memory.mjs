import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { USER_DIR, persistentConfig } from '../core/persistent-config.js';

const VECTOR_DIR = path.join(USER_DIR, 'vectors');
const INDEX_FILE = path.join(VECTOR_DIR, 'index.json');
const EMBEDDINGS_DIR = path.join(VECTOR_DIR, 'embeddings');
const CACHE_DIR = path.join(USER_DIR, 'vectors', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'embedding_cache.json');

const fsPromises = fs.promises;

// === VectorStore ===
export class VectorStore {
  constructor() {
    this.index = new Map();
    this.cache = new Map();
    this.dimension = 1536;
    this.initialized = false;
    this._savePending = false;
    this._cacheMaxSize = 500;
  }

  async initialize() {
    if (this.initialized) return;
    await this.ensureDirs();
    await this.loadIndex();
    this.initialized = true;
  }

  async ensureDirs() {
    for (const dir of [VECTOR_DIR, EMBEDDINGS_DIR]) {
      try { await fsPromises.mkdir(dir, { recursive: true }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }

  async loadIndex() {
    try {
      const raw = await fsPromises.readFile(INDEX_FILE, 'utf8');
      this.index = new Map(Object.entries(JSON.parse(raw)));
    } catch (e) {
      if (e.code !== 'ENOENT') console.debug('[VectorStore] Failed to load index:', e.message);
      this.index = new Map();
    }
  }

  async saveIndex() {
    if (this._savePending) return;
    this._savePending = true;
    setTimeout(async () => {
      try { await fsPromises.writeFile(INDEX_FILE, JSON.stringify(Object.fromEntries(this.index), null, 2)); }
      catch (e) { console.debug('[VectorStore] Failed to save index:', e.message); }
      finally { this._savePending = false; }
    }, 100);
  }

  _evictCache() {
    if (this.cache.size <= this._cacheMaxSize) return;
    for (const key of [...this.cache.keys()].slice(0, this.cache.size - this._cacheMaxSize))
      this.cache.delete(key);
  }

  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  async addVector({ id, type, content, embedding, userId, sessionId, metadata = {} }) {
    const vectorId = id || `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const contentHash = this.hashContent(content);
    const now = Date.now();
    const vectorFile = path.join(EMBEDDINGS_DIR, `${vectorId}.json`);
    const vectorData = { id: vectorId, embedding, content, metadata: { type, userId, sessionId, contentHash, createdAt: now, ...metadata } };
    await fsPromises.writeFile(vectorFile, JSON.stringify(vectorData));
    this.index.set(vectorId, { id: vectorId, type, content, contentHash, userId, sessionId, createdAt: now, ...metadata });
    this.cache.set(vectorId, vectorData);
    this._evictCache();
    await this.saveIndex();
    return { id: vectorId, stored: true };
  }

  async addBatch(vectors) { return Promise.all(vectors.map(v => this.addVector(v))); }

  async getVector(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const vectorFile = path.join(EMBEDDINGS_DIR, `${id}.json`);
    try {
      const raw = await fsPromises.readFile(vectorFile, 'utf8');
      const data = JSON.parse(raw);
      this.cache.set(id, data);
      this._evictCache();
      return data;
    } catch (e) {
      if (e.code !== 'ENOENT') console.debug('[VectorStore] Failed to read vector:', e.message);
      return null;
    }
  }

  async deleteVector(id) {
    const vectorFile = path.join(EMBEDDINGS_DIR, `${id}.json`);
    try { await fsPromises.unlink(vectorFile); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.index.delete(id);
    this.cache.delete(id);
    await this.saveIndex();
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dotProduct / denom : 0;
  }

  async similaritySearch(queryEmbedding, options = {}) {
    const { topK = 10, type = null, userId = null, sessionId = null, threshold = 0.5 } = options;
    const results = [];
    for (const [id, meta] of this.index) {
      if (type && meta.type !== type) continue;
      if (userId && meta.userId !== userId) continue;
      if (sessionId && meta.sessionId !== sessionId) continue;
      const vectorData = await this.getVector(id);
      if (!vectorData) continue;
      const similarity = this.cosineSimilarity(queryEmbedding, vectorData.embedding);
      if (similarity >= threshold) results.push({ id, type: meta.type, content: vectorData.content, similarity, metadata: vectorData.metadata });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  async keywordSearch(query, options = {}) {
    const { topK = 10, type = null, userId = null } = options;
    const results = [];
    const queryLower = query.toLowerCase();
    for (const [id, meta] of this.index) {
      if (type && meta.type !== type) continue;
      if (userId && meta.userId !== userId) continue;
      if (meta.content.toLowerCase().includes(queryLower))
        results.push({ id, type: meta.type, content: meta.content, keywordMatch: true, metadata: meta });
    }
    return results.slice(0, topK);
  }

  async getStats() {
    const byType = {};
    for (const [id, meta] of this.index) {
      const type = meta.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    }
    return { totalCount: this.index.size, byType, cacheSize: this.cache.size, dimension: this.dimension };
  }

  async cleanup(olderThanDays = 90) {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const toDelete = [];
    for (const [id, meta] of this.index)
      if (meta.createdAt && meta.createdAt < cutoff) toDelete.push(id);
    for (const id of toDelete) await this.deleteVector(id);
    console.debug(`[VectorStore] Cleaned ${toDelete.length} old vectors`);
    return toDelete.length;
  }

  async clear() {
    if (fs.existsSync(EMBEDDINGS_DIR))
      for (const file of fs.readdirSync(EMBEDDINGS_DIR)) fs.unlinkSync(path.join(EMBEDDINGS_DIR, file));
    this.index.clear();
    this.cache.clear();
    await this.saveIndex();
  }
}

export const vectorStore = new VectorStore();

// === EmbeddingService ===
export class EmbeddingService {
  constructor() {
    this.cache = new Map();
    this.defaultModel = 'text-embedding-3-small';
    this.dimension = 1536;
    this.batchSize = 100;
    this.initialized = false;
    this._savePending = false;
    this._pendingRequests = new Map();
  }

  async initialize() {
    if (this.initialized) return;
    await this.loadCache();
    this.initialized = true;
  }

  async loadCache() {
    try {
      const raw = await fsPromises.readFile(CACHE_FILE, 'utf8');
      this.cache = new Map(Object.entries(JSON.parse(raw)));
    } catch (e) {
      if (e.code !== 'ENOENT') console.debug('[EmbeddingService] Cache load failed:', e.message);
      this.cache = new Map();
    }
  }

  async saveCache() {
    if (this._savePending) return;
    this._savePending = true;
    setTimeout(async () => {
      try {
        await fsPromises.mkdir(CACHE_DIR, { recursive: true });
        await fsPromises.writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(this.cache)));
      } catch (e) { console.debug('[EmbeddingService] Cache save failed:', e.message); }
      finally { this._savePending = false; }
    }, 500);
  }

  getCacheKey(text, model = this.defaultModel) {
    return crypto.createHash('sha256').update(`${model}:${text}`).digest('hex').slice(0, 32);
  }

  async embed(text, options = {}) {
    const { useCache = true, model = this.defaultModel } = options;
    const cacheKey = this.getCacheKey(text, model);
    if (useCache && this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    if (this._pendingRequests.has(cacheKey)) return this._pendingRequests.get(cacheKey);
    const promise = this._doEmbed(text, model, cacheKey, useCache);
    this._pendingRequests.set(cacheKey, promise);
    try { return await promise; }
    finally { this._pendingRequests.delete(cacheKey); }
  }

  async _doEmbed(text, model, cacheKey, useCache) {
    const embedding = await this.callEmbeddingAPI(text, model);
    if (useCache && embedding) { this.cache.set(cacheKey, embedding); this.saveCache().catch(() => {}); }
    return embedding;
  }

  async embedBatch(texts, options = {}) {
    const { useCache = true, model = this.defaultModel } = options;
    const results = new Array(texts.length);
    const uncachedTexts = [];
    const uncachedIndices = [];
    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.getCacheKey(texts[i], model);
      if (useCache && this.cache.has(cacheKey)) results[i] = this.cache.get(cacheKey);
      else { uncachedTexts.push(texts[i]); uncachedIndices.push(i); }
    }
    if (uncachedTexts.length > 0) {
      const batches = [];
      for (let i = 0; i < uncachedTexts.length; i += this.batchSize)
        batches.push({ texts: uncachedTexts.slice(i, i + this.batchSize), startIdx: i });
      const batchResults = await Promise.all(batches.map(batch => this.callEmbeddingAPIBatch(batch.texts, model)));
      let resultIdx = 0;
      for (const batchResult of batchResults) {
        for (const embedding of batchResult) {
          const idx = uncachedIndices[resultIdx];
          results[idx] = embedding;
          if (useCache && embedding) this.cache.set(this.getCacheKey(uncachedTexts[resultIdx], model), embedding);
          resultIdx++;
        }
      }
      if (useCache) this.saveCache().catch(() => {});
    }
    return results;
  }

  getEmbeddingProvider() {
    const current = persistentConfig.getPreference('currentProvider');
    if (['openrouter', 'openai'].includes(current)) return current;
    if (persistentConfig.getApiKey('openrouter')) return 'openrouter';
    if (persistentConfig.getApiKey('openai')) return 'openai';
    return current;
  }

  getEmbeddingModel(provider) {
    const modelMap = { openrouter: 'openai/text-embedding-3-small', openai: 'text-embedding-3-small', siliconflow: 'BAAI/bge-large-zh-v1.5', deepseek: null };
    return modelMap[provider] || 'text-embedding-3-small';
  }

  _embeddingConfig() {
    for (const p of ['openrouter', 'openai', this.getEmbeddingProvider()]) {
      const apiKey = persistentConfig.getApiKey(p);
      if (!apiKey) continue;
      const baseUrl = p === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
      return { apiKey, baseUrl, provider: p, model: this.getEmbeddingModel(p) };
    }
    return null;
  }

  async callEmbeddingAPI(text, model) {
    const config = this._embeddingConfig();
    if (!config) throw new Error('No API key for embedding');
    const res = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: model || config.model }),
    });
    if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
    const data = await res.json();
    return data.data?.[0]?.embedding || data.embedding?.[0] || data.data;
  }

  async callEmbeddingAPIBatch(texts, model) {
    const config = this._embeddingConfig();
    if (!config) throw new Error('No API key for embedding');
    const res = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: model || config.model }),
    });
    if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
    const data = await res.json();
    return (data.data || []).map(d => d.embedding);
  }

  getSupportedModels() {
    return [
      { id: 'text-embedding-3-small', dimension: 1536, provider: 'openai', cost: '$0.02/1M tokens' },
      { id: 'text-embedding-3-large', dimension: 3072, provider: 'openai', cost: '$0.13/1M tokens' },
      { id: 'openai/text-embedding-3-small', dimension: 1536, provider: 'openrouter' },
      { id: 'BAAI/bge-large-zh-v1.5', dimension: 1024, provider: 'siliconflow' }
    ];
  }

  clearCache() {
    this.cache.clear();
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  }

  getCacheStats() { return { size: this.cache.size, file: fs.existsSync(CACHE_FILE) }; }
}

export const embeddingService = new EmbeddingService();

// === HybridRetriever ===
export class HybridRetriever {
  constructor(options = {}) {
    this.vectorWeight = options.vectorWeight || 0.7;
    this.keywordWeight = options.keywordWeight || 0.3;
    this.defaultTopK = options.defaultTopK || 10;
  }

  async search(query, options = {}) {
    const { topK = this.defaultTopK, type = null, userId = null, sessionId = null, threshold = 0.4, hybridMode = true } = options;
    const queryEmbedding = await embeddingService.embed(query);
    const vectorResults = await vectorStore.similaritySearch(queryEmbedding, { topK: topK * 2, type, userId, sessionId, threshold });
    if (!hybridMode) return vectorResults.slice(0, topK);
    const keywordResults = await vectorStore.keywordSearch(query, { topK: topK * 2, type, userId });
    return this.rrfFusion(vectorResults, keywordResults, { vectorWeight: this.vectorWeight, keywordWeight: this.keywordWeight }).slice(0, topK);
  }

  rrfFusion(vectorResults, keywordResults, options = {}) {
    const { vectorWeight = 0.7, keywordWeight = 0.3, k = 60 } = options;
    const scores = new Map();
    vectorResults.forEach((result, index) => {
      const rrfScore = vectorWeight / (k + index + 1);
      const current = scores.get(result.id) || { result, score: 0 };
      current.score += rrfScore;
      current.vectorSimilarity = result.similarity;
      scores.set(result.id, current);
    });
    keywordResults.forEach((result, index) => {
      const rrfScore = keywordWeight / (k + index + 1);
      const current = scores.get(result.id) || { result, score: 0 };
      current.score += rrfScore;
      current.keywordMatch = true;
      scores.set(result.id, current);
    });
    return Array.from(scores.values()).sort((a, b) => b.score - a.score).map(item => ({ ...item.result, rrfScore: item.score, vectorSimilarity: item.vectorSimilarity, keywordMatch: item.keywordMatch }));
  }

  async searchWithContext(query, context, options = {}) {
    let enhancedQuery = query;
    if (context && context.length > 0) {
      const recentContext = context.slice(-3);
      const entities = this.extractEntities(recentContext.map(m => m.content).join(' '));
      if (entities.length > 0) enhancedQuery = `${query} ${entities.join(' ')}`;
    }
    return this.search(enhancedQuery, options);
  }

  extractEntities(text) {
    const patterns = [/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g, /\b[a-z]+(?:_[a-z]+)+\b/g, /\b[A-Z]{2,}\b/g];
    const entities = new Set();
    for (const pattern of patterns)
      (text.match(pattern) || []).forEach(m => entities.add(m));
    return Array.from(entities).slice(0, 3);
  }

  async multiQuerySearch(query, options = {}) {
    const stopWords = new Set(['的', '是', '在', '了', '和', '与', '或', '有', '这', '那', '我', '你', '他', '她', '它', '们', '什么', '怎么', '如何']);
    const queries = [query, query.split('').filter(c => !stopWords.has(c)).join('').trim()].filter(q => q.length > 0);
    const allResults = [];
    const seen = new Set();
    for (const q of queries)
      for (const r of await this.search(q, { ...options, topK: options.topK || 5 }))
        if (!seen.has(r.id)) { seen.add(r.id); allResults.push(r); }
    allResults.sort((a, b) => (b.rrfScore || b.similarity || 0) - (a.rrfScore || a.similarity || 0));
    return allResults.slice(0, options.topK || 10);
  }

  async similaritySearch(embedding, options = {}) { return vectorStore.similaritySearch(embedding, options); }
  async keywordSearch(query, options = {}) { return vectorStore.keywordSearch(query, options); }
}

export const hybridRetriever = new HybridRetriever();

// === MemoryManager ===
export class MemoryManager {
  constructor() {
    this.shortTerm = new Map();
    this.longTerm = new Map();
    this.skillStore = new Map();
    this.initialized = false;
    this.useRAG = true;
  }

  async initialize() {
    if (this.initialized) return;
    try { await vectorStore.initialize(); await embeddingService.initialize(); this.initialized = true; }
    catch (e) { this.useRAG = false; this.initialized = true; }
  }

  async addMessage(sessionId, role, content, metadata = {}) {
    if (!this.shortTerm.has(sessionId)) this.shortTerm.set(sessionId, []);
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message = { id: messageId, role, content, timestamp: Date.now(), ...metadata };
    const history = this.shortTerm.get(sessionId);
    history.push(message);
    if (history.length > 50) {
      const removed = history.shift();
      if (this.useRAG && this.shouldArchive(removed)) await this.archiveMessage(removed, sessionId, metadata.userId);
    }
    if (this.useRAG && this.isImportantMessage(message)) await this.indexMessage(message, sessionId, metadata.userId);
  }

  async getContext(sessionId) { return this.shortTerm.get(sessionId) || []; }
  async clearContext(sessionId) { this.shortTerm.delete(sessionId); }

  async saveFact(userId, fact, metadata = {}) {
    if (!this.longTerm.has(userId)) this.longTerm.set(userId, { profile: {}, facts: [] });
    const user = this.longTerm.get(userId);
    const factId = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const factData = { id: factId, content: fact, timestamp: Date.now(), ...metadata };
    user.facts.push(factData);
    if (this.useRAG && this.initialized) {
      try {
        const embedding = await embeddingService.embed(fact);
        await vectorStore.addVector({ id: factId, type: 'fact', content: fact, embedding, userId, metadata: { ...metadata, timestamp: factData.timestamp } });
      } catch (e) { console.debug('[MemoryManager] Failed to index fact:', e.message); }
    }
    return factId;
  }

  async queryFacts(userId, query, options = {}) {
    if (!this.useRAG || !this.initialized) {
      const user = this.longTerm.get(userId);
      if (!user) return [];
      return user.facts.filter(f => f.content.includes(query));
    }
    try {
      return await hybridRetriever.search(query, { type: 'fact', userId, topK: options.topK || 5, threshold: options.threshold || 0.5 });
    } catch (e) {
      const user = this.longTerm.get(userId);
      if (!user) return [];
      return user.facts.filter(f => f.content.includes(query));
    }
  }

  async retrieveRelevantContext(query, options = {}) {
    if (!this.useRAG || !this.initialized) return [];
    const { userId, sessionId, topK = 5 } = options;
    try {
      const results = await hybridRetriever.search(query, { type: 'message', userId, sessionId, topK, threshold: 0.5 });
      return results.map(r => ({ role: r.metadata?.role || 'user', content: r.content, similarity: r.similarity || r.rrfScore, timestamp: r.metadata?.timestamp }));
    } catch (e) { return []; }
  }

  async buildEnhancedContext(sessionId, currentQuery) {
    const shortTermContext = await this.getContext(sessionId);
    const relevantHistory = await this.retrieveRelevantContext(currentQuery, { sessionId, topK: 3 });
    return { recentMessages: shortTermContext.slice(-10), relevantHistory, hasRelevantHistory: relevantHistory.length > 0 };
  }

  isImportantMessage(message) {
    if (message.role === 'user') return true;
    return [/重要|关键|决定|决策|错误|失败|成功|完成|记住|记得/, /important|key|decision|error|fail|success|done|remember/i].some(p => p.test(message.content));
  }

  shouldArchive(message) { return message.role === 'user' || message.metadata?.important; }

  async indexMessage(message, sessionId, userId) {
    if (!this.useRAG || !this.initialized) return;
    try {
      const embedding = await Promise.race([embeddingService.embed(message.content), new Promise((_, reject) => setTimeout(() => reject(new Error('embed timeout')), 5000))]);
      await vectorStore.addVector({ id: message.id, type: 'message', content: message.content, embedding, userId, sessionId, metadata: { role: message.role, timestamp: message.timestamp } });
    } catch (e) { console.debug('[MemoryManager] Failed to index message:', e.message); }
  }

  async archiveMessage(message, sessionId, userId) {
    if (!this.useRAG || !this.initialized) return;
    try {
      const embedding = await Promise.race([embeddingService.embed(message.content), new Promise((_, reject) => setTimeout(() => reject(new Error('embed timeout')), 5000))]);
      await vectorStore.addVector({ id: `archived_${message.id}`, type: 'message', content: message.content, embedding, userId, sessionId, metadata: { role: message.role, timestamp: message.timestamp, archived: true } });
    } catch (e) { console.debug('[MemoryManager] Failed to archive message:', e.message); }
  }

  async saveSkill(name, description, sequence) {
    const skillData = { name, description, sequence, version: 1, createdAt: Date.now() };
    this.skillStore.set(name, skillData);
    if (this.useRAG && this.initialized) {
      try {
        const embedding = await embeddingService.embed(`${name}: ${description}`);
        await vectorStore.addVector({ id: `skill_${name}`, type: 'skill', content: `${name}: ${description}`, embedding, metadata: skillData });
      } catch (e) { console.debug('[MemoryManager] Failed to index skill:', e.message); }
    }
  }

  async getSkill(name) { return this.skillStore.get(name); }

  async findSkillByDescription(query) {
    if (!this.useRAG || !this.initialized) return null;
    try { const results = await hybridRetriever.search(query, { type: 'skill', topK: 3 }); return results.length > 0 ? results[0] : null; }
    catch (e) { return null; }
  }

  async getStats() {
    return {
      ragEnabled: this.useRAG, initialized: this.initialized, sessions: this.shortTerm.size,
      users: this.longTerm.size, skills: this.skillStore.size,
      vectorStore: this.useRAG ? await vectorStore.getStats() : null,
      embeddingCache: this.useRAG ? embeddingService.getCacheStats() : null
    };
  }

  async cleanup(olderThanDays = 90) { return this.useRAG ? await vectorStore.cleanup(olderThanDays) : 0; }
}

export const memoryManager = new MemoryManager();
