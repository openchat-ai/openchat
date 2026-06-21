// core/repositories.mjs — merged from repositories/{config,evolution,memory,session}-repo.js
// 2026-06-21 (R1 cancelled, target 80 modules)

import { persistentConfig } from './core-config.mjs';
import { EvolutionMemory } from './evolution/evolution-memory.js';
import { memoryManager } from '../memory/memory.mjs';
import { knowledgeNetwork } from './memory/knowledge-network.js';
import { getEnhancedMemoryManager } from './memory/memory-manager-enhanced.js';
import { sessionManager } from '../session/session-manager.js';
import { sessionEvents } from './runtime.mjs';

// === ConfigRepository ===

export class ConfigRepository {
  getCurrentProvider() { return persistentConfig.getCurrentProvider(); }
  getCurrentModel() { return persistentConfig.getCurrentModel(); }
  getApiKey(provider) { return persistentConfig.getApiKey(provider); }
  listProviders() { return persistentConfig.listProviders(); }
  getBridgeConfig() { return persistentConfig.getBridgeConfig(); }
  setBridgeConfig(cfg) { return persistentConfig.setBridgeConfig(cfg); }
  getPreference(key, defaultValue = null) { return persistentConfig.getPreference(key, defaultValue); }
  setPreference(key, value) { persistentConfig.setPreference(key, value); }
  resolveModelName(providerName, model) { return persistentConfig.resolveModelName(providerName, model); }
  getProvider(name) { return persistentConfig.getProvider(name); }
  setCurrentProvider(name) { persistentConfig.setCurrentProvider(name); }
  setCurrentModel(model) { persistentConfig.setCurrentModel(model); }
  getHostId() { return persistentConfig.getHostId(); }
  getAge() { return persistentConfig.getAge(); }
  get(key) { return persistentConfig.getPreference(key); }
  set(key, value) { persistentConfig.setPreference(key, value); }
}

// === EvolutionRepository ===

export class EvolutionRepository {
  constructor() { this._memory = new EvolutionMemory(); }
  getMemory() { return this._memory; }
  remember(key, value, metadata = {}) { return this._memory.remember(key, value, metadata); }
  recall(key) { return this._memory.recall(key); }
  search(query, options = {}) { return this._memory.search(query, options); }
  rememberProgress(task, status = 'in-progress', details = {}) { return this._memory.rememberProgress(task, status, details); }
  getProgress(task) { return this._memory.getProgress(task); }
  updateProgress(task, status, details = {}) { return this._memory.updateProgress(task, status, details); }
}

// === MemoryRepository ===

export class MemoryRepository {
  getSessionContext(sessionId) { return memoryManager.getContext(sessionId); }
  addMessage(sessionId, role, content, metadata = {}) { return memoryManager.addMessage(sessionId, role, content, metadata); }
  retrieveRelevantContext(query, options = {}) { return memoryManager.retrieveRelevantContext(query, options); }
  getMemoryManager() { return memoryManager; }
  getEnhancedMemoryManager(options = {}) { return getEnhancedMemoryManager(options); }
  getKnowledgeNetwork() { return knowledgeNetwork; }
  queryKnowledge(query, options = {}) { return knowledgeNetwork.getKnowledge(query, options); }
}

// === SessionRepository ===

export class SessionRepository {
  getSession(sessionId) { return sessionManager.getSession(sessionId); }
  getProvider(type) { return sessionManager.getProvider(type); }
  addProvider(type, apiKey = null, endpoint = null) { return sessionManager.addProvider(type, apiKey, endpoint); }
  listProviders() { return sessionManager.listProviders(); }
  createSession(providerType, model, config = {}) { return sessionManager.createSession(providerType, model, config); }
  listSessions() { return sessionManager.listSessions(); }
  closeSession(sessionId) { return sessionManager.closeSession(sessionId); }
  publishEvent(sessionId, event) { return sessionEvents.publish(sessionId, event); }
  subscribe(sessionId, callback) { return sessionEvents.subscribe(sessionId, callback); }
  getEventHistory(sessionId) { return sessionEvents.getHistory(sessionId); }
}

// === Instances (consumers can do `import { configRepo } from ...`) ===

export const configRepo = new ConfigRepository();
export const evolutionRepo = new EvolutionRepository();
export const memoryRepo = new MemoryRepository();
export const sessionRepo = new SessionRepository();
