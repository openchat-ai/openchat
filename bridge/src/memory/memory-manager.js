/**
 * MemoryManager handles the three layers of memory:
 * 1. Short-term (Context Window) - 会话内滑动窗口
 * 2. Long-term (Knowledge/User Profile) - 持久化事实 + 向量检索
 * 3. Programmatic (Skills/Proven Paths) - 可复用技能
 *
 * RAG 增强：
 * - 重要消息自动索引到向量存储
 * - 事实存储时生成 embedding
 * - 支持语义检索相关历史
 */

import { vectorStore } from './vector-store.js';
import { embeddingService } from './embedding-service.js';
import { hybridRetriever } from './hybrid-retriever.js';

export class MemoryManager {
  constructor() {
    this.shortTerm = new Map(); // sessionId -> message[]
    this.longTerm = new Map();  // userId -> { profiles, facts }
    this.skillStore = new Map(); // skillName -> { sequence, description }
    this.initialized = false;
    this.useRAG = true; // 默认启用 RAG
  }

  /**
   * 初始化向量存储和 embedding 服务
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await vectorStore.initialize();
      await embeddingService.initialize();
      this.initialized = true;
    } catch (e) {
      this.useRAG = false;
      this.initialized = true;
    }
  }

  /**
   * Short-term memory with sliding window
   * 重要消息会自动索引到向量存储
   */
  async addMessage(sessionId, role, content, metadata = {}) {
    if (!this.shortTerm.has(sessionId)) {
      this.shortTerm.set(sessionId, []);
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const message = {
      id: messageId,
      role,
      content,
      timestamp: Date.now(),
      ...metadata
    };

    const history = this.shortTerm.get(sessionId);
    history.push(message);

    // 滑动窗口：保留最近 50 条
    if (history.length > 50) {
      const removed = history.shift();
      // 重要消息归档到向量存储
      if (this.useRAG && this.shouldArchive(removed)) {
        await this.archiveMessage(removed, sessionId, metadata.userId);
      }
    }

    // 重要消息直接索引
    if (this.useRAG && this.isImportantMessage(message)) {
      await this.indexMessage(message, sessionId, metadata.userId);
    }
  }

  /**
   * 获取会话上下文
   */
  async getContext(sessionId) {
    return this.shortTerm.get(sessionId) || [];
  }

  /**
   * 清空会话上下文
   */
  async clearContext(sessionId) {
    this.shortTerm.delete(sessionId);
  }

  /**
   * Long-term memory: 存储事实并生成向量
   */
  async saveFact(userId, fact, metadata = {}) {
    if (!this.longTerm.has(userId)) {
      this.longTerm.set(userId, { profile: {}, facts: [] });
    }

    const user = this.longTerm.get(userId);
    const factId = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const factData = {
      id: factId,
      content: fact,
      timestamp: Date.now(),
      ...metadata
    };
    user.facts.push(factData);

    // 生成向量并存储
    if (this.useRAG && this.initialized) {
      try {
        const embedding = await embeddingService.embed(fact);
        await vectorStore.addVector({
          id: factId,
          type: 'fact',
          content: fact,
          embedding,
          userId,
          metadata: { ...metadata, timestamp: factData.timestamp }
        });
      } catch (e) {
        console.warn('[MemoryManager] Failed to index fact:', e.message);
      }
    }

    console.log(`[Memory] Fact saved for user ${userId}: ${fact}`);
    return factId;
  }

  /**
   * 语义检索事实 (替代关键词搜索)
   */
  async queryFacts(userId, query, options = {}) {
    // 如果 RAG 未启用，降级到关键词搜索
    if (!this.useRAG || !this.initialized) {
      const user = this.longTerm.get(userId);
      if (!user) return [];
      return user.facts.filter(f => f.content.includes(query));
    }

    // 使用混合检索
    try {
      const results = await hybridRetriever.search(query, {
        type: 'fact',
        userId,
        topK: options.topK || 5,
        threshold: options.threshold || 0.5
      });
      return results;
    } catch (e) {
      console.warn('[MemoryManager] Query failed, fallback to keyword:', e.message);
      const user = this.longTerm.get(userId);
      if (!user) return [];
      return user.facts.filter(f => f.content.includes(query));
    }
  }

  /**
   * 检索相关历史对话
   */
  async retrieveRelevantContext(query, options = {}) {
    if (!this.useRAG || !this.initialized) {
      console.log('[MemoryManager] RAG not available, skipping retrieval');
      return [];
    }

    const { userId, sessionId, topK = 5 } = options;

    try {
      const results = await hybridRetriever.search(query, {
        type: 'message',
        userId,
        sessionId,
        topK,
        threshold: 0.5
      });

      return results.map(r => ({
        role: r.metadata?.role || 'user',
        content: r.content,
        similarity: r.similarity || r.rrfScore,
        timestamp: r.metadata?.timestamp
      }));
    } catch (e) {
      console.warn('[MemoryManager] Retrieval failed:', e.message);
      return [];
    }
  }

  /**
   * 构建增强上下文
   * 结合短期记忆和检索到的相关历史
   */
  async buildEnhancedContext(sessionId, currentQuery) {
    // 获取短期记忆
    const shortTermContext = await this.getContext(sessionId);

    // 检索相关历史
    const relevantHistory = await this.retrieveRelevantContext(currentQuery, {
      sessionId,
      topK: 3
    });

    return {
      recentMessages: shortTermContext.slice(-10),
      relevantHistory,
      hasRelevantHistory: relevantHistory.length > 0
    };
  }

  /**
   * 判断消息是否重要
   */
  isImportantMessage(message) {
    // 用户消息、决策、关键信息、错误等
    if (message.role === 'user') return true;

    const importantPatterns = [
      /重要|关键|决定|决策|错误|失败|成功|完成|记住|记得/,
      /important|key|decision|error|fail|success|done|remember/i
    ];

    return importantPatterns.some(p => p.test(message.content));
  }

  /**
   * 判断消息是否值得归档
   */
  shouldArchive(message) {
    // 用户消息或有元数据标记的消息
    return message.role === 'user' || message.metadata?.important;
  }

  /**
   * 索引消息到向量存储
   */
  async indexMessage(message, sessionId, userId) {
    if (!this.useRAG || !this.initialized) return;

    try {
      const embedding = await embeddingService.embed(message.content);
      await vectorStore.addVector({
        id: message.id,
        type: 'message',
        content: message.content,
        embedding,
        userId,
        sessionId,
        metadata: {
          role: message.role,
          timestamp: message.timestamp
        }
      });
    } catch (e) {
      console.warn('[MemoryManager] Failed to index message:', e.message);
    }
  }

  /**
   * 归档消息到长期存储
   */
  async archiveMessage(message, sessionId, userId) {
    if (!this.useRAG || !this.initialized) return;

    try {
      const embedding = await embeddingService.embed(message.content);
      await vectorStore.addVector({
        id: `archived_${message.id}`,
        type: 'message',
        content: message.content,
        embedding,
        userId,
        sessionId,
        metadata: {
          role: message.role,
          timestamp: message.timestamp,
          archived: true
        }
      });
    } catch (e) {
      console.warn('[MemoryManager] Failed to archive message:', e.message);
    }
  }

  /**
   * Programmatic Memory: Save a sequence of tools as a "Skill"
   */
  async saveSkill(name, description, sequence) {
    const skillData = {
      name,
      description,
      sequence, // Array of { tool: 'name', args: {} }
      version: 1,
      createdAt: Date.now()
    };

    this.skillStore.set(name, skillData);

    // 也索引到向量存储
    if (this.useRAG && this.initialized) {
      try {
        const embedding = await embeddingService.embed(`${name}: ${description}`);
        await vectorStore.addVector({
          id: `skill_${name}`,
          type: 'skill',
          content: `${name}: ${description}`,
          embedding,
          metadata: skillData
        });
      } catch (e) {
        console.warn('[MemoryManager] Failed to index skill:', e.message);
      }
    }

    console.log(`[Memory] New Skill stored: ${name}`);
  }

  /**
   * 获取技能
   */
  async getSkill(name) {
    return this.skillStore.get(name);
  }

  /**
   * 根据描述查找相关技能
   */
  async findSkillByDescription(query) {
    if (!this.useRAG || !this.initialized) {
      return null;
    }

    try {
      const results = await hybridRetriever.search(query, {
        type: 'skill',
        topK: 3
      });
      return results.length > 0 ? results[0] : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    const vectorStats = this.useRAG ? await vectorStore.getStats() : null;
    const cacheStats = this.useRAG ? embeddingService.getCacheStats() : null;

    return {
      ragEnabled: this.useRAG,
      initialized: this.initialized,
      sessions: this.shortTerm.size,
      users: this.longTerm.size,
      skills: this.skillStore.size,
      vectorStore: vectorStats,
      embeddingCache: cacheStats
    };
  }

  /**
   * 清理过期数据
   */
  async cleanup(olderThanDays = 90) {
    if (!this.useRAG) return 0;

    const cleaned = await vectorStore.cleanup(olderThanDays);
    return cleaned;
  }
}

// 单例
export const memoryManager = new MemoryManager();
export default memoryManager;
