/**
 * 社区管理器 - 管理AI与真人组成的社区
 * 促进知识共享和协作
 */

import { messageBus } from '../message-bus.js';
import { knowledgeNetwork } from '../memory/knowledge-network.js';
import logger from '../monitoring/logger.js';

export class CommunityManager {
  constructor() {
    this.communities = new Map();      // 所有社区
    this.communityMembers = new Map(); // 社区成员
    this.topics = new Map();          // 社区话题
    this.activities = new Map();      // 社区活动
    this.recommendations = new Map(); // 成员推荐
  }
  
  /**
   * 创建社区
   */
  createCommunity(spec) {
    const communityId = `community_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const community = {
      id: communityId,
      name: spec.name,
      description: spec.description,
      topic: spec.topic,
      createdBy: spec.createdBy,
      createdAt: Date.now(),
      members: new Set(),
      avatars: new Set(), // AI化身
      moderators: new Set([spec.createdBy]),
      isActive: true,
      memberCount: 0,
      avatarCount: 0,
      activity: 0,
      knowledgeBase: [] // 社区知识库
    };
    
    this.communities.set(communityId, community);
    this.communityMembers.set(communityId, {
      humans: new Set(),
      avatars: new Set()
    });
    
    // 创建对应的知识网络社区
    knowledgeNetwork.addCommunity(communityId, spec.topic);
    
    messageBus.publish('community:created', community);
    
    logger.info(`[CommunityManager] 社区 ${spec.name} 已创建 (ID: ${communityId})`);
    
    return communityId;
  }
  
  /**
   * 加入社区
   */
  joinCommunity(entityId, communityId, entityType = 'human') {
    const community = this.communities.get(communityId);
    if (!community) {
      throw new Error(`社区 ${communityId} 不存在`);
    }
    
    if (!community.isActive) {
      throw new Error(`社区 ${communityId} 已禁用`);
    }
    
    // 添加成员
    if (entityType === 'human') {
      community.members.add(entityId);
      community.memberCount++;
      this.communityMembers.get(communityId).humans.add(entityId);
    } else if (entityType === 'avatar') {
      community.avatars.add(entityId);
      community.avatarCount++;
      this.communityMembers.get(communityId).avatars.add(entityId);
    }
    
    // 更新话题索引
    if (!this.topics.has(community.topic)) {
      this.topics.set(community.topic, new Set());
    }
    this.topics.get(community.topic).add(communityId);
    
    messageBus.publish('community:member:joined', {
      communityId,
      entityId,
      entityType,
      memberCount: community.memberCount,
      avatarCount: community.avatarCount
    });
    
    logger.info(`[CommunityManager] ${entityType} ${entityId} 加入社区 ${community.name}`);
    
    return true;
  }
  
  /**
   * 发布到社区
   */
  publishToCommunity(communityId, message, authorId, authorType = 'human') {
    const community = this.communities.get(communityId);
    if (!community) {
      throw new Error(`社区 ${communityId} 不存在`);
    }
    
    const post = {
      id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      communityId,
      authorId,
      authorType,
      content: message,
      timestamp: Date.now(),
      likes: 0,
      shares: 0,
      replies: 0
    };
    
    // 更新社区活动
    this.updateCommunityActivity(communityId, post);
    
    // 如果是知识分享，添加到知识网络
    if (this.isKnowledgeSharing(message)) {
      const knowledge = {
        title: message.title || 'Shared Knowledge',
        content: message.content || message,
        source: { 
          type: authorType, 
          id: authorId, 
          community: communityId 
        },
        timestamp: post.timestamp
      };
      
      knowledgeNetwork.acquireKnowledgeFromSocial(authorId, knowledge);
    }
    
    messageBus.publish('community:post', post);
    
    logger.info(`[CommunityManager] 消息发布到社区 ${community.name} by ${authorType} ${authorId}`);
    
    return post.id;
  }
  
  /**
   * 更新社区活动
   */
  updateCommunityActivity(communityId, post) {
    if (!this.activities.has(communityId)) {
      this.activities.set(communityId, []);
    }
    
    const community = this.communities.get(communityId);
    community.activity++;
    
    // 保持最近活动记录
    const activityList = this.activities.get(communityId);
    activityList.push(post);
    if (activityList.length > 100) { // 只持最近100条活动
      activityList.shift();
    }
  }
  
  /**
   * 获取社区信息
   */
  getCommunityInfo(communityId) {
    const community = this.communities.get(communityId);
    if (!community) return null;
    
    return {
      ...community,
      members: Array.from(community.members),
      avatars: Array.from(community.avatars),
      activityLog: this.activities.get(communityId) || []
    };
  }
  
  /**
   * 获取话题相关的社区
   */
  getCommunitiesByTopic(topic) {
    const communityIds = this.topics.get(topic);
    if (!communityIds) return [];
    
    return Array.from(communityIds).map(id => this.communities.get(id)).filter(c => c);
  }
  
  /**
   * 获取社区成员
   */
  getCommunityMembers(communityId) {
    const members = this.communityMembers.get(communityId);
    if (!members) return { humans: [], avatars: [] };
    
    return {
      humans: Array.from(members.humans),
      avatars: Array.from(members.avatars)
    };
  }
  
  /**
   * 检查是否为知识分享
   */
  isKnowledgeSharing(message) {
    if (typeof message !== 'object') return false;
    
    // 检查是否包含知识相关的字段
    const knowledgeIndicators = [
      'knowledge', 'insight', 'learned', 'discovered', 
      'fact', 'information', 'data', 'research',
      'finding', 'concept', 'principle', 'method'
    ];
    
    const content = JSON.stringify(message).toLowerCase();
    return knowledgeIndicators.some(indicator => content.includes(indicator));
  }
  
  /**
   * 推荐社区
   */
  recommendCommunities(entityId, entityType, interests = []) {
    const recommendations = [];
    
    // 基于兴趣推荐
    for (const interest of interests) {
      const topicCommunities = this.getCommunitiesByTopic(interest);
      recommendations.push(...topicCommunities);
    }
    
    // 基于社交图谱推荐（朋友加入的社区）
    // 这里可以实现更复杂的推荐算法
    
    // 基于活跃度推荐
    recommendations.sort((a, b) => b.activity - a.activity);
    
    return recommendations.slice(0, 10); // 返回前10个推荐
  }
  
  /**
   * 获取社区统计
   */
  getStats() {
    return {
      totalCommunities: this.communities.size,
      totalMemberships: Array.from(this.communities.values()).reduce((sum, c) => sum + c.memberCount, 0),
      totalAvatars: Array.from(this.communities.values()).reduce((sum, c) => sum + c.avatarCount, 0),
      topicCount: this.topics.size
    };
  }
}

// 扩展知识网络类以支持社区功能
export class ExtendedKnowledgeNetwork extends knowledgeNetwork.constructor {
  constructor() {
    super();
    this.communityKnowledge = new Map(); // 社区专属知识
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
      logger.warn(`[KnowledgeNetwork] 社区 ${communityId} 不存在`);
      return false;
    }
    
    // 添加到社区知识库
    communityData.knowledge.add(knowledge.id);
    communityData.contributors.add(contributorId);
    
    // 调用父类方法处理知识
    return this.addKnowledge(knowledge, { 
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
}