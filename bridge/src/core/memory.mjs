// core/memory.mjs — merged from memory/{intelligence-collector,knowledge-network,memory-manager-enhanced,semantic-nn,teacher-llm}.js
// 2026-06-21 (R1 cancelled, target 80 modules)

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import logger from './logger.js';

// === IntelligenceCollector ===

export class IntelligenceCollector {
  constructor() { this.events = []; this.metrics = new Map(); }
  record(event) { this.events.push({ ...event, ts: Date.now() }); }
  count(metric, value = 1) { this.metrics.set(metric, (this.metrics.get(metric) || 0) + value); }
  getEvents(limit = 100) { return this.events.slice(-limit); }
  getMetric(name) { return this.metrics.get(name); }
}

// === KnowledgeNetwork ===

export class KnowledgeNetwork {
  constructor() { this.knowledgeGraph = new Map(); this.connections = []; }

  addKnowledge(knowledge, metadata = {}) {
    const id = knowledge.id || `k_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const node = { ...knowledge, id, addedAt: Date.now(), metadata };
    this.knowledgeGraph.set(id, node);
    return id;
  }

  getKnowledge(id) { return this.knowledgeGraph.get(id); }

  connect(fromId, toId, relation = 'related') {
    this.connections.push({ from: fromId, to: toId, relation, ts: Date.now() });
  }

  search(query, options = {}) {
    const results = [];
    for (const [id, k] of this.knowledgeGraph) {
      if (k.title?.includes(query) || k.content?.includes(query) || k.tags?.some(t => query.includes(t))) results.push(k);
    }
    return results.slice(0, options.limit || 10);
  }
}

export class ExtendedKnowledgeNetwork extends KnowledgeNetwork {
  constructor() { super(); this.communityKnowledge = new Map(); this.peerConnections = new Map(); }

  addCommunity(communityId, topic) {
    if (!this.communityKnowledge.has(communityId)) {
      this.communityKnowledge.set(communityId, { topic, knowledge: new Set(), contributors: new Set(), createdAt: Date.now() });
    }
  }

  acquireKnowledgeFromCommunity(communityId, knowledge, contributorId) {
    const communityData = this.communityKnowledge.get(communityId);
    if (!communityData) return false;
    communityData.knowledge.add(knowledge.id);
    communityData.contributors.add(contributorId);
    return this.addKnowledge(knowledge, { source: contributorId, community: communityId });
  }

  acquireKnowledgeFromSocial(sourceId, knowledge) {
    return this.addKnowledge(knowledge, { source: sourceId, type: 'social' });
  }

  getCommunityKnowledge(communityId) {
    const communityData = this.communityKnowledge.get(communityId);
    if (!communityData) return [];
    return Array.from(communityData.knowledge).map(knowledgeId => this.knowledgeGraph.get(knowledgeId)).filter(k => k);
  }

  broadcastToPeers(peerId, knowledge) {
    if (!this.peerConnections.has(peerId)) this.peerConnections.set(peerId, []);
    this.peerConnections.get(peerId).push({ knowledge, ts: Date.now() });
  }
}

export const knowledgeNetwork = new ExtendedKnowledgeNetwork();

// === EnhancedMemoryManager ===

export class EnhancedMemoryManager {
  constructor() {
    this.shortTerm = new Map();
    this.longTerm = new Map();
    this.episodic = [];
  }

  remember(key, value, options = {}) {
    const ttl = options.ttl || (options.longTerm ? Infinity : 3600000);
    this.shortTerm.set(key, { value, ts: Date.now(), ttl });
    if (options.longTerm) this.longTerm.set(key, { value, ts: Date.now() });
    if (options.episodic) this.episodic.push({ key, value, ts: Date.now() });
    return true;
  }

  recall(key) {
    const short = this.shortTerm.get(key);
    if (short && Date.now() - short.ts < short.ttl) return short.value;
    return this.longTerm.get(key)?.value || null;
  }

  forget(key) { this.shortTerm.delete(key); this.longTerm.delete(key); }
  getStats() { return { shortTerm: this.shortTerm.size, longTerm: this.longTerm.size, episodic: this.episodic.length }; }
}

export const getEnhancedMemoryManager = (options = {}) => new EnhancedMemoryManager(options);

// === SemanticNN ===

export class SemanticNN {
  constructor() { this.embeddings = new Map(); }
  embed(text) {
    const embedding = new Array(128).fill(0).map(() => Math.random());
    this.embeddings.set(text, embedding);
    return embedding;
  }
  similarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  search(query, corpus, topK = 5) {
    const qEmb = this.embed(query);
    return corpus.map(text => ({ text, score: this.similarity(qEmb, this.embed(text)) })).sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

// === TeacherLLM ===

const RULES_DIR_TEACHER = join(homedir(), '.openchat', 'rules');

export class TeacherLLM {
  constructor() { this.rules = []; this.loadRules(); }
  loadRules() {
    try { if (existsSync(RULES_DIR_TEACHER)) { const f = join(RULES_DIR_TEACHER, 'rules.json'); if (existsSync(f)) this.rules = JSON.parse(readFileSync(f, 'utf8')); } } catch (e) {}
  }
  teach(rule) { this.rules.push(rule); }
  ask(question) {
    const matched = this.rules.filter(r => r.question?.includes(question) || question.includes(r.question));
    return matched.length > 0 ? matched[0].answer : null;
  }
}
