/**
 * HybridRetriever - 混合检索器
 *
 * 结合向量检索和关键词检索的优点：
 * 1. 向量检索：语义相似，发现隐含相关内容
 * 2. 关键词检索：精确匹配，专有名词/代码
 * 3. 融合排序：RRF (Reciprocal Rank Fusion)
 */

import { vectorStore } from './vector-store.js';
import { embeddingService } from './embedding-service.js';

export class HybridRetriever {
  constructor(options = {}) {
    this.vectorWeight = options.vectorWeight || 0.7;
    this.keywordWeight = options.keywordWeight || 0.3;
    this.defaultTopK = options.defaultTopK || 10;
  }

  /**
   * 混合检索
   * @param {string} query - 查询文本
   * @param {Object} options - 检索选项
   * @returns {Array} 检索结果
   */
  async search(query, options = {}) {
    const {
      topK = this.defaultTopK,
      type = null,
      userId = null,
      sessionId = null,
      threshold = 0.4,
      hybridMode = true
    } = options;

    // 1. 向量检索
    const queryEmbedding = await embeddingService.embed(query);
    const vectorResults = await vectorStore.similaritySearch(queryEmbedding, {
      topK: topK * 2,
      type,
      userId,
      sessionId,
      threshold
    });

    if (!hybridMode) {
      return vectorResults.slice(0, topK);
    }

    // 2. 关键词检索
    const keywordResults = await vectorStore.keywordSearch(query, {
      topK: topK * 2,
      type,
      userId
    });

    // 3. RRF 融合排序
    const mergedResults = this.rrfFusion(vectorResults, keywordResults, {
      vectorWeight: this.vectorWeight,
      keywordWeight: this.keywordWeight
    });

    return mergedResults.slice(0, topK);
  }

  /**
   * Reciprocal Rank Fusion (RRF) 算法
   *
   * score = sum(weight / (k + rank_i)) for each ranking list
   * k 通常为 60
   */
  rrfFusion(vectorResults, keywordResults, options = {}) {
    const { vectorWeight = 0.7, keywordWeight = 0.3, k = 60 } = options;
    const scores = new Map();

    // 处理向量检索结果
    vectorResults.forEach((result, index) => {
      const rrfScore = vectorWeight / (k + index + 1);
      const current = scores.get(result.id) || { result, score: 0 };
      current.score += rrfScore;
      current.vectorSimilarity = result.similarity;
      scores.set(result.id, current);
    });

    // 处理关键词检索结果
    keywordResults.forEach((result, index) => {
      const rrfScore = keywordWeight / (k + index + 1);
      const current = scores.get(result.id) || { result, score: 0 };
      current.score += rrfScore;
      current.keywordMatch = true;
      scores.set(result.id, current);
    });

    // 排序并返回
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map(item => ({
        ...item.result,
        rrfScore: item.score,
        vectorSimilarity: item.vectorSimilarity,
        keywordMatch: item.keywordMatch
      }));
  }

  /**
   * 带上下文的检索
   * 根据当前会话上下文调整检索策略
   */
  async searchWithContext(query, context, options = {}) {
    let enhancedQuery = query;

    if (context && context.length > 0) {
      // 取最近几条消息作为上下文
      const recentContext = context.slice(-3);
      const contextText = recentContext.map(m => m.content).join(' ');

      // 提取实体，增强查询
      const entities = this.extractEntities(contextText);
      if (entities.length > 0) {
        enhancedQuery = `${query} ${entities.join(' ')}`;
      }
    }

    return this.search(enhancedQuery, options);
  }

  /**
   * 简单的实体提取
   */
  extractEntities(text) {
    // 匹配大写开头的词、驼峰命名、下划线命名
    const patterns = [
      /\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g,  // CamelCase
      /\b[a-z]+(?:_[a-z]+)+\b/g,            // snake_case
      /\b[A-Z]{2,}\b/g                       // 全大写缩写
    ];

    const entities = new Set();
    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      matches.forEach(m => entities.add(m));
    }

    return Array.from(entities).slice(0, 3);
  }

  /**
   * 多查询检索
   * 将复杂查询分解为多个子查询
   */
  async multiQuerySearch(query, options = {}) {
    // 中文停用词
    const stopWords = new Set([
      '的', '是', '在', '了', '和', '与', '或', '有', '这', '那',
      '我', '你', '他', '她', '它', '们', '什么', '怎么', '如何'
    ]);

    // 生成多个查询变体
    const queries = [
      query,
      // 去除停用词
      query.split('').filter(c => !stopWords.has(c)).join('').trim()
    ].filter(q => q.length > 0);

    const allResults = [];
    const seen = new Set();

    for (const q of queries) {
      const results = await this.search(q, { ...options, topK: options.topK || 5 });
      for (const r of results) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allResults.push(r);
        }
      }
    }

    // 重新排序
    allResults.sort((a, b) => (b.rrfScore || b.similarity || 0) - (a.rrfScore || a.similarity || 0));
    return allResults.slice(0, options.topK || 10);
  }

  /**
   * 相似度检索（纯向量）
   */
  async similaritySearch(embedding, options = {}) {
    return vectorStore.similaritySearch(embedding, options);
  }

  /**
   * 关键词检索（纯关键词）
   */
  async keywordSearch(query, options = {}) {
    return vectorStore.keywordSearch(query, options);
  }
}

// 单例
export const hybridRetriever = new HybridRetriever();
export default hybridRetriever;
