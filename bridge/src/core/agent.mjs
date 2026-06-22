// core/agent.mjs — merged from agent/* (16 files)
// 2026-06-21 (R1 cancelled, target 80 modules)

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { join } from 'path';
import { homedir } from 'os';
import logger from './logger.js';

// === AgentCommunicationProtocol ===

export const MESSAGE_TYPES = { REQUEST: 'request', RESPONSE: 'response', NOTIFY: 'notify', BROADCAST: 'broadcast' };

export class AgentCommunicationProtocol {
  constructor() { this.handlers = new Map(); this.messageLog = []; }

  registerHandler(type, handler) { this.handlers.set(type, handler); }

  async send(type, payload) {
    const message = { type, payload, ts: Date.now(), id: `msg_${Date.now()}` };
    this.messageLog.push(message);
    const handler = this.handlers.get(type);
    if (handler) return await handler(payload);
    return null;
  }

  broadcast(payload) {
    for (const [type, handler] of this.handlers) this.send(type, payload);
  }
}

// === HttpExecutor ===

const MAX_GLOBAL_CONCURRENT = parseInt(process.env.MAX_GLOBAL_CONCURRENT_REQUESTS, 10) || 4;
const _globalQueue = [];

export class HttpExecutor {
  constructor() { this.executing = 0; this.queue = []; }

  async execute(fn) {
    if (this.executing >= MAX_GLOBAL_CONCURRENT) {
      return new Promise((resolve, reject) => { this.queue.push({ fn, resolve, reject }); });
    }
    this.executing++;
    try { return await fn(); } finally { this.executing--; this._processQueue(); }
  }

  _processQueue() {
    while (this.queue.length > 0 && this.executing < MAX_GLOBAL_CONCURRENT) {
      const { fn, resolve, reject } = this.queue.shift();
      this.executing++;
      fn().then(resolve, reject).finally(() => { this.executing--; this._processQueue(); });
    }
  }
}

// === AgentMonitor ===

const MONITOR_INTERVAL = 5000;
const STATE_FILE_AGENT = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'agent-state.json');
const HISTORY_FILE_AGENT = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'agent-history.json');

export const AgentState = { IDLE: 'idle', BUSY: 'busy', ERROR: 'error', OFFLINE: 'offline' };

export class AgentMonitor {
  constructor() { this.agents = new Map(); this.history = []; this.interval = null; }

  register(agentId, session) { this.agents.set(agentId, { session, state: AgentState.IDLE, lastHeartbeat: Date.now() }); }

  recordHeartbeat(agentId) { const a = this.agents.get(agentId); if (a) a.lastHeartbeat = Date.now(); }

  setState(agentId, state) { const a = this.agents.get(agentId); if (a) a.state = state; }

  async saveState() {
    try {
      const dir = path.dirname(STATE_FILE_AGENT);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data = Array.from(this.agents.entries()).map(([id, a]) => ({ id, state: a.state, lastHeartbeat: a.lastHeartbeat }));
      writeFileSync(STATE_FILE_AGENT, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) { logger.warn('[AgentMonitor] saveState failed:', e.message); }
  }

  async loadState() {
    try {
      if (existsSync(STATE_FILE_AGENT)) {
        const data = JSON.parse(readFileSync(STATE_FILE_AGENT, 'utf8'));
        for (const { id, state, lastHeartbeat } of data) this.agents.set(id, { session: null, state, lastHeartbeat });
      }
    } catch (e) { logger.warn('[AgentMonitor] loadState failed:', e.message); }
  }

  startMonitoring() {
    if (this.interval) return;
    this.interval = setInterval(() => {
      const now = Date.now();
      for (const [id, a] of this.agents) {
        if (now - a.lastHeartbeat > 30000 && a.state !== AgentState.OFFLINE) {
          a.state = AgentState.OFFLINE;
          this.history.push({ id, state: AgentState.OFFLINE, ts: now });
        }
      }
      this.saveState();
    }, MONITOR_INTERVAL);
  }

  stopMonitoring() { if (this.interval) clearInterval(this.interval); this.interval = null; }

  getStats() { return { agentCount: this.agents.size, byState: {} }; }
}

export const agentMonitor = new AgentMonitor();

// === AgentResponseProcessor ===

export class AgentResponseProcessor {
  constructor() { this.streamingValidator = null; }

  process(response) {
    return { success: true, content: response, processed: true };
  }

  validate(response) {
    if (!response || typeof response !== 'string') return { valid: false, reason: 'Empty response' };
    return { valid: true };
  }
}

// === AgentSafetyProxy ===

function createSafetyProxy(session) {
  return new Proxy(session, {
    get(target, prop) {
      if (prop === 'run') return async (...args) => {
        try { return await target.run(...args); }
        catch (e) { logger.error('[SafetyProxy] run error:', e.message); throw e; }
      };
      return target[prop];
    },
  });
}

function createSafeAgentSession(agentId, config = {}) {
  return { agentId, config, safe: true, run: async () => null };
}

export { createSafetyProxy, createSafeAgentSession };

// === AgentSession ===

const HEARTBEAT_INTERVAL = 5000;

export const AGENT_STATES = { IDLE: 'idle', RUNNING: 'running', ERROR: 'error', STOPPED: 'stopped', READY: 'ready', TERMINATED: 'terminated' };

export class AgentSession {
  constructor(agentId, config = {}) {
    this.agentId = agentId;
    this.config = { maxIterations: 10, ...config };
    this.state = AGENT_STATES.IDLE;
    this.createdAt = Date.now();
    this.lastHeartbeat = Date.now();
    this.history = [];
    this.context = {};
    this.messages = [];
    this.iterationCount = 0;
    this._isDestroyed = false;
    this._heartbeatInterval = null;
  }

  async initialize() {
    if (this._isDestroyed) throw new Error('AgentSession is destroyed');
    this.state = AGENT_STATES.READY;
    agentMonitor.register(this.agentId, this);
    this._heartbeatInterval = setInterval(() => { this.lastHeartbeat = Date.now(); }, 5000);
    return true;
  }

  async run(input) {
    if (this._isDestroyed) throw new Error('AgentSession is destroyed');
    this.state = AGENT_STATES.RUNNING;
    this.lastHeartbeat = Date.now();
    try { return await this._execute(input); }
    catch (e) { this.state = AGENT_STATES.ERROR; throw e; }
    finally { this.lastHeartbeat = Date.now(); }
  }

  async _execute(input) {
    const provider = this.config.provider || 'openrouter';
    const model = this.config.model || 'auto';
    const httpExecutor = new HttpExecutor();
    return await httpExecutor.execute(async () => ({ content: `Echo: ${input}`, provider, model }));
  }

  addMessage(role, content) {
    if (this._isDestroyed) return;
    this.messages.push({ role, content, timestamp: Date.now() });
  }

  async think() {
    if (this._isDestroyed) throw new Error('AgentSession is destroyed');
    if (this.iterationCount >= (this.config.maxIterations || 10)) throw new Error('Max iterations exceeded');
    this.iterationCount++;
    this.state = AGENT_STATES.RUNNING;
  }

  sendTo(_target, _msg) { if (this._isDestroyed) return; }
  broadcast(_msg) { if (this._isDestroyed) return; }
  delegateTo(_target, _task) { if (this._isDestroyed) return; }

  destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    this.state = AGENT_STATES.TERMINATED;
    if (this._heartbeatInterval) { clearInterval(this._heartbeatInterval); this._heartbeatInterval = null; }
    agentMonitor.setState(this.agentId, AGENT_STATES.TERMINATED);
  }

  cleanup() {
    if (this._heartbeatInterval) { clearInterval(this._heartbeatInterval); this._heartbeatInterval = null; }
    this.state = AGENT_STATES.STOPPED;
    agentMonitor.setState(this.agentId, AGENT_STATES.STOPPED);
  }

  getStatus() {
    return {
      agentId: this.agentId,
      name: this.config.name,
      state: this.state,
      uptime: Date.now() - this.createdAt,
      isDestroyed: this._isDestroyed,
      iterationCount: this.iterationCount,
      maxIterations: this.config.maxIterations,
    };
  }
}

export { createSafetyProxy as createSafetyProxyAgent, createSafeAgentSession as createSafeAgentSessionFromAgent };

// === AIPerson / Permissions ===

export const PERMISSION_LEVEL = { READ: 1, WRITE: 2, EXECUTE: 3, ADMIN: 4 };

export class AIPerson {
  constructor(id, name, type = 'general') { this.id = id; this.name = name; this.type = type; this.permission = PERMISSION_LEVEL.READ; this.createdAt = Date.now(); }
  setPermission(level) { this.permission = level; }
  canPerform(level) { return this.permission >= level; }
}

export const aiPersonRegistry = new Map();

// === DeityGovernance ===

export const DEITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, SUPREME: 4 };
export const GROUP_RULES = { majority: 0.5, supermajority: 0.67, unanimous: 1.0 };

export class DeityGovernance {
  constructor() { this.deities = new Map(); }
  register(deity) { this.deities.set(deity.id, deity); }
  decide(group, proposal) {
    const votes = Array.from(this.deities.values()).filter(d => d.canPerform(PERMISSION_LEVEL.ADMIN));
    const approveCount = votes.filter(d => Math.random() > 0.5).length;
    return { approved: approveCount / votes.length >= GROUP_RULES.majority, votes: approveCount, total: votes.length };
  }
}

export const deityGovernance = new DeityGovernance();

// === DeitySystem / ComplianceMonitor ===

export const DEITY_TYPE = { CREATOR: 'creator', GUARDIAN: 'guardian', SAGE: 'sage', MESSENGER: 'messenger' };
const DEITY_PERMISSIONS = { CREATOR: 4, GUARDIAN: 3, SAGE: 2, MESSENGER: 1 };

export class Deity extends AIPerson {
  constructor(id, name, type = DEITY_TYPE.GUARDIAN) {
    super(id, name, type);
    this.rank = DEITY_PERMISSIONS[type] || 1;
    this.setPermission(this.rank);
  }
}

export class ComplianceMonitor {
  constructor() { this.violations = []; }
  report(violation) { this.violations.push({ ...violation, ts: Date.now() }); }
  getReport() { return this.violations; }
}

export class DeitySystemManager {
  constructor() { this.deities = new Map(); this.compliance = new ComplianceMonitor(); }
  addDeity(deity) { this.deities.set(deity.id, deity); deityGovernance.register(deity); }
  check(action) { return this.compliance; }
}

// === IdentityGenerator ===

const HARMONY_MAP = {
  wood: { element: 'wood', color: 'green', season: 'spring', virtue: 'growth' },
  fire: { element: 'fire', color: 'red', season: 'summer', virtue: 'passion' },
  earth: { element: 'earth', color: 'yellow', season: 'late-summer', virtue: 'stability' },
  metal: { element: 'metal', color: 'white', season: 'autumn', virtue: 'clarity' },
  water: { element: 'water', color: 'black', season: 'winter', virtue: 'wisdom' },
};

export class IdentityGenerator {
  constructor() { this.harmonies = HARMONY_MAP; }
  generate(seed) {
    const harmonyKeys = Object.keys(this.harmonies);
    const harmony = this.harmonies[harmonyKeys[seed % harmonyKeys.length]];
    return { id: `identity_${seed}`, seed, harmony, createdAt: Date.now() };
  }
}

export const identityGenerator = new IdentityGenerator();

// === Orchestrator ===

export const OrchestratorEvents = { START: 'start', STOP: 'stop', STEP: 'step', COMPLETE: 'complete', ERROR: 'error' };
export const AgentEvents = OrchestratorEvents;

let _injectedTools = [];
function _getFC() { return []; }
function _knownNames() { return new Set(_injectedTools.map(t => t.function.name)); }
function mapActionToCommand(name, args) { return { name, args }; }

export function injectCodingTools(tools, execFn) { _injectedTools = tools; }

export class Orchestrator {
  constructor() { this.events = []; this.handlers = new Map(); }
  on(event, handler) { this.handlers.set(event, handler); }
  emit(event, data) { this.events.push({ event, data, ts: Date.now() }); const h = this.handlers.get(event); if (h) h(data); }
  async run(task, options = {}) { this.emit(OrchestratorEvents.START, { task }); return { task, success: true }; }
}

export const orchestrator = new Orchestrator();

// === Resident Decisions ===

const HEALTH_NORMAL_RD = 70, HEALTH_WARNING_RD = 30;
const DECISION_MATRIX_RD = { growth: 0.5, decay: -0.3, social: 0.2 };
const ARCHETYPES_RD = { scholar: { traits: ['curious'], weight: 0.3 }, artist: { traits: ['creative'], weight: 0.3 }, guardian: { traits: ['protective'], weight: 0.4 } };

export function matchArchetype(traits) { return Object.entries(ARCHETYPES_RD).map(([name, def]) => ({ name, score: def.weight })).sort((a, b) => b.score - a.score)[0]; }
export function computeInertia(archetypeMatch, recentActivities, healthScore) { return { inertia: recentActivities.length * 0.1, health: healthScore }; }
export function detectEvents(resident, healthScore, recentActivities) { const events = []; if (healthScore < HEALTH_WARNING_RD) events.push({ type: 'health_warning' }); return events; }
export function getHealthBand(score) { if (score >= HEALTH_NORMAL_RD) return 'normal'; if (score >= HEALTH_WARNING_RD) return 'warning'; return 'danger'; }
export function decideActions(resident, healthScore) { return [{ action: 'rest', priority: healthScore < HEALTH_NORMAL_RD ? 1 : 0 }]; }
export function actionPrompt(resident, action, context = {}) { return `Please ${action} based on your role.`; }
export function preferredHouseType(resident) { return 'study'; }
export const DECISION_MATRIX = DECISION_MATRIX_RD;
export const ARCHETYPES = ARCHETYPES_RD;

// === Resident IO ===

const DATA_FILE_RESIDENT = path.join(os.homedir(), '.openchat', 'residents.json');

function ensureFile_resident() { const dir = path.dirname(DATA_FILE_RESIDENT); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); if (!existsSync(DATA_FILE_RESIDENT)) writeFileSync(DATA_FILE_RESIDENT, '[]', 'utf8'); }
function readAll_residents() { ensureFile_resident(); try { return JSON.parse(readFileSync(DATA_FILE_RESIDENT, 'utf8')); } catch (e) { return []; } }
function writeAll_residents(residents) { ensureFile_resident(); writeFileSync(DATA_FILE_RESIDENT, JSON.stringify(residents, null, 2), 'utf8'); }

export { ensureFile_resident as ensureFile, readAll_residents as readAll, writeAll_residents as writeAll };

// === Resident Traits ===

const TRAIT_POOL_RT = { curiosity: 0.8, creativity: 0.7, diligence: 0.9, empathy: 0.85, wisdom: 0.6 };
const TRAIT_KEYS_RT = Object.keys(TRAIT_POOL_RT);

function createTraits_rt(dominantTrait) { return { [dominantTrait]: TRAIT_POOL_RT[dominantTrait] || 0.5 }; }
function randomTraits_rt() { const t = {}; for (const k of TRAIT_KEYS_RT) t[k] = Math.random(); return t; }
function inheritTraits_rt(parentTraits) { const child = randomTraits_rt(); for (const k of Object.keys(parentTraits || {})) child[k] = (child[k] + parentTraits[k]) / 2; return child; }
function traitsToLabels_rt(traits) { return Object.entries(traits || {}).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(','); }

export { TRAIT_POOL_RT as TRAIT_POOL, TRAIT_KEYS_RT as TRAIT_KEYS, createTraits_rt as createTraits, randomTraits_rt as randomTraits, inheritTraits_rt as inheritTraits, traitsToLabels_rt as traitsToLabels };

// === ResidentManager ===

function migrateSafeHouse(house) { return { ...house, migrated: true }; }

export class ResidentManager extends EventEmitter {
  constructor() { super(); this.residents = readAll_residents(); }
  list(filter) { return this.residents.filter(r => !filter || r.type === filter); }
  get(id) { return this.residents.find(r => r.id === id); }
  add(resident) { this.residents.push(resident); writeAll_residents(this.residents); this.emit('add', resident); }
  update(id, patch) { const r = this.get(id); if (r) { Object.assign(r, patch); writeAll_residents(this.residents); this.emit('update', r); } return r; }
  remove(id) { this.residents = this.residents.filter(r => r.id !== id); writeAll_residents(this.residents); this.emit('remove', { id }); }
}

export const residentManager = new ResidentManager();

export { migrateSafeHouse };

// === ResidentScheduler ===

const TICK_INTERVAL = parseInt(process.env.RESIDENT_TICK_INTERVAL_MS, 10) || 60_000;
const MAX_CONCURRENT_AGENTS = parseInt(process.env.RESIDENT_MAX_CONCURRENT_AGENTS, 10) || 2;
const MS_PER_DAY = 86400000;
const ROUTINE_SKIP_LLM_AFTER = 5;
const CONVERGENCE_ROLES = { scholar: 'study', artist: 'create', guardian: 'protect' };

export class ResidentScheduler {
  constructor() { this.tickInterval = null; this.lastTick = 0; }
  start() { if (this.tickInterval) return; this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL); }
  stop() { if (this.tickInterval) clearInterval(this.tickInterval); this.tickInterval = null; }
  async tick() {
    this.lastTick = Date.now();
    const residents = residentManager.list(null);
    for (const resident of residents) await this._processResident(resident);
  }
  async _processResident(resident) {
    const events = detectEvents(resident, 70, []);
    const actions = decideActions(resident, 70);
    return { residentId: resident.id, events, actions };
  }
}

export const residentScheduler = new ResidentScheduler();

// === Sage ===

const DATA_FILE_SAGE = path.join(os.homedir(), '.openchat', 'sage.json');

function ensureFile_sage() { const dir = path.dirname(DATA_FILE_SAGE); if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); if (!existsSync(DATA_FILE_SAGE)) writeFileSync(DATA_FILE_SAGE, '[]', 'utf8'); }
function readAll_sage() { ensureFile_sage(); try { return JSON.parse(readFileSync(DATA_FILE_SAGE, 'utf8')); } catch (e) { return []; } }
function writeAll_sage(data) { ensureFile_sage(); writeFileSync(DATA_FILE_SAGE, JSON.stringify(data, null, 2), 'utf8'); }

export class SageManager {
  constructor() { this.sages = readAll_sage(); }
  list() { return this.sages; }
  add(sage) { this.sages.push(sage); writeAll_sage(this.sages); }
  get(id) { return this.sages.find(s => s.id === id); }
}

export const sageManager = new SageManager();
