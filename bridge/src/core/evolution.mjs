// core/evolution.mjs — merged from evolution/{evolution-cli,evolution-engine,evolution-memory,evolution-system,generalization,self-evolution,self-learner,skill-manager}.js
// 2026-06-21 (R1 cancelled, target 80 modules)

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../experiments/lib/misc-lib.mjs';
import { vectorMemory } from '../memory/vector-memory.js';

// === EvolutionMemory ===

const MEMORY_FILE = path.join(os.homedir(), '.openchat', 'memory', 'evolution-memory.json');

export class EvolutionMemory {
  constructor(filePath = MEMORY_FILE) { this.filePath = filePath; this.memories = new Map(); this.load(); }

  load() {
    try { if (existsSync(this.filePath)) this.memories = new Map(Object.entries(JSON.parse(fs.readFileSync(this.filePath, 'utf8')))); } catch (e) {}
  }

  save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.memories), null, 2), 'utf8');
    } catch (e) { logger.warn('[EvolutionMemory] save failed:', e.message); }
  }

  remember(key, value, metadata = {}) { this.memories.set(key, { value, metadata, ts: Date.now() }); this.save(); return true; }
  recall(key) { return this.memories.get(key); }
  search(query, options = {}) {
    const results = [];
    for (const [key, mem] of this.memories) {
      if (key.includes(query) || JSON.stringify(mem.value).includes(query)) results.push({ key, ...mem, score: 1 });
    }
    return results.slice(0, options.limit || 10);
  }

  rememberProgress(task, status = 'in-progress', details = {}) {
    return this.remember(`progress:${task}`, { status, details, ts: Date.now() });
  }

  getProgress(task) { return this.recall(`progress:${task}`); }
  updateProgress(task, status, details = {}) { return this.rememberProgress(task, status, details); }
}

// === EvolutionEngine ===

const EXPERIENCES_FILE = path.join(os.homedir(), '.openchat', 'memory', 'evolution-experiences.json');

export class EvolutionEngine {
  constructor() { this.memory = new EvolutionMemory(); this.experiences = []; this.skillManager = new SkillManager(); }

  learn(task, result) {
    const experience = { task, result, ts: Date.now(), success: result.ok || false };
    this.experiences.push(experience);
    this.memory.remember(`experience:${Date.now()}`, experience, { type: 'evolution' });
    return experience;
  }

  async evolve(target) {
    return { evolved: true, target, ts: Date.now() };
  }
}

class RobustErrorHandler {
  constructor() { this.retries = 0; }
  handle(error) { this.retries++; return { retryable: this.retries < 3, error }; }
}

// === EvolutionCLI ===

class EvolutionCLI {
  constructor() { this.evolutionSystem = new EvolutionSystem(); this.commands = new Map(); this.registerCommands(); }

  registerCommands() {
    this.commands.set('start', () => this.evolutionSystem.start());
    this.commands.set('stop', () => this.evolutionSystem.stop());
    this.commands.set('status', () => this.evolutionSystem.getStatus());
    this.commands.set('learn', (args) => this.evolutionSystem.learn(args.join(' ')));
  }

  async run(command, args = []) {
    const handler = this.commands.get(command);
    if (!handler) return { error: `Unknown command: ${command}` };
    try { return await handler(args); } catch (e) { return { error: e.message }; }
  }
}

export { EvolutionCLI };

// === SkillManager ===

class SkillManager {
  constructor() { this.skills = new Map(); }

  registerSkill(name, skill) { this.skills.set(name, { ...skill, registeredAt: Date.now() }); }
  getSkill(name) { return this.skills.get(name); }
  listSkills() { return Array.from(this.skills.entries()); }
  executeSkill(name, params) { const skill = this.skills.get(name); if (!skill) throw new Error(`Skill not found: ${name}`); return skill.handler(params); }
}

export { SkillManager };

// === EvolutionSystem ===

export class EvolutionSystem {
  constructor() {
    this.skillManager = new SkillManager();
    this.engine = new EvolutionEngine();
    this.running = false;
    this.stats = { cycles: 0, improvements: 0, regressions: 0 };
  }

  async start() { this.running = true; return { started: true }; }
  async stop() { this.running = false; return { stopped: true }; }
  getStatus() { return { running: this.running, ...this.stats }; }
  async learn(task) { return this.engine.learn(task, { ok: true }); }
}

export const evolutionSystem = new EvolutionSystem();

// === GeneralizationEngineV2 ===

class GeneralizationEngineV2 {
  constructor() { this.vectorMemory = vectorMemory; }

  async generalize(pattern, examples) {
    const result = { pattern, generalization: pattern, confidence: 0.8, examples: examples.length };
    this.vectorMemory.addKnowledge(`generalization:${Date.now()}`, result);
    return result;
  }
}

export { GeneralizationEngineV2 };
export const generalizationEngineV2 = new GeneralizationEngineV2();

// === SelfEvolution ===

const EVO_DIR = join(homedir(), '.openchat', 'evolution');
const STRATEGY_STATS_FILE = join(EVO_DIR, 'strategy-stats.json');
const PROMPT_VERSIONS_FILE = join(EVO_DIR, 'prompt-versions.json');

export class SelfEvolution {
  constructor() { this.strategies = new Map(); this.promptVersions = new Map(); this.ensureDir(); this.load(); }

  ensureDir() { if (!existsSync(EVO_DIR)) mkdirSync(EVO_DIR, { recursive: true }); }

  load() {
    try { if (existsSync(STRATEGY_STATS_FILE)) this.strategies = new Map(Object.entries(JSON.parse(readFileSync(STRATEGY_STATS_FILE, 'utf8')))); } catch (e) {}
    try { if (existsSync(PROMPT_VERSIONS_FILE)) this.promptVersions = new Map(Object.entries(JSON.parse(readFileSync(PROMPT_VERSIONS_FILE, 'utf8')))); } catch (e) {}
  }

  save() {
    try { writeFileSync(STRATEGY_STATS_FILE, JSON.stringify(Object.fromEntries(this.strategies), null, 2), 'utf8'); } catch (e) {}
    try { writeFileSync(PROMPT_VERSIONS_FILE, JSON.stringify(Object.fromEntries(this.promptVersions), null, 2), 'utf8'); } catch (e) {}
  }

  recordStrategy(name, result) { const cur = this.strategies.get(name) || { wins: 0, losses: 0 }; if (result.success) cur.wins++; else cur.losses++; this.strategies.set(name, cur); this.save(); }
  recordPromptVersion(version, content) { this.promptVersions.set(version, content); this.save(); }
}

// === SelfLearner ===

export class SelfLearner {
  constructor() { this.knowledge = new Map(); }

  learn(topic, info) {
    if (!this.knowledge.has(topic)) this.knowledge.set(topic, []);
    this.knowledge.get(topic).push({ info, ts: Date.now() });
  }

  recall(topic) { return this.knowledge.get(topic) || []; }
}

