// core/collaboration.mjs — merged from collaboration/{community-manager,multi-agent-coordinator,social-connector,task-orchestrator,task-planner}.js
// 2026-06-21 (R1 cancelled, target 80 modules)

import { AgentSession } from '../agent/agent-session.js';
import { messageBus, MESSAGE_TYPES } from '../message-bus.js';
import { configRepo } from './repositories.mjs';
import { memoryRepo } from './repositories.mjs';
import { evolutionRepo } from './repositories.mjs';
import { sessionRepo } from './repositories.mjs';
import { knowledgeNetwork } from '../memory/knowledge-network.js';
import { pluginManager } from './core-config.mjs';
import { PromptBuilder } from '../convergence/prompt-builder.js';
import logger from '../monitoring/logger.js';

// === CommunityManager ===

export class CommunityManager {
  constructor() {
    this.communities = new Map();
    this.communityMembers = new Map();
    this.topics = new Map();
    this.activities = new Map();
    this.recommendations = new Map();
  }

  createCommunity(spec) {
    const communityId = `community_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const community = {
      id: communityId, name: spec.name, description: spec.description, topic: spec.topic,
      createdBy: spec.createdBy, createdAt: Date.now(),
      members: new Set(), avatars: new Set(), moderators: new Set([spec.createdBy]),
      isActive: true, memberCount: 0, avatarCount: 0, activity: 0, knowledgeBase: [],
    };
    this.communities.set(communityId, community);
    this.communityMembers.set(communityId, { humans: new Set(), avatars: new Set() });
    knowledgeNetwork.addCommunity(communityId, spec.topic);
    messageBus.publish('community:created', community);
    logger.info(`[CommunityManager] 社区 ${spec.name} 已创建 (ID: ${communityId})`);
    return communityId;
  }

  joinCommunity(entityId, communityId, entityType = 'human') {
    const community = this.communities.get(communityId);
    if (!community) throw new Error(`社区 ${communityId} 不存在`);
    if (!community.isActive) throw new Error(`社区 ${communityId} 已禁用`);
    if (entityType === 'human') {
      community.members.add(entityId); community.memberCount++;
      this.communityMembers.get(communityId).humans.add(entityId);
    } else if (entityType === 'avatar') {
      community.avatars.add(entityId); community.avatarCount++;
      this.communityMembers.get(communityId).avatars.add(entityId);
    }
    if (!this.topics.has(community.topic)) this.topics.set(community.topic, new Set());
    this.topics.get(community.topic).add(communityId);
    messageBus.publish('community:member:joined', { communityId, entityId, entityType, memberCount: community.memberCount, avatarCount: community.avatarCount });
    logger.info(`[CommunityManager] ${entityType} ${entityId} 加入社区 ${community.name}`);
    return true;
  }

  publishToCommunity(communityId, message, authorId, authorType = 'human') {
    const community = this.communities.get(communityId);
    if (!community) throw new Error(`社区 ${communityId} 不存在`);
    const post = {
      id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      communityId, authorId, authorType, content: message, timestamp: Date.now(),
      likes: 0, shares: 0, replies: 0,
    };
    this.updateCommunityActivity(communityId, post);
    if (this.isKnowledgeSharing(message)) {
      const knowledge = { title: message.title || 'Shared Knowledge', content: message.content || message, source: { type: authorType, id: authorId, community: communityId }, timestamp: post.timestamp };
      knowledgeNetwork.acquireKnowledgeFromSocial(authorId, knowledge);
    }
    messageBus.publish('community:post', post);
    logger.info(`[CommunityManager] 消息发布到社区 ${community.name} by ${authorType} ${authorId}`);
    return post.id;
  }

  updateCommunityActivity(communityId, post) {
    if (!this.activities.has(communityId)) this.activities.set(communityId, []);
    const community = this.communities.get(communityId);
    community.activity++;
    const activityList = this.activities.get(communityId);
    activityList.push(post);
    if (activityList.length > 100) activityList.shift();
  }

  getCommunityInfo(communityId) {
    const community = this.communities.get(communityId);
    if (!community) return null;
    return { ...community, members: Array.from(community.members), avatars: Array.from(community.avatars), activityLog: this.activities.get(communityId) || [] };
  }

  getCommunitiesByTopic(topic) {
    const communityIds = this.topics.get(topic);
    if (!communityIds) return [];
    return Array.from(communityIds).map(id => this.communities.get(id)).filter(c => c);
  }

  getCommunityMembers(communityId) {
    const members = this.communityMembers.get(communityId);
    if (!members) return { humans: [], avatars: [] };
    return { humans: Array.from(members.humans), avatars: Array.from(members.avatars) };
  }

  isKnowledgeSharing(message) {
    if (typeof message !== 'object') return false;
    const knowledgeIndicators = ['knowledge', 'insight', 'learned', 'discovered', 'fact', 'information', 'data', 'research', 'finding', 'concept', 'principle', 'method'];
    const content = JSON.stringify(message).toLowerCase();
    return knowledgeIndicators.some(indicator => content.includes(indicator));
  }

  recommendCommunities(entityId, entityType, interests = []) {
    const recommendations = [];
    for (const interest of interests) {
      const topicCommunities = this.getCommunitiesByTopic(interest);
      recommendations.push(...topicCommunities);
    }
    recommendations.sort((a, b) => b.activity - a.activity);
    return recommendations.slice(0, 10);
  }

  getStats() {
    return {
      totalCommunities: this.communities.size,
      totalMemberships: Array.from(this.communities.values()).reduce((sum, c) => sum + c.memberCount, 0),
      totalAvatars: Array.from(this.communities.values()).reduce((sum, c) => sum + c.avatarCount, 0),
      topicCount: this.topics.size,
    };
  }
}

export class ExtendedKnowledgeNetwork extends knowledgeNetwork.constructor {
  constructor() {
    super();
    this.communityKnowledge = new Map();
  }

  addCommunity(communityId, topic) {
    if (!this.communityKnowledge.has(communityId)) {
      this.communityKnowledge.set(communityId, { topic, knowledge: new Set(), contributors: new Set(), createdAt: Date.now() });
    }
  }

  acquireKnowledgeFromCommunity(communityId, knowledge, contributorId) {
    const communityData = this.communityKnowledge.get(communityId);
    if (!communityData) { logger.warn(`[KnowledgeNetwork] 社区 ${communityId} 不存在`); return false; }
    communityData.knowledge.add(knowledge.id);
    communityData.contributors.add(contributorId);
    return this.addKnowledge(knowledge, { source: contributorId, community: communityId, type: 'community_contribution' });
  }

  getCommunityKnowledge(communityId) {
    const communityData = this.communityKnowledge.get(communityId);
    if (!communityData) return [];
    return Array.from(communityData.knowledge).map(knowledgeId => this.knowledgeGraph.get(knowledgeId)).filter(k => k);
  }
}

// === SocialConnector ===

export class SocialConnector {
  constructor(options = {}) {
    this.options = {
      maxConnections: options.maxConnections || 10000,
      connectionTimeout: options.connectionTimeout || 30000,
      heartbeatInterval: options.heartbeatInterval || 30000,
      messageBufferSize: options.messageBufferSize || 10000,
      ...options,
    };
    this.connections = new Map();
    this.humans = new Map();
    this.avatars = new Map();
    this.communities = new Map();
    this.messageRouter = new MessageRouter();
    this.evolutionMemory = evolutionRepo.getMemory();
    this.stats = { totalHumans: 0, totalAvatars: 0, totalCommunities: 0, messagesProcessed: 0, knowledgeAcquired: 0 };
    this.init();
  }

  init() {
    messageBus.subscribe('social:*', (data) => this.handleSocialEvent(data));
    this.startHeartbeat();
  }

  connectHuman(humanId, connection) {
    if (this.connections.size >= this.options.maxConnections) throw new Error('连接数已达上限');
    this.connections.set(humanId, { id: humanId, type: 'human', connection, joinedAt: Date.now(), avatars: new Set(), communities: new Set(), lastActive: Date.now() });
    this.humans.set(humanId, { id: humanId, profile: null, reputation: 100, knowledgeContribution: 0, avatarCount: 0 });
    this.stats.totalHumans++;
    messageBus.publish('social:human:connected', { humanId });
    logger.info(`[SocialConnector] 真人 ${humanId} 已连接 - 累计 ${this.stats.totalHumans} 人`);
    return true;
  }

  createAvatar(humanId, avatarSpec) {
    const human = this.humans.get(humanId);
    if (!human) throw new Error(`真人 ${humanId} 不存在`);
    const avatarId = `${humanId}:avatar:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.connections.set(avatarId, { id: avatarId, type: 'avatar', ownerId: humanId, spec: avatarSpec, connection: null, joinedAt: Date.now(), capabilities: avatarSpec.capabilities || [], personality: avatarSpec.personality || {}, lastActive: Date.now() });
    this.avatars.set(avatarId, { id: avatarId, ownerId: humanId, type: avatarSpec.type || 'general', purpose: avatarSpec.purpose || 'companion', intelligence: avatarSpec.intelligence || 'medium', knowledgeDomain: avatarSpec.knowledgeDomain || 'general', interactionCount: 0 });
    const humanConn = this.connections.get(humanId);
    humanConn.avatars.add(avatarId);
    human.avatarCount++;
    this.stats.totalAvatars++;
    messageBus.publish('social:avatar:created', { avatarId, ownerId: humanId, spec: avatarSpec });
    logger.info(`[SocialConnector] AI化身 ${avatarId} 已创建 - 真人${humanId}的第${human.avatarCount}个化身`);
    return avatarId;
  }

  createCommunity(communitySpec) {
    const communityId = `community:${Date.now()}-${communitySpec.name}`;
    this.communities.set(communityId, { id: communityId, name: communitySpec.name, topic: communitySpec.topic, description: communitySpec.description, members: new Set(), avatarMembers: new Set(), moderators: new Set(), createdAt: Date.now(), memberCount: 0, avatarCount: 0, knowledgeBase: new Set(), activityLevel: 'low' });
    this.stats.totalCommunities++;
    messageBus.publish('social:community:created', { communityId, spec: communitySpec });
    logger.info(`[SocialConnector] 社区 ${communitySpec.name} 已创建 - 累计 ${this.stats.totalCommunities} 个社区`);
    return communityId;
  }

  joinCommunity(entityId, communityId) {
    const entity = this.connections.get(entityId);
    const community = this.communities.get(communityId);
    if (!entity || !community) throw new Error(`实体或社区不存在: ${entityId}, ${communityId}`);
    if (entity.type === 'human') { community.members.add(entityId); community.memberCount++; }
    else if (entity.type === 'avatar') { community.avatarMembers.add(entityId); community.avatarCount++; }
    if (!entity.communities) entity.communities = new Set();
    entity.communities.add(communityId);
    this.calculateCommunityActivity(community);
    messageBus.publish('social:joined:community', { entityId, communityId, type: entity.type });
    logger.info(`[SocialConnector] ${entity.type} ${entityId} 加入社区 ${community.name}`);
    return true;
  }

  handleSocialEvent(data) {
    switch (data.event) {
      case 'message': this.handleMessage(data); break;
      case 'knowledge:shared': this.handleKnowledgeShare(data); break;
      case 'relationship:formed': this.handleRelationshipFormed(data); break;
    }
  }

  handleMessage(message) {
    this.stats.messagesProcessed++;
    if (message.type === 'knowledge') this.processKnowledgeMessage(message);
    else if (message.type === 'collaboration') this.routeCollaborationMessage(message);
    else if (message.type === 'learning') this.processLearningRequest(message);
    if (message.content && message.content.length > 50) {
      this.evolutionMemory.remember(`interaction:${message.id}`, { from: message.from, to: message.to, content: message.content, timestamp: message.timestamp, context: message.context }, { type: 'social_interaction', importance: this.assessImportance(message) });
    }
  }

  handleKnowledgeShare(knowledgeData) {
    this.stats.knowledgeAcquired++;
    this.evolutionMemory.remember(`knowledge:${knowledgeData.id || Date.now()}`, knowledgeData, { type: 'knowledge', domain: knowledgeData.domain, credibility: knowledgeData.credibility || 0.8, source: knowledgeData.source });
    this.spreadKnowledge(knowledgeData);
    logger.info(`[SocialConnector] 知识已获取 - 验证来源: ${knowledgeData.source} | 领域: ${knowledgeData.domain}`);
  }

  handleRelationshipFormed(relationshipData) {
    this.evolutionMemory.remember(`relationship:${relationshipData.id}`, relationshipData, { type: 'relationship', strength: relationshipData.strength, participants: relationshipData.participants });
    logger.info(`[SocialConnector] 关系已建立 - ${relationshipData.participants.join(' <-> ')}`);
  }

  assessImportance(message) {
    let score = 0;
    if (message.content && message.content.length > 100) score += 20;
    else if (message.content && message.content.length > 50) score += 10;
    if (message.topics && message.topics.length > 0) score += 30;
    const sender = this.connections.get(message.from);
    if (sender && sender.type === 'human') {
      const human = this.humans.get(message.from);
      if (human && human.reputation > 80) score += 25;
    }
    if (message.recency && message.recency < 3600000) score += 15;
    return Math.min(score / 100, 1.0);
  }

  spreadKnowledge(knowledge) {
    for (const [communityId, community] of this.communities) {
      if (this.isRelevantToCommunity(knowledge, community)) {
        this.broadcastToCommunity(communityId, { type: 'knowledge:received', knowledge, source: 'social_network' });
      }
    }
  }

  isRelevantToCommunity(knowledge, community) {
    if (knowledge.domain && community.topic) {
      return knowledge.domain.toLowerCase().includes(community.topic.toLowerCase()) || community.topic.toLowerCase().includes(knowledge.domain.toLowerCase());
    }
    return false;
  }

  broadcastToCommunity(communityId, message) {
    const community = this.communities.get(communityId);
    if (!community) return;
    for (const memberId of community.members) {
      const member = this.connections.get(memberId);
      if (member && member.connection) { /* connection.send() */ }
    }
    for (const avatarId of community.avatarMembers) {
      const avatar = this.connections.get(avatarId);
      if (avatar) this.notifyAvatarOfKnowledge(avatar, message.knowledge);
    }
  }

  notifyAvatarOfKnowledge(avatar, knowledge) {
    avatar.lastKnowledgeReceived = Date.now();
    const avatarRecord = this.avatars.get(avatar.id);
    if (avatarRecord) avatarRecord.interactionCount++;
  }

  calculateCommunityActivity(community) {
    const totalParticipants = community.memberCount + community.avatarCount;
    const recentActivity = this.getRecentActivity(community.id, 86400000);
    if (recentActivity > 100) community.activityLevel = 'high';
    else if (recentActivity > 10) community.activityLevel = 'medium';
    else community.activityLevel = 'low';
  }

  getRecentActivity(communityId, timeWindowMs) {
    return Math.floor(Math.random() * 100);
  }

  startHeartbeat() {
    setInterval(() => { this.checkConnections(); this.updateStats(); }, this.options.heartbeatInterval);
  }

  checkConnections() {
    const now = Date.now();
    for (const [id, conn] of this.connections) {
      if (now - conn.lastActive > this.options.connectionTimeout) this.disconnect(id);
    }
  }

  disconnect(id) {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.type === 'human') { this.humans.delete(id); this.stats.totalHumans--; }
    else if (conn.type === 'avatar') { this.avatars.delete(id); this.stats.totalAvatars--; }
    this.connections.delete(id);
    messageBus.publish('social:disconnected', { id, type: conn.type });
    logger.info(`[SocialConnector] ${conn.type} ${id} 已断开连接`);
  }

  updateStats() {
    this.stats = { ...this.stats, totalHumans: this.humans.size, totalAvatars: this.avatars.size, totalCommunities: this.communities.size };
  }

  getStats() {
    return { ...this.stats, connectionCount: this.connections.size, onlineHumans: this.getConnectionsByType('human').length, onlineAvatars: this.getConnectionsByType('avatar').length };
  }

  getConnectionsByType(type) {
    return Array.from(this.connections.values()).filter(conn => conn.type === type);
  }

  processKnowledgeMessage(message) { /* dispatch */ }
  routeCollaborationMessage(message) { /* dispatch */ }
  processLearningRequest(message) { /* dispatch */ }
}

class MessageRouter {
  constructor() { this.routes = new Map(); }
  route(message) { return this.determineDestination(message); }
  determineDestination(message) {
    if (message.target) return message.target;
    if (message.topics && message.topics.length > 0) return this.routeByTopic(message.topics[0]);
    return 'broadcast';
  }
  routeByTopic(topic) { return `topic:${topic}`; }
}

export const socialConnector = new SocialConnector();

// === MultiAgentCoordinator ===

export class MultiAgentCoordinator {
  constructor() {
    this.agents = new Map();
    this.taskQueue = [];
    this.completedTasks = [];
    this.socialConnector = socialConnector;
    this.knowledgeNetwork = memoryRepo.getKnowledgeNetwork();
    this.communityManager = null;
  }

  async spawnAgent(agentId, config = {}) {
    const id = agentId || `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const agent = new AgentSession(id, config);
    await agent.initialize();
    this.agents.set(id, agent);
    return agent;
  }

  getAgent(agentId) { return this.agents.get(agentId); }
  async terminateAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) { agent.cleanup(); this.agents.delete(agentId); return true; }
    return false;
  }
  listAgents() { return Array.from(this.agents.values()).map(a => a.getStatus()); }

  async decomposeTask(task) {
    if (typeof task === 'string') {
      const coordinatorAgent = await this.spawnAgent('decomposer', { name: 'Decomposer', systemPrompt: 'You are a Task Decomposition expert. Break down the user request into a structured JSON array of discrete, actionable steps. Return ONLY the JSON array. Example: [{"id": "1", "description": "Read file X", "type": "read"}, {"id": "2", "description": "Implement feature Y", "type": "write"}]' });
      try {
        const result = await coordinatorAgent.run(`Decompose this task into steps: ${task}`);
        const content = result.content || result;
        const jsonMatch = content.match(/\[\s*\{.*\}\s*\]/s);
        if (jsonMatch) {
          const steps = JSON.parse(jsonMatch[0]);
          coordinatorAgent.cleanup();
          return steps.map((step, i) => ({ ...step, id: step.id || crypto.randomUUID(), stepNumber: i + 1, totalSteps: steps.length }));
        }
      } catch (e) { logger.error('Decomposition failed, falling back to simple split', e); }
      finally { coordinatorAgent.cleanup(); }
      return [{ id: crypto.randomUUID(), description: task, type: 'general' }];
    }
    if (task.decompose && Array.isArray(task.steps)) {
      return task.steps.map((step, i) => ({
        id: crypto.randomUUID(),
        description: step,
        type: step.toLowerCase().includes('read') ? 'read' : step.toLowerCase().includes('write') ? 'write' : step.toLowerCase().includes('test') ? 'test' : step.toLowerCase().includes('review') ? 'review' : 'general',
        stepNumber: i + 1, totalSteps: task.steps.length,
      }));
    }
    return [{ id: crypto.randomUUID(), description: task.description || task, type: 'general' }];
  }

  async parallelExecute(task, options = {}) {
    const { maxAgents = 5, agentConfig = {}, onProgress = () => {} } = options;
    const subtasks = await this.decomposeTask(task);
    if (subtasks.length === 0) return { success: false, error: 'No subtasks generated' };
    if (subtasks.length === 1) {
      const agent = await this.spawnAgent(null, agentConfig);
      const result = await agent.run(subtasks[0].description);
      agent.cleanup();
      return { success: true, results: [result], agentId: agent.agentId };
    }
    const numAgents = Math.min(subtasks.length, maxAgents);
    const chunks = this.chunkArray(subtasks, numAgents);
    onProgress({ phase: 'spawning', count: numAgents });
    const agentPromises = chunks.map((chunk, i) => this.spawnAgent(`${agentConfig.name || 'worker'}-${i}`, agentConfig));
    const spawnedAgents = await Promise.all(agentPromises);
    onProgress({ phase: 'executing', agents: spawnedAgents.map(a => a.agentId) });
    const taskPromises = spawnedAgents.map((agent, i) => this.executeChunk(agent, chunks[i], onProgress));
    const results = await Promise.all(taskPromises);
    spawnedAgents.forEach(agent => agent.cleanup());
    onProgress({ phase: 'aggregating', results });
    return this.aggregateResults(results, subtasks);
  }

  async executeChunk(agent, subtasks, onProgress) {
    const chunkResults = [];
    for (const subtask of subtasks) {
      onProgress({ agent: agent.agentId, subtask: subtask.description, phase: 'executing' });
      try { chunkResults.push({ subtaskId: subtask.id, success: true, result: await agent.run(subtask.description), agentId: agent.agentId }); }
      catch (error) { chunkResults.push({ subtaskId: subtask.id, success: false, error: error.message, agentId: agent.agentId }); }
    }
    return chunkResults;
  }

  aggregateResults(chunkResults, subtasks) {
    const flat = chunkResults.flat();
    const successCount = flat.filter(r => r.success).length;
    const failedCount = flat.filter(r => !r.success).length;
    const taskMap = new Map();
    subtasks.forEach((st, i) => taskMap.set(st.id, { ...st, index: i }));
    flat.forEach(result => { if (taskMap.has(result.subtaskId)) taskMap.get(result.subtaskId).result = result; });
    return { success: failedCount === 0, total: flat.length, succeeded: successCount, failed: failedCount, tasks: Array.from(taskMap.values()), summary: this.generateSummary(flat, subtasks) };
  }

  generateSummary(results, subtasks) {
    const lines = [`Parallel execution completed:`, `  Total tasks: ${subtasks.length}`];
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    if (succeeded > 0) lines.push(`  ✓ Succeeded: ${succeeded}`);
    if (failed > 0) lines.push(`  ✗ Failed: ${failed}`);
    return lines.join('\n');
  }

  chunkArray(arr, numChunks) {
    const chunks = [];
    const chunkSize = Math.ceil(arr.length / numChunks);
    for (let i = 0; i < arr.length; i += chunkSize) chunks.push(arr.slice(i, i + chunkSize));
    return chunks;
  }

  async sequentialExecute(tasks, options = {}) {
    const { agentConfig = {}, onProgress = () => {} } = options;
    const agent = await this.spawnAgent(null, { name: 'sequential-worker', ...agentConfig });
    const results = [];
    for (const task of tasks) {
      onProgress({ phase: 'executing', task });
      try { results.push({ success: true, result: await agent.run(task) }); }
      catch (error) { results.push({ success: false, error: error.message }); }
    }
    agent.cleanup();
    return { success: results.every(r => r.success), results, agentId: agent.agentId };
  }

  sendTo(fromAgentId, toAgentId, message) { messageBus.sendTo(fromAgentId, toAgentId, message); }
  broadcast(fromAgentId, message) { messageBus.broadcast(fromAgentId, message); }
  delegate(fromAgentId, toAgentId, task) { messageBus.delegate(fromAgentId, toAgentId, task); }

  async iterativeReviewLoop(task, options = {}) {
    const { maxLoops = 3, coderConfig = {}, reviewerConfig = {} } = options;
    let currentTask = task, iteration = 0, isApproved = false;
    const history = [];
    while (iteration < maxLoops && !isApproved) {
      iteration++;
      const coder = await this.spawnAgent(`coder-iter-${iteration}`, { name: `Coder-Iter-${iteration}`, ...coderConfig });
      const codeResult = await coder.run(currentTask); coder.cleanup();
      const reviewer = await this.spawnAgent(`reviewer-iter-${iteration}`, { name: 'Critical Code Reviewer', systemPrompt: 'You are a Critical Code Reviewer. Evaluate the provided solution for bugs, performance issues, and security flaws. If the solution is perfect, start your response with "APPROVED". Otherwise, provide specific, actionable feedback for improvement.', ...reviewerConfig });
      const reviewInput = `Original Task: ${typeof task === 'string' ? task : task.description}\n\nProposed Solution:\n${codeResult.content || JSON.stringify(codeResult)}`;
      const reviewResult = await reviewer.run(reviewInput); reviewer.cleanup();
      history.push({ iteration, code: codeResult.content || codeResult, review: reviewResult.content || reviewResult });
      if (reviewResult.content && reviewResult.content.startsWith('APPROVED')) isApproved = true;
      else if (iteration < maxLoops) currentTask = `Fix the following issues based on review:\n\n${reviewResult.content || reviewResult}\n\nPrevious Solution:\n${codeResult.content || codeResult}`;
    }
    return { success: isApproved, finalResult: history[history.length - 1]?.code, iterations: iteration, history };
  }

  async evolutionLoop(targetModule, goal) {
    const currentProvider = configRepo.getPreference('currentProvider');
    const currentModel = configRepo.getPreference('currentModel');
    const history = [];
    let isStable = false, iterations = 0;
    while (!isStable && iterations < 5) {
      iterations++;
      const agentConfig = { provider: currentProvider, model: currentModel };
      const architect = await this.spawnAgent('arch-evolve', { name: 'Architect', systemPrompt: 'You are the Lead Architect of OpenChat. Analyze the codebase and provide a precise implementation plan to achieve the goal. Specify files to change and expected test results.', ...agentConfig });
      const plan = await architect.run(`Module: ${targetModule}\nGoal: ${goal}\nAnalyze and provide a plan.`); architect.cleanup();
      const engineer = await this.spawnAgent('eng-evolve', { name: 'Engineer', systemPrompt: 'You are the Senior Engineer. Implement the plan. After writing code, you MUST use run_llm_judge to verify your changes.', ...agentConfig });
      const implementation = await engineer.run(`Plan: ${plan.content}\nImplement the changes and verify them.`); engineer.cleanup();
      const judge = await this.spawnAgent('judge-evolve', { name: 'QualityJudge', systemPrompt: 'You are the Quality Assurance Judge. Use run_llm_judge to verify if the implementation actually achieves the goal without regressions. If perfect, respond with "EVOLUTION_COMPLETE".', ...agentConfig });
      const audit = await judge.run(`Implementation: ${implementation.content}\nGoal: ${goal}`); judge.cleanup();
      history.push({ iteration: iterations, plan: plan.content, impl: implementation.content, audit: audit.content });
      if (audit.content && audit.content.includes('EVOLUTION_COMPLETE')) isStable = true;
    }
    return { success: isStable, finalSolution: history[history.length - 1]?.impl, history };
  }

  getStatus() { return { agentCount: this.agents.size, agents: this.listAgents(), queueLength: this.taskQueue.length, completedCount: this.completedTasks.length }; }
}

export const multiAgentCoordinator = new MultiAgentCoordinator();

// === TaskOrchestrator ===

export class TaskOrchestrator {
  constructor(options = {}) {
    this.tasks = new Map(); this.agents = new Map(); this.dependencies = new Map(); this.subscribers = new Map();
    this.maxConcurrency = options.maxConcurrency || 5;
    this.timeout = options.timeout || 30000;
    this.retryAttempts = options.retryAttempts || 3;
    this.readyQueue = []; this.waitingQueue = []; this.runningTasks = new Set();
  }

  registerAgent(agentId, agentSpec) {
    this.agents.set(agentId, { id: agentId, capabilities: agentSpec.capabilities || [], status: 'available', busyCount: 0, lastActivity: Date.now(), maxConcurrency: agentSpec.maxConcurrency || 1 });
    logger.info(`[TaskOrchestrator] Registered agent: ${agentId}`, agentSpec.capabilities);
  }

  submitTask(taskSpec) {
    const taskId = taskSpec.id || this._generateId();
    const task = { id: taskId, name: taskSpec.name, description: taskSpec.description, dependencies: taskSpec.dependencies || [], capabilities: taskSpec.capabilities || [], priority: taskSpec.priority || 0, timeout: taskSpec.timeout || this.timeout, data: taskSpec.data || {}, status: 'pending', assignedAgent: null, result: null, error: null, retries: 0, maxRetries: taskSpec.maxRetries || this.retryAttempts, submittedAt: Date.now(), startedAt: null, completedAt: null };
    this.tasks.set(taskId, task);
    if (task.dependencies.length === 0) this.readyQueue.push(taskId);
    else { this.waitingQueue.push(taskId); this._setupDependencies(taskId, task.dependencies); }
    logger.info(`[TaskOrchestrator] Submitted task: ${taskId} - ${task.name}`);
    this._processQueues();
    return taskId;
  }

  _setupDependencies(taskId, dependencies) { for (const depId of dependencies) { if (!this.dependencies.has(depId)) this.dependencies.set(depId, new Set()); this.dependencies.get(depId).add(taskId); } }

  _checkDependencies(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    for (const depId of task.dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== 'completed') return false;
    }
    return true;
  }

  _selectBestAgent(task) {
    const availableAgents = Array.from(this.agents.values()).filter(agent => agent.status === 'available' && agent.busyCount < agent.maxConcurrency && this._hasRequiredCapabilities(agent, task)).sort((a, b) => (b.lastActivity - a.lastActivity) + (b.busyCount - a.busyCount));
    return availableAgents[0] || null;
  }

  _hasRequiredCapabilities(agent, task) {
    if (!task.capabilities || task.capabilities.length === 0) return true;
    return task.capabilities.every(cap => agent.capabilities.includes(cap));
  }

  async _executeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const agent = this._selectBestAgent(task);
    if (!agent) throw new Error(`No suitable agent available for task: ${taskId}`);
    try {
      task.status = 'running'; task.assignedAgent = agent.id; task.startedAt = Date.now(); this.runningTasks.add(taskId);
      agent.status = 'busy'; agent.busyCount++; agent.lastActivity = Date.now();
      logger.info(`[TaskOrchestrator] Assigning task ${taskId} to agent ${agent.id}`);
      const result = await this._executeTaskWithTimeout(task, agent);
      task.status = 'completed'; task.result = result; task.completedAt = Date.now();
      logger.info(`[TaskOrchestrator] Task ${taskId} completed successfully`);
      this._notifyDependents(taskId);
      return result;
    } catch (error) {
      task.status = 'failed'; task.error = error.message; task.completedAt = Date.now();
      logger.error(`[TaskOrchestrator] Task ${taskId} failed:`, error);
      if (task.retries < task.maxRetries) { task.retries++; task.status = 'pending'; this.readyQueue.unshift(taskId); logger.info(`[TaskOrchestrator] Retrying task ${taskId} (${task.retries}/${task.maxRetries})`); }
      throw error;
    } finally {
      agent.busyCount--;
      if (agent.busyCount <= 0) { agent.status = 'available'; agent.busyCount = 0; }
      this.runningTasks.delete(taskId);
      this._processQueues();
    }
  }

  _executeTaskWithTimeout(task, agent) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`)), task.timeout);
      Promise.resolve().then(async () => {
        const result = await this._simulateTaskExecution(task, agent);
        clearTimeout(timeoutId); resolve(result);
      }).catch(error => { clearTimeout(timeoutId); reject(error); });
    });
  }

  async _simulateTaskExecution(task, agent) {
    logger.info(`[Simulator] Executing task ${task.id} on agent ${agent.id}`);
    const executionTime = Math.min(1000 + Math.random() * 2000, task.timeout / 2);
    await new Promise(resolve => setTimeout(resolve, executionTime));
    return { taskId: task.id, agentId: agent.id, result: `Task ${task.name} completed by agent ${agent.id}`, executionTime, data: task.data };
  }

  _notifyDependents(taskId) {
    const dependents = this.dependencies.get(taskId);
    if (!dependents) return;
    for (const dependentId of dependents) {
      const waitingIndex = this.waitingQueue.indexOf(dependentId);
      if (waitingIndex !== -1) {
        if (this._checkDependencies(dependentId)) { this.waitingQueue.splice(waitingIndex, 1); this.readyQueue.push(dependentId); logger.info(`[TaskOrchestrator] Dependencies satisfied for task ${dependentId}`); }
      }
    }
    this._processQueues();
  }

  _processQueues() {
    for (let i = this.waitingQueue.length - 1; i >= 0; i--) {
      const taskId = this.waitingQueue[i];
      if (this._checkDependencies(taskId)) { this.waitingQueue.splice(i, 1); this.readyQueue.push(taskId); }
    }
    while (this.runningTasks.size < this.maxConcurrency && this.readyQueue.length > 0) {
      const taskId = this.readyQueue.shift();
      this._executeTask(taskId).catch(error => { logger.error('Error executing task:', error); });
    }
  }

  async waitForTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status === 'completed') return task.result;
    if (task.status === 'failed') throw new Error(task.error || `Task ${taskId} failed`);
    const timeout = task.timeout;
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (task.status === 'completed') return task.result;
      if (task.status === 'failed') throw new Error(task.error || `Task ${taskId} failed`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Wait timeout for task ${taskId}`);
  }

  subscribeToTask(taskId, callback) { if (!this.subscribers.has(taskId)) this.subscribers.set(taskId, []); this.subscribers.get(taskId).push(callback); }

  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return { id: task.id, name: task.name, status: task.status, assignedAgent: task.assignedAgent, result: task.result, error: task.error, retries: task.retries, submittedAt: task.submittedAt, startedAt: task.startedAt, completedAt: task.completedAt };
  }

  getStats() {
    return {
      totalTasks: this.tasks.size,
      pendingTasks: this.tasks.size - Array.from(this.tasks.values()).filter(t => t.status !== 'pending').length,
      runningTasks: this.runningTasks.size,
      completedTasks: Array.from(this.tasks.values()).filter(t => t.status === 'completed').length,
      failedTasks: Array.from(this.tasks.values()).filter(t => t.status === 'failed').length,
      readyQueue: this.readyQueue.length, waitingQueue: this.waitingQueue.length,
      totalAgents: this.agents.size,
      availableAgents: Array.from(this.agents.values()).filter(a => a.status === 'available').length,
    };
  }

  _generateId() { return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; }

  async decomposeComplexTask(complexTaskSpec) {
    const subtasks = complexTaskSpec.subtasks || [];
    const taskIds = [];
    for (const subtask of subtasks) taskIds.push(this.submitTask({ ...subtask, dependencies: subtask.dependencies || [] }));
    return taskIds;
  }
}

export const taskOrchestrator = new TaskOrchestrator();

// === TaskPlanner ===

export class TaskPlanner {
  constructor(options = {}) { this.maxSteps = options.maxSteps || 10; this.enableReflection = options.enableReflection !== false; }

  async plan(task, context = {}) {
    const planPrompt = `你是一个任务规划专家。分析用户请求，生成结构化的执行计划。

用户任务: ${task}

上下文信息:
- 可用工具: ${pluginManager.getToolsForFunctionCalling().map(t => t.function.name).join(', ')}
- 当前目录: ${context.cwd || process.cwd()}

请生成执行计划，格式如下:
\`\`\`json
{
  "goal": "任务目标",
  "steps": [
    { "id": 1, "action": "动作描述", "tool": "工具名称", "expected": "预期结果" }
  ],
  "success_criteria": "成功标准"
}
\`\`\`

注意:
1. 每个步骤应该是原子操作
2. 优先使用可用的工具
3. 如果任务复杂，拆分为多个步骤
4. 返回纯 JSON，不要有其他内容`;

    const provider = this.getProvider(context);
    const model = this.getModel(context);
    const response = await provider.chat(model, [
      { role: 'system', content: '你是一个精准的任务规划专家，只返回 JSON 格式的计划。' },
      { role: 'user', content: planPrompt }
    ]);
    const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/) || response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const plan = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        plan.taskId = crypto.randomUUID();
        plan.createdAt = Date.now();
        return plan;
      } catch (e) { logger.warn('[Planner] Failed to parse plan:', e.message); }
    }
    return this.generateSimplePlan(task);
  }

  async execute(plan, context = {}, onProgress = () => {}) {
    const results = [];
    let allSuccess = true;
    onProgress({ phase: 'execute', plan });
    for (const step of plan.steps) {
      onProgress({ phase: 'step', step });
      const result = await this.executeStep(step, context);
      results.push({ stepId: step.id, action: step.action, tool: step.tool, success: result.success, result: result.result || result.error });
      if (!result.success) {
        allSuccess = false;
        if (step.critical !== false) { onProgress({ phase: 'failed', step, result }); break; }
      }
      onProgress({ phase: 'step_done', step, result });
    }
    return { taskId: plan.taskId, goal: plan.goal, success: allSuccess, results, completedAt: Date.now() };
  }

  async executeStep(step, context) {
    const tool = step.tool;
    if (!tool) return { success: false, error: 'No tool specified' };
    const args = this.extractArgs(step);
    try { const result = await pluginManager.executeTool(tool, args, context); return { success: true, result }; }
    catch (error) { return { success: false, error: error.message }; }
  }

  extractArgs(step) {
    const args = {};
    if (step.args) return step.args;
    switch (step.tool) {
      case 'run_command': { const m = step.action.match(/(?:执行|运行|run)\s*[`"]?([^`"\n]+)[`"]?/i); if (m) args.command = m[1].trim(); break; }
      case 'read_file': { const m = step.action.match(/(?:读取|read)\s*[`"]?([^`"\n]+)[`"]?/i); if (m) args.path = m[1].trim(); break; }
      case 'write_file': { const m = step.action.match(/(?:写入|write)\s*[`"]?([^`"\n]+)[`"]?/i); if (m) args.path = m[1].trim(); if (step.content) args.content = step.content; break; }
      case 'git_commit': { const m = step.action.match(/(?:提交|commit)\s*[`"]?([^`"\n]+)[`"]?/i); if (m) args.message = m[1].trim(); break; }
    }
    return args;
  }

  async reflect(plan, executionResult, context = {}) {
    if (!this.enableReflection) return { needsAdjustment: false };
    const reflectPrompt = `分析任务执行结果，判断是否需要调整计划。

原始任务: ${plan.goal}

执行结果:
${JSON.stringify(executionResult.results, null, 2)}

成功标准: ${plan.success_criteria}

请评估:
1. 任务是否完成?
2. 如果未完成，需要什么调整?
3. 是否需要重新规划?

返回 JSON:
\`\`\`json
{
  "completed": true/false,
  "score": 1-5,
  "feedback": "反馈",
  "needsAdjustment": true/false,
  "adjustments": [{ "stepId": 1, "newAction": "新动作" }]
}
\`\`\``;
    const provider = this.getProvider(context);
    const model = this.getModel(context);
    const response = await provider.chat(model, [
      { role: 'system', content: '你是任务评估专家，只返回 JSON。' },
      { role: 'user', content: reflectPrompt }
    ]);
    const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/) || response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) { try { return JSON.parse(jsonMatch[1] || jsonMatch[0]); } catch (e) { return { needsAdjustment: false, feedback: 'Reflection parse failed' }; } }
    return { needsAdjustment: false };
  }

  async run(task, context = {}, onProgress = () => {}) {
    onProgress({ phase: 'planning' });
    const plan = await this.plan(task, context);
    onProgress({ phase: 'planned', plan });
    onProgress({ phase: 'executing' });
    let result = await this.execute(plan, context, onProgress);
    if (this.enableReflection && !result.success) {
      onProgress({ phase: 'reflecting' });
      const reflection = await this.reflect(plan, result, context);
      if (reflection.needsAdjustment && reflection.adjustments) {
        onProgress({ phase: 'adjusting', reflection });
        plan.steps = plan.steps.map(step => { const adj = reflection.adjustments.find(a => a.stepId === step.id); return adj ? { ...step, ...adj } : step; });
        result = await this.execute(plan, context, onProgress);
      }
      result.reflection = reflection;
    }
    onProgress({ phase: 'done', result });
    return result;
  }

  generateSimplePlan(task) {
    return { taskId: crypto.randomUUID(), goal: task, steps: [{ id: 1, action: task, tool: 'run_command', expected: '完成用户请求' }], success_criteria: '用户满意', createdAt: Date.now() };
  }

  getProvider(context) {
    const providerId = context.providerId || sessionRepo.currentProvider || 'openrouter';
    return sessionRepo.getProvider(providerId);
  }

  getModel(context) { return context.model || sessionRepo.currentModel || 'auto'; }
}

export const taskPlanner = new TaskPlanner();
