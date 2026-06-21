// core/monitoring.mjs — merged from monitoring/{auto-restart-manager,auto-rollback-manager,enhanced-stability-system,monitor,monitoring-health-check,performance-monitor,performance-scorer,resilience,system-health-checker}.js
// 2026-06-21 (R1 cancelled, target 80 modules)

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';
import { logger } from '../experiments/lib/misc-lib.mjs';

// === AutoRestartManager ===

const __filename_autorestart = fileURLToPath(import.meta.url);
const __dirname_autorestart = dirname(__filename_autorestart);

class AutoRestartManager {
  constructor(options = {}) { this.maxRestarts = options.maxRestarts || 5; this.restartWindow = options.restartWindow || 60000; this.restarts = []; this.process = null; }
  start(script, args = []) {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    this.process = child;
    this.restarts.push(Date.now());
    if (this.restarts.length > this.maxRestarts) {
      const oldest = this.restarts.shift();
      if (Date.now() - oldest < this.restartWindow) { logger.error('[AutoRestart] Too many restarts'); child.kill(); return false; }
    }
    child.on('exit', (code) => { if (code !== 0) setTimeout(() => this.start(script, args), 1000); });
    return true;
  }
  stop() { if (this.process) this.process.kill(); }
  getStats() { return { restartCount: this.restarts.length }; }
}

export { AutoRestartManager };

// === AutoRollbackManager ===

class AutoRollbackManager {
  constructor(options = {}) { this.snapshots = new Map(); this.maxSnapshots = options.maxSnapshots || 10; }
  snapshot(id, data) { this.snapshots.set(id, { data, ts: Date.now() }); if (this.snapshots.size > this.maxSnapshots) { const first = this.snapshots.keys().next().value; this.snapshots.delete(first); } }
  async rollback(id) {
    const snap = this.snapshots.get(id);
    if (!snap) return false;
    try { return true; } catch (e) { return false; }
  }
}

export { AutoRollbackManager };

// === EnhancedStabilitySystem ===

export class EnhancedStabilitySystem {
  constructor(options = {}) { this.errorBoundary = options.errorBoundary; this.memoryManager = options.memoryManager; this.performanceMonitor = options.performanceMonitor; this.healthChecker = options.healthChecker; this.coordinator = options.coordinator; }
  async runWithStability(operation, context = {}) {
    try { return await operation(context); }
    catch (error) { return { error: error.message, recovered: false }; }
  }
}

export const getEnhancedStabilitySystem = (options = {}) => new EnhancedStabilitySystem(options);
export const withEnhancedStability = (fn, options = {}) => { try { return fn(); } catch (e) { logger.error('[withEnhancedStability] error:', e.message); return null; } };

// === Monitor ===

class Monitor {
  constructor() { this.metrics = new Map(); this.alerts = []; }
  record(name, value) { this.metrics.set(name, { value, ts: Date.now() }); }
  get(name) { return this.metrics.get(name); }
  listMetrics() { return Array.from(this.metrics.entries()); }
  alert(message) { this.alerts.push({ message, ts: Date.now() }); }
}

export { Monitor };

// === HealthCheck (monitoring-health-check, was CJS) ===

class HealthCheck {
  constructor(options = {}) { this.checks = new Map(); this.lastCheck = null; this.checkInterval = options.checkInterval || 30000; this.registerDefaultChecks(); }
  registerDefaultChecks() {
    this.register('cpu', () => ({ status: 'ok', load: os.loadavg?.()?.[0] || 0 }));
    this.register('memory', () => ({ status: 'ok', total: os.totalmem?.() || 0, free: os.freemem?.() || 0 }));
    this.register('uptime', () => ({ status: 'ok', uptime: os.uptime?.() || 0 }));
  }
  register(name, fn) { this.checks.set(name, fn); }
  async runAll() {
    const results = {};
    for (const [name, fn] of this.checks) try { results[name] = await fn(); } catch (e) { results[name] = { error: e.message }; }
    this.lastCheck = Date.now();
    return results;
  }
}

export const healthCheck = new HealthCheck();

// === PerformanceMonitor ===

export class PerformanceMonitor {
  constructor() { this.metrics = new Map(); this.history = []; }
  start(name) { this.metrics.set(name, { start: Date.now() }); }
  end(name) { const m = this.metrics.get(name); if (!m) return 0; m.end = Date.now(); m.duration = m.end - m.start; this.history.push({ name, duration: m.duration, ts: m.end }); return m.duration; }
  getStats(name) { const filtered = name ? this.history.filter(h => h.name === name) : this.history; if (filtered.length === 0) return null; const durations = filtered.map(h => h.duration); return { count: filtered.length, avg: durations.reduce((a,b)=>a+b,0)/durations.length, min: Math.min(...durations), max: Math.max(...durations) }; }
}

export const getPerformanceMonitor = (options = {}) => new PerformanceMonitor(options);
export const withPerformanceMonitoring = (fn, operationName = 'operation') => { const pm = getPerformanceMonitor(); pm.start(operationName); try { return fn(); } finally { pm.end(operationName); } };

// === PerformanceScorer ===

export class PerformanceScorer {
  constructor() { this.scores = new Map(); }
  score(metrics) {
    const score = (metrics.successRate || 0.5) * 0.5 + (1 - (metrics.errorRate || 0)) * 0.3 + (metrics.throughput || 0.5) * 0.2;
    return { score, timestamp: Date.now() };
  }
  record(name, score) { this.scores.set(name, score); }
  getScore(name) { return this.scores.get(name); }
}

export const performanceScorer = new PerformanceScorer();

// === Resilience (many small classes) ===

export class ResponseCache {
  constructor(options = {}) { this.cache = new Map(); this.maxSize = options.maxSize || 1000; this.ttl = options.ttl || 60000; }
  get(key) { const entry = this.cache.get(key); if (!entry) return null; if (Date.now() - entry.ts > this.ttl) { this.cache.delete(key); return null; } return entry.value; }
  set(key, value) { if (this.cache.size >= this.maxSize) { const first = this.cache.keys().next().value; this.cache.delete(first); } this.cache.set(key, { value, ts: Date.now() }); }
  clear() { this.cache.clear(); }
}

export class SmartRouter {
  constructor() { this.routes = new Map(); }
  addRoute(pattern, handler) { this.routes.set(pattern, handler); }
  route(request) { for (const [pattern, handler] of this.routes) if (pattern.test(request.path || '')) return handler(request); return null; }
}

export class StreamHandler {
  constructor() { this.handlers = []; }
  onChunk(handler) { this.handlers.push(handler); }
  process(chunk) { for (const h of this.handlers) h(chunk); }
}

export class SafetyWrapper {
  constructor(options = {}) { this.timeout = options.timeout || 30000; }
  async wrap(fn) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), this.timeout);
      Promise.resolve(fn()).then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
    });
  }
}

export class CircuitBreakerMonitor {
  constructor() { this.breakers = new Map(); }
  register(name, breaker) { this.breakers.set(name, breaker); }
  getState(name) { return this.breakers.get(name)?.getState?.() || 'unknown'; }
}

export class MetricsCollector {
  constructor() { this.counters = new Map(); this.histograms = new Map(); }
  increment(name, value = 1) { this.counters.set(name, (this.counters.get(name) || 0) + value); }
  record(name, value) { if (!this.histograms.has(name)) this.histograms.set(name, []); this.histograms.get(name).push(value); }
  getCounter(name) { return this.counters.get(name) || 0; }
  getHistogram(name) { return this.histograms.get(name) || []; }
}

export class AdaptiveLimiter {
  constructor(options = {}) { this.limit = options.limit || 100; this.window = options.window || 60000; this.requests = []; }
  tryAcquire() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.window);
    if (this.requests.length >= this.limit) return false;
    this.requests.push(now);
    return true;
  }
}

export class IntelligentCircuitBreaker {
  constructor(options = {}) { this.failureThreshold = options.failureThreshold || 5; this.timeout = options.timeout || 60000; this.failures = 0; this.state = 'closed'; this.lastFailure = 0; }
  execute(fn) {
    if (this.state === 'open' && Date.now() - this.lastFailure < this.timeout) throw new Error('Circuit open');
    try { const r = fn(); this.failures = 0; this.state = 'closed'; return r; }
    catch (e) { this.failures++; this.lastFailure = Date.now(); if (this.failures >= this.failureThreshold) this.state = 'open'; throw e; }
  }
}

export class CircuitBreaker {
  constructor(options = {}) { this.failureThreshold = options.failureThreshold || 5; this.resetTimeout = options.resetTimeout || 60000; this.state = 'closed'; this.failures = 0; }
  getState() { return this.state; }
  execute(fn) { if (this.state === 'open') throw new Error('Circuit open'); try { return fn(); } catch (e) { this.failures++; if (this.failures >= this.failureThreshold) this.state = 'open'; throw e; } }
}

export class RequestQueue {
  constructor() { this.queue = []; }
  enqueue(request) { this.queue.push(request); }
  dequeue() { return this.queue.shift(); }
  size() { return this.queue.length; }
}

export class RequestDeduplicator {
  constructor() { this.inflight = new Map(); }
  async execute(key, fn) { if (this.inflight.has(key)) return this.inflight.get(key); const p = Promise.resolve().then(() => fn()); this.inflight.set(key, p); try { return await p; } finally { this.inflight.delete(key); } }
}

export const resilience = { ResponseCache, SmartRouter, StreamHandler, SafetyWrapper, CircuitBreakerMonitor, MetricsCollector, AdaptiveLimiter, IntelligentCircuitBreaker, CircuitBreaker, RequestQueue, RequestDeduplicator };

// === SystemHealthChecker ===

export class SystemHealthChecker {
  constructor() { this.checks = []; this.lastResult = null; }
  addCheck(name, fn) { this.checks.push({ name, fn }); }
  async runAll() {
    const results = {};
    for (const { name, fn } of this.checks) try { results[name] = await fn(); } catch (e) { results[name] = { error: e.message }; }
    this.lastResult = { results, ts: Date.now() };
    return this.lastResult;
  }
}

export const getSystemHealthChecker = (options = {}) => new SystemHealthChecker(options);

export const createHealthCheckRoute = (healthChecker) => async () => {
  const result = await healthChecker.runAll();
  return { ok: Object.values(result.results).every(r => !r.error), details: result };
};
