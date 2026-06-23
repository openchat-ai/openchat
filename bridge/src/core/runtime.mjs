import crypto, { createHash } from 'crypto';

const MAX_SIZE = 500;
const TTL_MS = 7 * 24 * 3600 * 1000;
const store = new Map();

function makeKey(text, model) {
  return createHash('sha256')
    .update(text.trim().toLowerCase() + '|' + model)
    .digest('hex')
    .slice(0, 16);
}

function isCacheable(text) {
  if (!text || text.length > 50) return false;
  return /^[\u4e00-\u9fff\w\s,.\?!]+$/.test(text);
}

function cacheGet(text, model) {
  const key = makeKey(text, model);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

function cacheSet(text, model, value) {
  if (!isCacheable(text)) return;
  const key = makeKey(text, model);
  if (store.has(key)) store.delete(key);
  store.set(key, { value, ts: Date.now() });
  if (store.size > MAX_SIZE) {
    const firstKey = store.keys().next().value;
    store.delete(firstKey);
  }
}

class SessionEvents {
  constructor() {
    this.subscribers = new Map();
    this.history = new Map();
    this.activeTasks = new Map();
  }

  publish(sessionId, event) {
    if (!sessionId) return;
    const enriched = { ...event, sessionId, ts: Date.now() };
    if (!this.history.has(sessionId)) this.history.set(sessionId, []);
    const hist = this.history.get(sessionId);
    hist.push(enriched);
    if (hist.length > 200) hist.shift();
    if (!this.activeTasks.has(sessionId)) this.activeTasks.set(sessionId, {});
    this.activeTasks.get(sessionId).lastEventAt = Date.now();
    const subs = this.subscribers.get(sessionId);
    if (subs) for (const cb of subs) {
      try { cb(enriched); } catch (e) { console.error('[C0]', e); }
    }
  }

  subscribe(sessionId, callback) {
    if (!this.subscribers.has(sessionId)) this.subscribers.set(sessionId, new Set());
    this.subscribers.get(sessionId).add(callback);
    const hist = this.history.get(sessionId) || [];
    for (const ev of hist) {
      try { callback(ev); } catch (e) { console.error('[C0]', e); }
    }
    return () => this.unsubscribe(sessionId, callback);
  }

  unsubscribe(sessionId, callback) {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) this.subscribers.delete(sessionId);
    }
  }

  list() {
    const all = new Set([
      ...this.subscribers.keys(),
      ...this.history.keys(),
      ...this.activeTasks.keys()
    ]);
    return [...all].map(sid => {
      const meta = this.activeTasks.get(sid) || {};
      const eventCount = (this.history.get(sid) || []).length;
      const subscriberCount = (this.subscribers.get(sid) || new Set()).size;
      return { sessionId: sid, lastEventAt: meta.lastEventAt || 0, eventCount, subscriberCount };
    }).sort((a, b) => b.lastEventAt - a.lastEventAt);
  }

  getHistory(sessionId) {
    return this.history.get(sessionId) || [];
  }
}

import { createProvider } from 'provider-kit';
import { persistentConfig } from './core-config.mjs';
import { persistentStore } from '../storage/persistent-store.js';

class SessionManager {
  constructor() {
    this.providers = new Map();
  }

  async addProvider(type, apiKey = null, endpoint = null) {
    if (this.providers.has(type)) {
      const existing = this.providers.get(type);
      if (existing.connected) return existing;
      this.providers.delete(type);
    }
    const effectiveKey = apiKey || persistentConfig.getApiKey(type);
    if (!effectiveKey) {
      throw new Error(`No API key for ${type}. Set with: config set ${type} <api_key>`);
    }
    const provider = createProvider(type, effectiveKey);
    if (!provider) throw new Error(`Unknown provider type: ${type}`);
    await provider.connect();
    this.providers.set(type, provider);
    console.info(`✓ Connected to ${provider.name}`);
    return provider;
  }

  getProvider(type) { return this.providers.get(type); }

  listProviders() {
    return Array.from(this.providers.entries()).map(([type, p]) => ({
      type, name: p.name, connected: p.connected,
    }));
  }

  createSession(providerType, model, config = {}) {
    const provider = this.providers.get(providerType);
    if (!provider) throw new Error(`Provider ${providerType} not connected`);
    const sessionId = crypto.randomUUID();
    const session = { id: sessionId, providerType, model, config, messages: [], createdAt: Date.now(), lastActivity: Date.now() };
    persistentStore.setSession(sessionId, session);
    return session;
  }

  getSession(sessionId) { return persistentStore.getSession(sessionId); }

  listSessions() { return persistentStore.getAllSessions(); }
}

export const sessionEvents = new SessionEvents();
export const sessionManager = new SessionManager();
export { cacheGet as get, cacheSet as set, isCacheable };
