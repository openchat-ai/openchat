import { EvolutionMemory } from '../evolution/evolution-memory.js';

export class EvolutionRepository {
  constructor() {
    this._memory = new EvolutionMemory();
  }

  getMemory() {
    return this._memory;
  }

  remember(key, value, metadata = {}) {
    return this._memory.remember(key, value, metadata);
  }

  recall(key) {
    return this._memory.recall(key);
  }

  search(query, options = {}) {
    return this._memory.search(query, options);
  }

  rememberProgress(task, status = 'in-progress', details = {}) {
    return this._memory.rememberProgress(task, status, details);
  }

  getProgress(task) {
    return this._memory.getProgress(task);
  }

  updateProgress(task, status, details = {}) {
    return this._memory.updateProgress(task, status, details);
  }
}

export const evolutionRepo = new EvolutionRepository();
