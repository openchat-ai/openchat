import { sessionManager } from '../../session/session-manager.js';
import { sessionEvents } from '../session-events.js';

export class SessionRepository {
  get currentProvider() {
    return undefined;
  }

  get currentModel() {
    return undefined;
  }

  getSession(sessionId) {
    return sessionManager.getSession(sessionId);
  }

  getProvider(type) {
    return sessionManager.getProvider(type);
  }

  addProvider(type, apiKey = null, endpoint = null) {
    return sessionManager.addProvider(type, apiKey, endpoint);
  }

  listProviders() {
    return sessionManager.listProviders();
  }

  createSession(providerType, model, config = {}) {
    return sessionManager.createSession(providerType, model, config);
  }

  listSessions() {
    return sessionManager.listSessions();
  }

  closeSession(sessionId) {
    return sessionManager.closeSession(sessionId);
  }

  publishEvent(sessionId, event) {
    return sessionEvents.publish(sessionId, event);
  }

  subscribe(sessionId, callback) {
    return sessionEvents.subscribe(sessionId, callback);
  }

  getEventHistory(sessionId) {
    return sessionEvents.getHistory(sessionId);
  }
}

export const sessionRepo = new SessionRepository();
