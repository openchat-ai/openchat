import { createProvider } from '../providers/ai-provider.js';
import { persistentStore } from './persistent-store.js';
import { persistentConfig } from '../core/persistent-config.js';
import logger from '../core/logger.js';

export class SessionManager {
  constructor() {
    this.providers = new Map();
  }

  async addProvider(type, apiKey = null, endpoint = null) {
    // Already connected? Just return it
    if (this.providers.has(type)) {
      const existing = this.providers.get(type);
      if (existing.connected) {
        return existing;
      }
      // Not connected but exists - remove and re-add
      this.providers.delete(type);
    }

    const effectiveKey = apiKey || persistentConfig.getApiKey(type);
    if (!effectiveKey) {
      throw new Error(`No API key for ${type}. Set with: config set ${type} <api_key>`);
    }

    const provider = createProvider(type);
    await provider.connect(effectiveKey, endpoint);
    this.providers.set(type, provider);

    logger.info(`✓ Connected to ${provider.name}`);
    return provider;
  }

  async removeProvider(type) {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider ${type} not found`);
    }
    await provider.disconnect();
    this.providers.delete(type);
    logger.info(`✗ Disconnected from ${provider.name}`);
  }

  addProviderDirect(provider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(type) {
    return this.providers.get(type);
  }

  listProviders() {
    return Array.from(this.providers.entries()).map(([type, provider]) => ({
      type,
      name: provider.name,
      connected: provider.connected,
      models: provider.getModels()
    }));
  }

  async createSession(providerType, model, config = {}) {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Provider ${providerType} not connected`);
    }

    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      providerType,
      model,
      config,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    persistentStore.setSession(sessionId, session);
    persistentConfig.addSessionToHistory(sessionId, providerType, model);
    logger.info(`✓ Created session ${sessionId} with ${provider.name}/${model}`);
    return session;
  }

  async sendMessage(sessionId, message) {
    const session = persistentStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const provider = this.providers.get(session.providerType);
    if (!provider) {
      throw new Error(`Provider ${session.providerType} not connected. Please add the provider first.`);
    }

    const userMessage = {
      role: 'user',
      content: message,
      timestamp: Date.now()
    };

    session.messages.push(userMessage);
    session.lastActivity = Date.now();

    try {
      const response = await provider.chat(session.model, session.messages);
      
      const assistantMessage = {
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        metadata: {
          model: response.model,
          usage: response.usage
        }
      };

      session.messages.push(assistantMessage);
      session.lastActivity = Date.now();
      persistentStore.setSession(sessionId, session);

      return {
        sessionId,
        message: assistantMessage,
        response
      };
    } catch (error) {
      // 不在这里打印错误，让调用者处理
      throw error;
    }
  }

  async sendMessageWithHistory(sessionId, history, message) {
    const session = persistentStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const provider = this.providers.get(session.providerType);
    if (!provider) {
      throw new Error(`Provider ${session.providerType} not connected`);
    }

    const messages = [
      ...history.map(h => ({
        role: h.role,
        content: h.content
      })),
      { role: 'user', content: message }
    ];

    try {
      const response = await provider.chat(session.model, messages);
      
      return {
        sessionId,
        content: response.content,
        metadata: {
          model: response.model,
          usage: response.usage
        }
      };
    } catch (error) {
      logger.error(`✗ Session ${sessionId} error:`, error.message);
      throw error;
    }
  }

  getSession(sessionId) {
    return persistentStore.getSession(sessionId);
  }

  listSessions() {
    const sessions = persistentStore.getAllSessions();
    return sessions.map(s => ({
      id: s.id,
      providerType: s.providerType,
      model: s.model,
      messageCount: s.messages?.length || 0,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity
    }));
  }

  closeSession(sessionId) {
    const session = persistentStore.getSession(sessionId);
    if (session) {
      persistentStore.deleteSession(sessionId);
      logger.info(`✗ Closed session ${sessionId}`);
      return true;
    }
    return false;
  }

  getSessionHistory(sessionId) {
    const session = persistentStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session.messages || [];
  }
}

export const sessionManager = new SessionManager();