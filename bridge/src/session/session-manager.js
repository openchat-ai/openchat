import { sessionManager as sm } from '../core/runtime.mjs';
import { persistentStore } from '../storage/persistent-store.js';

sm.removeProvider = async function(type) {
  const provider = this.providers.get(type);
  if (!provider) throw new Error(`Provider ${type} not found`);
  await provider.disconnect();
  this.providers.delete(type);
  console.debug(`✗ Disconnected from ${provider.name}`);
};

sm.addProviderDirect = function(provider) {
  this.providers.set(provider.id, provider);
};

sm.sendMessage = async function(sessionId, message) {
  const session = persistentStore.getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  const provider = this.providers.get(session.providerType);
  if (!provider) throw new Error(`Provider ${session.providerType} not connected`);
  const userMessage = { role: 'user', content: message, timestamp: Date.now() };
  session.messages.push(userMessage);
  session.lastActivity = Date.now();
  try {
    const response = await provider.chat(session.model, session.messages);
    const assistantMessage = {
      role: 'assistant', content: response.content, timestamp: Date.now(),
      metadata: { model: response.model, usage: response.usage }
    };
    session.messages.push(assistantMessage);
    session.lastActivity = Date.now();
    persistentStore.setSession(sessionId, session);
    return { sessionId, message: assistantMessage, response };
  } catch (error) { throw error; }
};

sm.closeSession = function(sessionId) {
  const session = persistentStore.getSession(sessionId);
  if (session) { persistentStore.deleteSession(sessionId); return true; }
  return false;
};

sm.getSessionHistory = function(sessionId) {
  const session = persistentStore.getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return session.messages || [];
};

export const sessionManager = sm;
