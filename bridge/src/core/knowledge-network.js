/**
 * 知识网络 - 连接真人、AI化身和所有知识源
 * 构建去中心化的知识获取和共享网络
 */

import { messageBus } from './message-bus.js';
import { EvolutionMemory } from './evolution-memory.js';
import { socialConnector } from './social-connector.js';

export class KnowledgeNetwork {
  constructor() {
    this.sources = new Map();           // 知识来源
    this.knowledgeGraph = new Map();   // 知识图谱
    this.experts = new Map();          // 专家识别
    this.topics = new Map();           // 主题分类
    this.validations = new Map();      // 知识验证
    this.evolutionMemory = new EvolutionMemory();
    
    this.stats = {
      totalKnowledge: 0,
      validatedKnowledge: 0,
      knowledgeSources: 0,
      expertCount: 0,
      topicCount: 0
    };
    
    this.init();
  }
  
  init() {
    // 监听社交网络事件，接收知识分享
    messageBus.subscribe('social:*:knowledge*', (data) => {
      this.processKnowledge(data);
    });

    // 监听进化引擎事件，整合经验
    messageBus.subscribe('evolution:experience:analyzed', (data) => {
      this.integrateExperience(data);
    });
  }
  
  /**
   * 从社交网络获取知识
   */
  async acquireKnowledgeFromSocial(humanId, knowledge) {
    // 验证知识来源
    const sourceTrust = this.assessSourceTrust(humanId);
    
    if (sourceTrust < 0.3) {
      console.warn(`[KnowledgeNetwork] 低可信度来源: ${humanId}, 信任度: ${sourceTrust}`);
      return false;
    }
    
    // 处理知识
    const processedKnowledge = await this.processRawKnowledge(knowledge, {
      source: humanId,
      sourceType: 'human',
      trust: sourceTrust,
      timestamp: Date.now()
    });
    
    // 保存到知识图谱
    this.addToKnowledgeGraph(processedKnowledge);
    
    // 更新统计
    this.stats.totalKnowledge++;
    
    console.log(`[KnowledgeNetwork] 从真人 ${humanId} 获取知识: ${knowledge.title || knowledge.summary?.substring(0, 50) || '...'}`);
    
    return true;
  }
  
  /**
   * 从AI化身获取知识
   */
  async acquireKnowledgeFromAvatar(avatarId, knowledge) {
    const avatar = socialConnector.avatars.get(avatarId);
    if (!avatar) {
      console.warn(`[KnowledgeNetwork] 未知AI化身: ${avatarId}`);
      return false;
    }
    
    // 验证来源（通过真人owner）
    const owner = socialConnector.humans.get(avatar.ownerId);
    const ownerTrust = owner ? owner.reputation / 100 : 0.5; // 默认中等信任
    
    const processedKnowledge = await this.processRawKnowledge(knowledge, {
      source: avatarId,
      sourceType: 'avatar',
      ownerTrust,
      timestamp: Date.now()
    });
    
    this.addToKnowledgeGraph(processedKnowledge);
    
    this.stats.totalKnowledge++;
    
    console.log(`[KnowledgeNetwork] 从AI化身 ${avatarId} 获取知识: ${knowledge.title || knowledge.summary?.substring(0, 50) || '...'}`);
    
    return true;
  }
  
  /**
   * 处理原始知识
   */
  async processRawKnowledge(rawKnowledge, context) {
    const processed = {
      id: `knowledge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      original: rawKnowledge,
      processed: {
        ...rawKnowledge,
        entities: this.extractEntities(rawKnowledge),
        relationships: this.extractRelationships(rawKnowledge),
        topics: this.extractTopics(rawKnowledge),
        sentiment: this.analyzeSentiment(rawKnowledge),
        credibility: this.calculateCredibility(rawKnowledge, context)
      },
      context,
      createdAt: Date.now(),
      status: 'processing',
      validationScore: 0
    };
    
    // 启动验证流程
    this.startValidationProcess(processed);
    
    return processed;
  }
  
  /**
   * 提取实体
   */
  extractEntities(content) {
    // 简化版实体提取，实际实现会使用NLP
    const text = typeof content === 'string' ? content : content.content || content.text || JSON.stringify(content);
    const entities = [];
    
    // 提取常见实体类型
    const entityPatterns = {
      person: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
      organization: /\b[A-Z][A-Z\s&]+(?:Inc\.?|Ltd\.?|Corp\.?)\b/g,
      location: /\b[A-Z][a-z]+,\s*[A-Z]{2}\b|\bChina\b|\bUS\b|\bUnited States\b/g,
      date: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g,
      amount: /\$\d+(?:,\d{3})*(?:\.\d{2})?\b/g
    };
    
    for (const [type, pattern] of Object.entries(entityPatterns)) {
      const matches = text.match(pattern) || [];
      entities.push(...matches.map(match => ({ type, value: match })));
    }
    
    return entities;
  }
  
  /**
   * 提取关系
   */
  extractRelationships(content) {
    // 简化版关系提取
    const text = typeof content === 'string' ? content : content.content || content.text || JSON.stringify(content);
    const relationships = [];
    
    // 基于关键词的关系识别
    const relationKeywords = [
      { pattern: /(\w+)\s+(?:created|developed|built)\s+(\w+)/, relation: 'created' },
      { pattern: /(\w+)\s+(?:works at|employed by)\s+(\w+)/, relation: 'works_at' },
      { pattern: /(\w+)\s+(?:located in|based in)\s+(\w+)/, relation: 'located_in' },
      { pattern: /(\w+)\s+(?:studied at|graduated from)\s+(\w+)/, relation: 'studied_at' }
    ];
    
    for (const { pattern, relation } of relationKeywords) {
      const matches = text.match(new RegExp(pattern, 'gi')) || [];
      matches.forEach(match => {
        relationships.push({
          relation,
          entities: match.split(/\s+/).filter(word => word.length > 2)
        });
      });
    }
    
    return relationships;
  }
  
  /**
   * 提取主题
   */
  extractTopics(content) {
    const text = typeof content === 'string' ? content : content.content || content.text || JSON.stringify(content);
    const topics = [];
    
    // 预定义主题词汇库
    const topicKeywords = {
      technology: ['ai', 'machine learning', 'algorithm', 'software', 'programming', 'data', 'database', 'cloud', 'blockchain', 'iot'],
      science: ['research', 'study', 'experiment', 'theory', 'hypothesis', 'quantum', 'physics', 'biology', 'chemistry'],
      business: ['market', 'profit', 'revenue', 'investment', 'startup', 'enterprise', 'strategy', 'finance', 'economy'],
      health: ['medicine', 'treatment', 'therapy', 'diagnosis', 'symptom', 'disease', 'wellness', 'nutrition'],
      education: ['learning', 'teaching', 'curriculum', 'student', 'teacher', 'school', 'university', 'course']
    };
    
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      const found = keywords.some(keyword => 
        text.toLowerCase().includes(keyword.toLowerCase())
      );
      if (found) {
        topics.push(topic);
      }
    }
    
    return topics;
  }
  
  /**
   * 情感分析
   */
  analyzeSentiment(content) {
    const text = typeof content === 'string' ? content : content.content || content.text || JSON.stringify(content);
    const positiveWords = ['good', 'great', 'excellent', 'positive', 'beneficial', 'advantageous', 'successful', 'effective'];
    const negativeWords = ['bad', 'terrible', 'awful', 'negative', 'problematic', 'challenging', 'difficult', 'failure'];
    
    const words = text.toLowerCase().split(/\s+/);
    let positiveCount = 0, negativeCount = 0;
    
    words.forEach(word => {
      if (positiveWords.includes(word)) positiveCount++;
      if (negativeWords.includes(word)) negativeCount++;
    });
    
    const total = positiveCount + negativeCount;
    if (total === 0) return 'neutral';
    
    const ratio = (positiveCount - negativeCount) / total;
    if (ratio > 0.3) return 'positive';
    if (ratio < -0.3) return 'negative';
    return 'neutral';
  }
  
  /**
   * 计算可信度
   */
  calculateCredibility(content, context) {
    let score = 0;
    
    // 来源可信度
    score += context.trust || context.ownerTrust || 0.5;
    
    // 内容质量
    if (content.facts && content.facts.length > 0) score += 0.2;
    if (content.sources && content.sources.length > 0) score += 0.15;
    if (content.references && content.references.length > 0) score += 0.1;
    if (content.evidence && content.evidence.length > 0) score += 0.15;
    
    // 长度和详细程度
    const text = typeof content === 'string' ? content : content.content || content.text || JSON.stringify(content);
    if (text.length > 500) score += 0.1;
    else if (text.length > 100) score += 0.05;
    
    return Math.min(score, 1.0);
  }
  
  /**
   * 添加到知识图谱
   */
  addToKnowledgeGraph(knowledge) {
    // 添加到图谱
    this.knowledgeGraph.set(knowledge.id, knowledge);
    
    // 按主题分类
    knowledge.processed.topics.forEach(topic => {
      if (!this.topics.has(topic)) {
        this.topics.set(topic, new Set());
      }
      this.topics.get(topic).add(knowledge.id);
    });
    
    // 按来源分类
    const sourceKey = knowledge.context.source;
    if (!this.sources.has(sourceKey)) {
      this.sources.set(sourceKey, new Set());
    }
    this.sources.get(sourceKey).add(knowledge.id);
    
    console.log(`[KnowledgeGraph] 知识已添加: ${knowledge.id}`);
  }
  
  /**
   * 开始验证流程
   */
  startValidationProcess(knowledge) {
    // 启动多轮验证
    setTimeout(async () => {
      const validationScore = await this.validateKnowledge(knowledge);
      knowledge.validationScore = validationScore;
      knowledge.status = validationScore > 0.7 ? 'verified' : 'questionable';
      
      if (validationScore > 0.7) {
        this.stats.validatedKnowledge++;
      }
      
      // 通知进化系统
      messageBus.publish('knowledge:validated', {
        knowledgeId: knowledge.id,
        score: validationScore,
        status: knowledge.status
      });
    }, 1000); // 模拟验证时间
  }
  
  /**
   * 验证知识
   */
  async validateKnowledge(knowledge) {
    // 多维度验证
    const validations = [
      this.checkSourceCredibility(knowledge),
      this.crossReference(knowledge),
      this.logicalConsistency(knowledge),
      this.temporalRelevance(knowledge)
    ];
    
    const results = await Promise.all(validations);
    const averageScore = results.reduce((sum, score) => sum + score, 0) / results.length;
    
    return averageScore;
  }
  
  /**
   * 检查来源可信度
   */
  async checkSourceCredibility(knowledge) {
    const context = knowledge.context;
    if (context.sourceType === 'human') {
      const human = socialConnector.humans.get(context.source);
      return human ? human.reputation / 100 : 0.5;
    } else if (context.sourceType === 'avatar') {
      const avatar = socialConnector.avatars.get(context.source);
      const owner = socialConnector.humans.get(avatar.ownerId);
      return owner ? owner.reputation / 100 : 0.5;
    }
    return 0.5;
  }
  
  /**
   * 交叉验证
   */
  async crossReference(knowledge) {
    // 检查是否有其他来源提到相同信息
    const similar = Array.from(this.knowledgeGraph.values()).filter(k => 
      this.isSimilar(k.processed, knowledge.processed)
    );
    
    if (similar.length > 0) {
      // 如果有多个来源提到相同信息，可信度提高
      return Math.min(0.8 + (similar.length * 0.05), 1.0);
    }
    
    // 如果没有交叉验证，可信度降低
    return knowledge.context.trust * 0.7;
  }
  
  /**
   * 逻辑一致性检查
   */
  async logicalConsistency(knowledge) {
    // 检查知识是否与已知事实冲突
    const processed = knowledge.processed;
    let consistency = 1.0;
    
    // 这里可以实现更复杂的逻辑检查
    if (processed.entities.length < 2) {
      consistency -= 0.1; // 实体太少可能不够详细
    }
    
    if (processed.sentiment === 'contradictory') {
      consistency -= 0.3; // 矛盾的情感可能表示不一致
    }
    
    return Math.max(consistency, 0.1);
  }
  
  /**
   * 时间相关性
   */
  async temporalRelevance(knowledge) {
    // 检查知识的时间相关性
    const age = Date.now() - knowledge.context.timestamp;
    const daysOld = age / (1000 * 60 * 60 * 24);
    
    // 超过一定时间的知识可信度降低
    if (daysOld > 365) return 0.6; // 一年以上
    if (daysOld > 180) return 0.8; // 半年以上
    if (daysOld > 30) return 0.9;  // 一个月以上
    return 1.0; // 最新知识
  }
  
  /**
   * 检查相似性
   */
  isSimilar(content1, content2) {
    // 简化的相似性检查
    const text1 = JSON.stringify(content1).toLowerCase();
    const text2 = JSON.stringify(content2).toLowerCase();
    
    // 检查关键词重叠
    const words1 = text1.split(/\W+/);
    const words2 = text2.split(/\W+/);
    
    const intersection = words1.filter(word => words2.includes(word)).length;
    const union = new Set([...words1, ...words2]).size;
    
    return (intersection / union) > 0.3; // 30% 重叠认为相似
  }
  
  /**
   * 评估来源信任度
   */
  assessSourceTrust(sourceId) {
    const human = socialConnector.humans.get(sourceId);
    if (human) {
      return human.reputation / 100; // 声誉值转换为0-1范围
    }
    
    const avatar = socialConnector.avatars.get(sourceId);
    if (avatar) {
      const owner = socialConnector.humans.get(avatar.ownerId);
      return owner ? owner.reputation / 100 : 0.5;
    }
    
    return 0.3; // 默认低信任
  }
  
  /**
   * 获取知识
   */
  getKnowledge(query, options = {}) {
    // 根据查询获取相关知识
    const results = [];
    
    // 按主题搜索
    if (options.topic) {
      const topicIds = this.topics.get(options.topic);
      if (topicIds) {
        for (const id of topicIds) {
          const knowledge = this.knowledgeGraph.get(id);
          if (knowledge && knowledge.status === 'verified') {
            results.push(knowledge);
          }
        }
      }
    }
    
    // 全文搜索
    if (query) {
      for (const [id, knowledge] of this.knowledgeGraph) {
        if (knowledge.status === 'verified') {
          const content = JSON.stringify(knowledge.processed).toLowerCase();
          if (content.includes(query.toLowerCase())) {
            results.push(knowledge);
          }
        }
      }
    }
    
    // 按可信度排序
    results.sort((a, b) => b.validationScore - a.validationScore);
    
    return results.slice(0, options.limit || 10);
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      knowledgeGraphSize: this.knowledgeGraph.size,
      sourceCount: this.sources.size,
      topicCount: this.topics.size
    };
  }
  
  /**
   * 积累经验
   */
  async integrateExperience(experience) {
    // 将进化引擎的经验整合到知识网络
    const knowledge = {
      id: `experience_${experience.id}`,
      type: 'experience',
      content: experience,
      source: 'evolution_engine',
      timestamp: Date.now(),
      status: 'integrated'
    };
    
    this.knowledgeGraph.set(knowledge.id, knowledge);
    this.stats.totalKnowledge++;
    
    console.log(`[KnowledgeNetwork] 集成进化经验: ${experience.task || 'unknown'}`);
  }
}

// 扩展知识网络类以支持社区功能
export class ExtendedKnowledgeNetwork extends KnowledgeNetwork {
  constructor() {
    super();
    this.communityKnowledge = new Map(); // 社区专属知识
    this.globalKnowledgePool = new Set(); // 全局知识池
  }
  
  /**
   * 添加社区
   */
  addCommunity(communityId, topic) {
    if (!this.communityKnowledge.has(communityId)) {
      this.communityKnowledge.set(communityId, {
        topic,
        knowledge: new Set(),
        contributors: new Set(),
        createdAt: Date.now()
      });
    }
  }
  
  /**
   * 从社区获取知识
   */
  acquireKnowledgeFromCommunity(communityId, knowledge, contributorId) {
    const communityData = this.communityKnowledge.get(communityId);
    if (!communityData) {
      console.warn(`[KnowledgeNetwork] 社区 ${communityId} 不存在`);
      return false;
    }
    
    // 添加到社区知识库
    communityData.knowledge.add(knowledge.id);
    communityData.contributors.add(contributorId);
    
    // 添加到全局知识池
    this.globalKnowledgePool.add(knowledge.id);
    
    // 调用父类方法处理知识
    return this.processKnowledgeFromSource(knowledge, { 
      source: contributorId, 
      community: communityId,
      type: 'community_contribution'
    });
  }
  
  /**
   * 获取社区知识
   */
  getCommunityKnowledge(communityId) {
    const communityData = this.communityKnowledge.get(communityId);
    if (!communityData) return [];
    
    return Array.from(communityData.knowledge).map(knowledgeId => 
      this.knowledgeGraph.get(knowledgeId)
    ).filter(k => k);
  }
  
  /**
   * 获取全局知识
   */
  getGlobalKnowledge(limit = 100) {
    return Array.from(this.globalKnowledgePool)
      .map(id => this.knowledgeGraph.get(id))
      .filter(k => k)
      .slice(0, limit);
  }
  
  /**
   * 从社交网络获取知识（重写）
   */
  async acquireKnowledgeFromSocial(humanId, knowledge) {
    // 调用父类方法
    const result = await super.acquireKnowledgeFromSocial(humanId, knowledge);
    
    // 同时添加到全局知识池
    if (result) {
      this.globalKnowledgePool.add(result.id || `knowledge_${Date.now()}`);
    }
    
    return result;
  }
}

// 全局实例
export const knowledgeNetwork = new ExtendedKnowledgeNetwork();