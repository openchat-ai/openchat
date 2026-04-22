/**
 * 社交连接器 - 连接无数真人与AI化身的桥梁
 * 支持大规模分布式社交网络
 */

import { messageBus } from './message-bus.js';
import { persistentConfig } from '../core/persistent-config.js';
import { EvolutionMemory } from './evolution-memory.js';

export class SocialConnector {
  constructor(options = {}) {
    this.options = {
      maxConnections: options.maxConnections || 10000,  // 支持万级连接
      connectionTimeout: options.connectionTimeout || 30000,
      heartbeatInterval: options.heartbeatInterval || 30000,
      messageBufferSize: options.messageBufferSize || 10000,
      ...options
    };
    
    this.connections = new Map();           // 连接池
    this.humans = new Map();               // 真人标识
    this.avatars = new Map();              // AI化身管理
    this.communities = new Map();          // 社区管理
    this.messageRouter = new MessageRouter();
    this.evolutionMemory = new EvolutionMemory();
    
    this.stats = {
      totalHumans: 0,
      totalAvatars: 0,
      totalCommunities: 0,
      messagesProcessed: 0,
      knowledgeAcquired: 0
    };
    
    this.init();
  }
  
  init() {
    // 初始化社交网络事件监听
    messageBus.subscribe('social:*', (data) => {
      this.handleSocialEvent(data);
    });

    // 启动心跳检测
    this.startHeartbeat();
  }
  
  /**
   * 连接真人
   */
  connectHuman(humanId, connection) {
    if (this.connections.size >= this.options.maxConnections) {
      throw new Error('连接数已达上限');
    }
    
    this.connections.set(humanId, {
      id: humanId,
      type: 'human',
      connection,
      joinedAt: Date.now(),
      avatars: new Set(),  // 该真人创建的AI化身
      communities: new Set(), // 加入的社区
      lastActive: Date.now()
    });
    
    this.humans.set(humanId, {
      id: humanId,
      profile: null,
      reputation: 100,  // 声誉值
      knowledgeContribution: 0,
      avatarCount: 0
    });
    
    this.stats.totalHumans++;
    
    messageBus.publish('social:human:connected', { humanId });
    
    console.log(`[SocialConnector] 真人 ${humanId} 已连接 - 累计 ${this.stats.totalHumans} 人`);
    
    return true;
  }
  
  /**
   * 创建AI化身
   */
  createAvatar(humanId, avatarSpec) {
    const human = this.humans.get(humanId);
    if (!human) {
      throw new Error(`真人 ${humanId} 不存在`);
    }
    
    const avatarId = `${humanId}:avatar:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.connections.set(avatarId, {
      id: avatarId,
      type: 'avatar',
      ownerId: humanId,
      spec: avatarSpec,
      connection: null,  // 可能是虚拟连接
      joinedAt: Date.now(),
      capabilities: avatarSpec.capabilities || [],
      personality: avatarSpec.personality || {},
      lastActive: Date.now()
    });
    
    this.avatars.set(avatarId, {
      id: avatarId,
      ownerId: humanId,
      type: avatarSpec.type || 'general',
      purpose: avatarSpec.purpose || 'companion',
      intelligence: avatarSpec.intelligence || 'medium',
      knowledgeDomain: avatarSpec.knowledgeDomain || 'general',
      interactionCount: 0
    });
    
    // 将化身关联到真人
    const humanConn = this.connections.get(humanId);
    humanConn.avatars.add(avatarId);
    human.avatarCount++;
    
    this.stats.totalAvatars++;
    
    messageBus.publish('social:avatar:created', { 
      avatarId, 
      ownerId: humanId, 
      spec: avatarSpec 
    });
    
    console.log(`[SocialConnector] AI化身 ${avatarId} 已创建 - 真人${humanId}的第${human.avatarCount}个化身`);
    
    return avatarId;
  }
  
  /**
   * 创建社区/知识圈
   */
  createCommunity(communitySpec) {
    const communityId = `community:${Date.now()}-${communitySpec.name}`;
    
    this.communities.set(communityId, {
      id: communityId,
      name: communitySpec.name,
      topic: communitySpec.topic,
      description: communitySpec.description,
      members: new Set(),
      avatarMembers: new Set(),
      moderators: new Set(),
      createdAt: Date.now(),
      memberCount: 0,
      avatarCount: 0,
      knowledgeBase: new Set(),  // 知识库
      activityLevel: 'low'       // 活跃度
    });
    
    this.stats.totalCommunities++;
    
    messageBus.publish('social:community:created', { 
      communityId, 
      spec: communitySpec 
    });
    
    console.log(`[SocialConnector] 社区 ${communitySpec.name} 已创建 - 累计 ${this.stats.totalCommunities} 个社区`);
    
    return communityId;
  }
  
  /**
   * 加入社区
   */
  joinCommunity(entityId, communityId) {
    const entity = this.connections.get(entityId);
    const community = this.communities.get(communityId);
    
    if (!entity || !community) {
      throw new Error(`实体或社区不存在: ${entityId}, ${communityId}`);
    }
    
    if (entity.type === 'human') {
      community.members.add(entityId);
      community.memberCount++;
    } else if (entity.type === 'avatar') {
      community.avatarMembers.add(entityId);
      community.avatarCount++;
    }
    
    // 将社区关联到实体
    if (!entity.communities) {
      entity.communities = new Set();
    }
    entity.communities.add(communityId);
    
    // 社区活跃度计算
    this.calculateCommunityActivity(community);
    
    messageBus.publish('social:joined:community', { 
      entityId, 
      communityId,
      type: entity.type
    });
    
    console.log(`[SocialConnector] ${entity.type} ${entityId} 加入社区 ${community.name}`);
    
    return true;
  }
  
  /**
   * 处理社交事件
   */
  handleSocialEvent(data) {
    switch (data.event) {
      case 'message':
        this.handleMessage(data);
        break;
      case 'knowledge:shared':
        this.handleKnowledgeShare(data);
        break;
      case 'relationship:formed':
        this.handleRelationshipFormed(data);
        break;
      default:
        // 其他社交事件
        break;
    }
  }
  
  /**
   * 处理消息
   */
  handleMessage(message) {
    this.stats.messagesProcessed++;
    
    // 根据消息类型进行路由
    if (message.type === 'knowledge') {
      this.processKnowledgeMessage(message);
    } else if (message.type === 'collaboration') {
      this.routeCollaborationMessage(message);
    } else if (message.type === 'learning') {
      this.processLearningRequest(message);
    }
    
    // 进化记忆：记录有价值的交互
    if (message.content && message.content.length > 50) {  // 长度阈值可调整
      this.evolutionMemory.remember(
        `interaction:${message.id}`, 
        {
          from: message.from,
          to: message.to,
          content: message.content,
          timestamp: message.timestamp,
          context: message.context
        },
        { 
          type: 'social_interaction', 
          importance: this.assessImportance(message) 
        }
      );
    }
  }
  
  /**
   * 处理知识分享
   */
  handleKnowledgeShare(knowledgeData) {
    this.stats.knowledgeAcquired++;
    
    // 将知识存储到进化记忆
    this.evolutionMemory.remember(
      `knowledge:${knowledgeData.id || Date.now()}`, 
      knowledgeData,
      { 
        type: 'knowledge', 
        domain: knowledgeData.domain,
        credibility: knowledgeData.credibility || 0.8,
        source: knowledgeData.source
      }
    );
    
    // 在社区中传播知识
    this.spreadKnowledge(knowledgeData);
    
    console.log(`[SocialConnector] 知识已获取 - 验证来源: ${knowledgeData.source} | 领域: ${knowledgeData.domain}`);
  }
  
  /**
   * 处理关系建立
   */
  handleRelationshipFormed(relationshipData) {
    // 记录关系形成事件
    this.evolutionMemory.remember(
      `relationship:${relationshipData.id}`, 
      relationshipData,
      { 
        type: 'relationship', 
        strength: relationshipData.strength,
        participants: relationshipData.participants
      }
    );
    
    console.log(`[SocialConnector] 关系已建立 - ${relationshipData.participants.join(' <-> ')}`);
  }
  
  /**
   * 评估消息重要性
   */
  assessImportance(message) {
    let score = 0;
    
    // 内容长度
    if (message.content && message.content.length > 100) score += 20;
    else if (message.content && message.content.length > 50) score += 10;
    
    // 参及知识领域
    if (message.topics && message.topics.length > 0) score += 30;
    
    // 发送者声誉
    const sender = this.connections.get(message.from);
    if (sender && sender.type === 'human') {
      const human = this.humans.get(message.from);
      if (human && human.reputation > 80) score += 25;
    }
    
    // 互动频率
    if (message.recency && message.recency < 3600000) score += 15; // 1小时内
    
    return Math.min(score / 100, 1.0); // 归一化到0-1
  }
  
  /**
   * 传播知识
   */
  spreadKnowledge(knowledge) {
    // 在相关社区中传播
    for (const [communityId, community] of this.communities) {
      if (this.isRelevantToCommunity(knowledge, community)) {
        // 向社区成员广播知识
        this.broadcastToCommunity(communityId, {
          type: 'knowledge:received',
          knowledge,
          source: 'social_network'
        });
      }
    }
  }
  
  /**
   * 检查知识与社区的相关性
   */
  isRelevantToCommunity(knowledge, community) {
    if (knowledge.domain && community.topic) {
      return knowledge.domain.toLowerCase().includes(community.topic.toLowerCase()) ||
             community.topic.toLowerCase().includes(knowledge.domain.toLowerCase());
    }
    return false;
  }
  
  /**
   * 向社区广播
   */
  broadcastToCommunity(communityId, message) {
    const community = this.communities.get(communityId);
    if (!community) return;
    
    // 向社区内的真人广播
    for (const memberId of community.members) {
      const member = this.connections.get(memberId);
      if (member && member.connection) {
        // 发送消息到连接
        // 实际实现中会通过 connection.send()
      }
    }
    
    // 向社区内的AI化身广播
    for (const avatarId of community.avatarMembers) {
      const avatar = this.connections.get(avatarId);
      if (avatar) {
        // AI化身处理知识
        this.notifyAvatarOfKnowledge(avatar, message.knowledge);
      }
    }
  }
  
  /**
   * 通知AI化身新知识
   */
  notifyAvatarOfKnowledge(avatar, knowledge) {
    // 这里可以触发AI化身的学习过程
    avatar.lastKnowledgeReceived = Date.now();
    
    // 更新化身的知识计数
    const avatarRecord = this.avatars.get(avatar.id);
    if (avatarRecord) {
      avatarRecord.interactionCount++;
    }
  }
  
  /**
   * 计算社区活跃度
   */
  calculateCommunityActivity(community) {
    const totalParticipants = community.memberCount + community.avatarCount;
    const recentActivity = this.getRecentActivity(community.id, 86400000); // 24小时
    
    if (recentActivity > 100) community.activityLevel = 'high';
    else if (recentActivity > 10) community.activityLevel = 'medium';
    else community.activityLevel = 'low';
  }
  
  /**
   * 获取近期活动
   */
  getRecentActivity(communityId, timeWindowMs) {
    // 实际实现中会查询数据库或缓存
    return Math.floor(Math.random() * 100); // 模拟
  }
  
  /**
   * 启动心跳检测
   */
  startHeartbeat() {
    setInterval(() => {
      this.checkConnections();
      this.updateStats();
    }, this.options.heartbeatInterval);
  }
  
  /**
   * 检查连接状态
   */
  checkConnections() {
    const now = Date.now();
    
    for (const [id, conn] of this.connections) {
      if (now - conn.lastActive > this.options.connectionTimeout) {
        this.disconnect(id);
      }
    }
  }
  
  /**
   * 断开连接
   */
  disconnect(id) {
    const conn = this.connections.get(id);
    if (!conn) return;
    
    // 从各个地方移除引用
    if (conn.type === 'human') {
      this.humans.delete(id);
      this.stats.totalHumans--;
    } else if (conn.type === 'avatar') {
      this.avatars.delete(id);
      this.stats.totalAvatars--;
    }
    
    this.connections.delete(id);
    
    messageBus.publish('social:disconnected', { id, type: conn.type });
    
    console.log(`[SocialConnector] ${conn.type} ${id} 已断开连接`);
  }
  
  /**
   * 更新统计信息
   */
  updateStats() {
    this.stats = {
      ...this.stats,
      totalHumans: this.humans.size,
      totalAvatars: this.avatars.size,
      totalCommunities: this.communities.size
    };
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      connectionCount: this.connections.size,
      onlineHumans: this.getConnectionsByType('human').length,
      onlineAvatars: this.getConnectionsByType('avatar').length
    };
  }
  
  getConnectionsByType(type) {
    return Array.from(this.connections.values()).filter(conn => conn.type === type);
  }
}

/**
 * 消息路由器
 */
class MessageRouter {
  constructor() {
    this.routes = new Map();
  }
  
  route(message) {
    // 根据消息内容和上下文进行智能路由
    const destination = this.determineDestination(message);
    return destination;
  }
  
  determineDestination(message) {
    // 简化的路由逻辑，实际会更复杂
    if (message.target) {
      return message.target; // 指定目标
    }
    
    // 基于主题的路由
    if (message.topics && message.topics.length > 0) {
      return this.routeByTopic(message.topics[0]);
    }
    
    // 默认路由
    return 'broadcast';
  }
  
  routeByTopic(topic) {
    // 实际实现中会根据话题路由到相关社区或专家
    return `topic:${topic}`;
  }
}

// 全局实例
export const socialConnector = new SocialConnector();