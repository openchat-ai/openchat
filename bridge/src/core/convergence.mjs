// core/convergence.mjs — merged from convergence/{convergence-engine,inductive-reasoner,natural-language-parser,prompt-builder,reasoning-engine,result-aggregator,symbolic-reasoner,theorem-db,universal-solver}.js
// 2026-06-21 (R1 cancelled, target 80 modules)

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pluginManager } from '../plugin-manager.js';
import logger from '../monitoring/logger.js';

// === ConvergenceEngine ===

class ConvergenceEngine {
  constructor(options = {}) {
    this.engines = options.engines || [];
    this.consensusThreshold = options.consensusThreshold || 0.7;
    this.minEngines = options.minEngines || 2;
  }

  async converge(problem, context = {}) {
    if (this.engines.length < this.minEngines) {
      return { converged: false, reason: 'Not enough engines' };
    }
    const results = await Promise.all(
      this.engines.map(engine => engine.solve(problem, context).catch(e => ({ error: e.message })))
    );
    const valid = results.filter(r => !r.error && r.answer);
    if (valid.length < this.minEngines) return { converged: false, results };
    const consensus = this.findConsensus(valid);
    return { converged: consensus.score >= this.consensusThreshold, consensus, results };
  }

  findConsensus(results) {
    const answers = results.map(r => r.answer);
    const counts = {};
    for (const a of answers) {
      const key = JSON.stringify(a);
      counts[key] = (counts[key] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const [topAnswer, topCount] = sorted[0];
    return { answer: JSON.parse(topAnswer), score: topCount / answers.length, agreement: topCount };
  }
}

export { ConvergenceEngine };
export const convergenceEngine = new ConvergenceEngine();

// === InductiveReasoner ===

export class InductiveReasoner {
  constructor() { this.observations = []; this.patterns = []; }
  observe(fact) { this.observations.push(fact); }
  analyze() {
    const patterns = [];
    if (this.observations.length < 3) return patterns;
    for (let i = 0; i < this.observations.length - 2; i++) {
      const o1 = this.observations[i], o2 = this.observations[i + 1], o3 = this.observations[i + 2];
      const common = Object.keys(o1).filter(k => o2[k] === o3[k] && k in o2 && k in o3);
      if (common.length > 0) patterns.push({ pattern: common, evidence: [o1, o2, o3] });
    }
    return patterns;
  }
}

// === NaturalLanguageParser ===

const COMMAND_ALIASES = { '?': 'help', 'ls': 'list', 'll': 'list --all', 'q': 'quit' };
const PROVIDER_ALIASES = { 'or': 'openrouter', 'oa': 'openai', 'an': 'anthropic', 'gm': 'gemini' };

export class NaturalLanguageParser {
  parse(input) {
    const tokens = this.tokenize(input);
    return { command: tokens[0], args: tokens.slice(1), flags: this.extractFlags(tokens) };
  }

  tokenize(input) {
    const tokens = [];
    let current = '';
    let inQuote = false;
    for (const ch of input) {
      if (ch === '"' || ch === "'") { inQuote = !inQuote; if (current) { tokens.push(current); current = ''; } continue; }
      if (ch === ' ' && !inQuote) { if (current) { tokens.push(current); current = ''; } continue; }
      current += ch;
    }
    if (current) tokens.push(current);
    return tokens;
  }

  extractFlags(tokens) {
    const flags = {};
    for (const t of tokens) {
      if (t.startsWith('--')) {
        const [k, v] = t.substring(2).split('=');
        flags[k] = v || true;
      }
    }
    return flags;
  }
}

export const naturalLanguageParser = new NaturalLanguageParser();

export function parseNaturalLanguage(input) { return naturalLanguageParser.parse(input); }

export function toCommandString(parsed) { return [parsed.command, ...parsed.args].join(' '); }

export function processInput(input) { return parseNaturalLanguage(input); }

// === PromptBuilder ===

export class PromptBuilder {
  constructor() { this.templates = new Map(); }

  registerTemplate(name, template) { this.templates.set(name, template); }

  build(templateName, context = {}) {
    const template = this.templates.get(templateName);
    if (!template) return '';
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] || '');
  }

  buildForFunctionCalling(task, tools) {
    const toolList = pluginManager.getToolsForFunctionCalling().map(t => t.function.name).join(', ');
    return `Task: ${task}\nAvailable tools: ${toolList}\nUse the most appropriate tool(s) to accomplish this task.`;
  }
}

// === ReasoningEngine ===

const RULES_DIR = join(homedir(), '.openchat', 'rules');

export class ReasoningEngine {
  constructor(options = {}) {
    this.rules = [];
    this.facts = new Map();
    this.rulesDir = options.rulesDir || RULES_DIR;
    this.loadRules();
  }

  loadRules() {
    try {
      const rulesFile = join(this.rulesDir, 'rules.json');
      if (existsSync(rulesFile)) {
        this.rules = JSON.parse(readFileSync(rulesFile, 'utf8'));
      }
    } catch (e) { logger.warn('[ReasoningEngine] Failed to load rules:', e.message); }
  }

  addFact(key, value, confidence = 1.0) { this.facts.set(key, { value, confidence, ts: Date.now() }); }
  getFact(key) { return this.facts.get(key); }

  reason(query) {
    const relevant = this.rules.filter(r => r.condition && query.includes(r.condition));
    return { query, rules: relevant, conclusions: relevant.map(r => r.conclusion) };
  }
}

// === ResultAggregator ===

export class ResultAggregator {
  constructor() { this.results = []; this.weights = new Map(); }

  addResult(source, result, weight = 1.0) {
    this.results.push({ source, result, weight, ts: Date.now() });
    this.weights.set(source, weight);
  }

  aggregate() {
    if (this.results.length === 0) return null;
    const totalWeight = Array.from(this.weights.values()).reduce((s, w) => s + w, 0);
    const grouped = {};
    for (const r of this.results) {
      const key = JSON.stringify(r.result);
      if (!grouped[key]) grouped[key] = { result: r.result, weight: 0, count: 0 };
      grouped[key].weight += r.weight;
      grouped[key].count++;
    }
    const sorted = Object.values(grouped).sort((a, b) => b.weight - a.weight);
    return {
      topResult: sorted[0].result,
      confidence: sorted[0].weight / totalWeight,
      agreement: sorted[0].count / this.results.length,
      alternatives: sorted.slice(1),
    };
  }
}

export const resultAggregator = new ResultAggregator();

// === SymbolicReasoner ===

export class SymbolicReasoner {
  constructor() { this.symbols = new Map(); this.rules = []; }

  defineSymbol(name, value) { this.symbols.set(name, value); }

  addRule(rule) { this.rules.push(rule); }

  apply(symbol) {
    const value = this.symbols.get(symbol);
    if (value === undefined) return null;
    for (const rule of this.rules) {
      if (rule.pattern && rule.pattern.test(String(value))) return rule.replacement;
    }
    return value;
  }
}

// === TheoremDB ===

export class TheoremDB {
  constructor() { this.theorems = new Map(); }

  add(name, theorem) { this.theorems.set(name, { ...theorem, addedAt: Date.now() }); }

  get(name) { return this.theorems.get(name); }

  search(query) {
    const results = [];
    for (const [name, theorem] of this.theorems) {
      if (theorem.tags?.some(t => query.includes(t)) || name.includes(query)) results.push({ name, theorem });
    }
    return results;
  }
}

// === UniversalSolver ===

export class UniversalSolver {
  constructor() {
    this.solvers = [];
    this.cache = new Map();
  }

  registerSolver(solver) { this.solvers.push(solver); }

  async solve(problem, context = {}) {
    const cacheKey = `${JSON.stringify(problem)}_${JSON.stringify(context)}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    for (const solver of this.solvers) {
      try {
        const result = await solver.solve(problem, context);
        if (result && !result.error) {
          this.cache.set(cacheKey, result);
          return result;
        }
      } catch (e) { logger.warn('[UniversalSolver] solver failed:', e.message); }
    }
    return { error: 'No solver succeeded', problem };
  }
}
