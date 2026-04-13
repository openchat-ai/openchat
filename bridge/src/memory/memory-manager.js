/**
 * MemoryManager handles the three layers of memory:
 * 1. Short-term (Context Window)
 * 2. Long-term (Knowledge/User Profile)
 * 3. Programmatic (Skills/Proven Paths)
 */
export class MemoryManager {
  constructor() {
    this.shortTerm = new Map(); // sessionId -> message[]
    this.longTerm = new Map();  // userId -> { profiles, facts }
    this.skillStore = new Map(); // skillName -> { sequence, description }
  }

  /**
   * Manage Short-term memory with a sliding window and importance weighting
   */
  async addMessage(sessionId, role, content, metadata = {}) {
    if (!this.shortTerm.has(sessionId)) {
      this.shortTerm.set(sessionId, []);
    }
    
    const history = this.shortTerm.get(sessionId);
    history.push({ role, content, timestamp: Date.now(), ...metadata });
    
    // Simple windowing: keep last 50 messages (will be improved with token-counting)
    if (history.length > 50) {
      history.shift();
    }
  }

  async getContext(sessionId) {
    return this.shortTerm.get(sessionId) || [];
  }

  /**
   * Long-term memory: Store user preferences or project facts
   */
  async saveFact(userId, fact) {
    if (!this.longTerm.has(userId)) {
      this.longTerm.set(userId, { profile: {}, facts: [] });
    }
    const user = this.longTerm.get(userId);
    user.facts.push({ content: fact, timestamp: Date.now() });
    console.log(`[Memory] Fact saved for user ${userId}: ${fact}`);
  }

  async queryFacts(userId, query) {
    const user = this.longTerm.get(userId);
    if (!user) return [];
    // Simple keyword search (will be upgraded to vector search/FTS5)
    return user.facts.filter(f => f.content.includes(query));
  }

  /**
   * Programmatic Memory: Save a sequence of tools as a "Skill"
   */
  async saveSkill(name, description, sequence) {
    this.skillStore.set(name, {
      name,
      description,
      sequence, // Array of { tool: 'name', args: {} }
      version: 1,
      createdAt: Date.now()
    });
    console.log(`[Memory] New Skill stored: ${name}`);
  }

  async getSkill(name) {
    return this.skillStore.get(name);
}

}

export const memoryManager = new MemoryManager();
