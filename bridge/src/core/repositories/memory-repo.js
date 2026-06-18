import { memoryManager } from '../../memory/memory-manager.js';
import { knowledgeNetwork } from '../memory/knowledge-network.js';
import { getEnhancedMemoryManager } from '../memory/memory-manager-enhanced.js';

export class MemoryRepository {
  getSessionContext(sessionId) {
    return memoryManager.getContext(sessionId);
  }

  addMessage(sessionId, role, content, metadata = {}) {
    return memoryManager.addMessage(sessionId, role, content, metadata);
  }

  retrieveRelevantContext(query, options = {}) {
    return memoryManager.retrieveRelevantContext(query, options);
  }

  getMemoryManager() {
    return memoryManager;
  }

  getEnhancedMemoryManager(options = {}) {
    return getEnhancedMemoryManager(options);
  }

  getKnowledgeNetwork() {
    return knowledgeNetwork;
  }

  queryKnowledge(query, options = {}) {
    return knowledgeNetwork.getKnowledge(query, options);
  }
}

export const memoryRepo = new MemoryRepository();
