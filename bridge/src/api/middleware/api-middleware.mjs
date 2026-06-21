import Joi from 'joi';

class APIError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

const errorHandler = (err, req, res, next) => {
  console.error('[API Error]', err.message, err.stack);
  if (err.isJoi) return res.status(400).json({ error: 'Validation Error', details: err.details.map(d => d.message) });
  if (err.isOperational) return res.status(err.statusCode).json({ error: err.code, message: err.message });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
};

class MetricsCollector {
  constructor(options = {}) {
    this.resetInterval = options.resetInterval || 3600000;
    this.metrics = {
      requests: { total: 0, success: 0, error: 0, byEndpoint: {}, byStatus: {} },
      responseTime: { sum: 0, count: 0, min: Infinity, max: 0, p50: [], p95: [], p99: [] },
      bandwidth: { bytesIn: 0, bytesOut: 0 },
      errors: { byType: {}, recent: [] },
      uptime: { startTime: Date.now(), restartCount: 0 }
    };
    this.resetTimer = setInterval(() => this.resetHourly(), this.resetInterval);
  }

  recordRequest(endpoint, statusCode, responseTimeMs, bytesIn = 0, bytesOut = 0) {
    this.metrics.requests.total++;
    if (statusCode < 400) this.metrics.requests.success++; else this.metrics.requests.error++;
    if (!this.metrics.requests.byEndpoint[endpoint]) this.metrics.requests.byEndpoint[endpoint] = { total: 0, success: 0, error: 0 };
    this.metrics.requests.byEndpoint[endpoint].total++;
    if (statusCode < 400) this.metrics.requests.byEndpoint[endpoint].success++; else this.metrics.requests.byEndpoint[endpoint].error++;
    const statusBucket = `${Math.floor(statusCode / 100)}xx`;
    this.metrics.requests.byStatus[statusBucket] = (this.metrics.requests.byStatus[statusBucket] || 0) + 1;
    this.metrics.responseTime.sum += responseTimeMs;
    this.metrics.responseTime.count++;
    this.metrics.responseTime.min = Math.min(this.metrics.responseTime.min, responseTimeMs);
    this.metrics.responseTime.max = Math.max(this.metrics.responseTime.max, responseTimeMs);
    this.metrics.responseTime.p50.push(responseTimeMs);
    this.metrics.responseTime.p95.push(responseTimeMs);
    this.metrics.responseTime.p99.push(responseTimeMs);
    const maxSamples = 1000;
    if (this.metrics.responseTime.p50.length > maxSamples) {
      this.metrics.responseTime.p50 = this.metrics.responseTime.p50.slice(-maxSamples);
      this.metrics.responseTime.p95 = this.metrics.responseTime.p95.slice(-maxSamples);
      this.metrics.responseTime.p99 = this.metrics.responseTime.p99.slice(-maxSamples);
    }
    this.metrics.bandwidth.bytesIn += bytesIn;
    this.metrics.bandwidth.bytesOut += bytesOut;
  }

  recordError(errorType, errorMessage, endpoint) {
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;
    this.metrics.errors.recent.push({ type: errorType, message: errorMessage, endpoint, timestamp: Date.now() });
    if (this.metrics.errors.recent.length > 100) this.metrics.errors.recent = this.metrics.errors.recent.slice(-100);
  }

  getSummary() {
    const rt = this.calculatePercentiles();
    return {
      requests: { total: this.metrics.requests.total, success: this.metrics.requests.success, error: this.metrics.requests.error, successRate: this.metrics.requests.total > 0 ? (this.metrics.requests.success / this.metrics.requests.total * 100).toFixed(2) + '%' : '0%' },
      responseTime: { avg: this.metrics.responseTime.count > 0 ? (this.metrics.responseTime.sum / this.metrics.responseTime.count).toFixed(2) + 'ms' : '0ms', min: this.metrics.responseTime.min === Infinity ? '0ms' : this.metrics.responseTime.min + 'ms', max: this.metrics.responseTime.max === 0 ? '0ms' : this.metrics.responseTime.max + 'ms', p50: rt.p50, p95: rt.p95, p99: rt.p99 },
      bandwidth: { in: this.formatBytes(this.metrics.bandwidth.bytesIn), out: this.formatBytes(this.metrics.bandwidth.bytesOut) },
      uptime: { seconds: Math.floor((Date.now() - this.metrics.uptime.startTime) / 1000), restartCount: this.metrics.uptime.restartCount }
    };
  }

  getDetailed() {
    return { ...this.metrics, endpoints: Object.entries(this.metrics.requests.byEndpoint).map(([endpoint, stats]) => ({ endpoint, ...stats, successRate: stats.total > 0 ? (stats.success / stats.total * 100).toFixed(2) + '%' : '0%' })) };
  }

  calculatePercentiles() {
    const calc = (arr) => { if (arr.length === 0) return '0ms'; const sorted = arr.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length * 0.5)] + 'ms'; };
    return { p50: calc(this.metrics.responseTime.p50), p95: calc(this.metrics.responseTime.p95), p99: calc(this.metrics.responseTime.p99) };
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
    return (bytes / Math.pow(k, Math.floor(Math.log(bytes) / Math.log(k)))).toFixed(2) + ' ' + sizes[Math.floor(Math.log(bytes) / Math.log(k))];
  }

  resetHourly() {
    this.metrics.responseTime = { sum: 0, count: 0, min: Infinity, max: 0, p50: [], p95: [], p99: [] };
  }

  reset() {
    this.metrics = {
      requests: { total: 0, success: 0, error: 0, byEndpoint: {}, byStatus: {} },
      responseTime: { sum: 0, count: 0, min: Infinity, max: 0, p50: [], p95: [], p99: [] },
      bandwidth: { bytesIn: 0, bytesOut: 0 },
      errors: { byType: {}, recent: [] },
      uptime: { startTime: Date.now(), restartCount: this.metrics.uptime.restartCount + 1 }
    };
  }

  destroy() { if (this.resetTimer) clearInterval(this.resetTimer); }
}

const metricsCollector = new MetricsCollector();

const schemas = {
  createAgent: Joi.object({ role: Joi.string().valid('security_auditor', 'code_quality_analyzer', 'performance_analyzer', 'test_engineer', 'custom').required(), name: Joi.string().max(100), capabilities: Joi.array().items(Joi.string()), task: Joi.string().required() }),
  aggregateFeedback: Joi.object({ agentIds: Joi.array().items(Joi.string()).required(), options: Joi.object({ deduplicate: Joi.boolean().default(true), prioritize: Joi.boolean().default(true) }) }),
  createDecision: Joi.object({ type: Joi.string().valid('approve', 'reject', 'defer').required(), feedbackIds: Joi.array().items(Joi.string()).required(), reasoning: Joi.string().max(2000), metadata: Joi.object() }),
  sendMessage: Joi.object({ type: Joi.string().valid('skill_publish', 'skill_request', 'collaboration_request', 'collaboration_response', 'insight_share', 'performance_report').required(), targetPeerId: Joi.string(), payload: Joi.object().required(), priority: Joi.string().valid('CRITICAL', 'HIGH', 'NORMAL', 'LOW').default('NORMAL') }),
  connectPeer: Joi.object({ peerAddress: Joi.string().required() }),
  applyUpdate: Joi.object({ version: Joi.string().required(), autoRollbackIfFailed: Joi.boolean().default(true), preferredUpdateTime: Joi.string().valid('off_peak', 'immediate') }),
  rollbackUpdate: Joi.object({ version: Joi.string().required() }),
  createSkill: Joi.object({ name: Joi.string().max(100).required(), description: Joi.string().max(500), type: Joi.string().valid('ALGORITHM', 'MODEL', 'PATTERN').required(), code: Joi.string().required(), tests: Joi.string(), documentation: Joi.string() }),
  rateSkill: Joi.object({ skillId: Joi.string().required(), rating: Joi.number().min(1).max(5).required(), comment: Joi.string().max(500) }),
  searchSkills: Joi.object({ query: Joi.string().max(100), type: Joi.string().valid('ALGORITHM', 'MODEL', 'PATTERN'), minRating: Joi.number().min(1).max(5), limit: Joi.number().min(1).max(100).default(20) }),
  updateResourcePolicy: Joi.object({ compression: Joi.string().valid('gzip', 'brotli', 'none'), cacheEnabled: Joi.boolean(), networkMode: Joi.string().valid('WiFi', 'Mobile', 'Auto'), maxStorageMB: Joi.number().min(100) })
};

const requestValidator = (req, res, next) => {
  const route = req.path; const method = req.method;
  let schema = null;
  if (route.startsWith('/agents') && method === 'POST' && route === '/agents') schema = schemas.createAgent;
  if (route.startsWith('/feedback') && route.includes('aggregate')) schema = schemas.aggregateFeedback;
  if (route.startsWith('/decisions') && method === 'POST') schema = schemas.createDecision;
  if (route.startsWith('/p2p')) { if (route.includes('/messages') && method === 'POST') schema = schemas.sendMessage; if (route.includes('/connect') && method === 'POST') schema = schemas.connectPeer; }
  if (route.startsWith('/updates')) { if (route.includes('/apply') && method === 'POST') schema = schemas.applyUpdate; if (route.includes('/rollback') && method === 'POST') schema = schemas.rollbackUpdate; }
  if (route.startsWith('/skills')) { if (method === 'POST' && !route.includes('/search')) schema = schemas.createSkill; if (route.includes('/rate') && method === 'POST') schema = schemas.rateSkill; if (route.includes('/search') || route === '/') schema = schemas.searchSkills; }
  if (route.startsWith('/resources') && method === 'PUT') schema = schemas.updateResourcePolicy;
  if (schema) { const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true }); if (error) { error.isJoi = true; return next(error); } req.body = value; }
  next();
};

const rateLimitStore = new Map();
const endpointStats = new Map();
const HONEYPOT_ROUTES = ['/admin', '/.env', '/wp-admin', '/phpinfo'];
const blacklistStore = new Map();
const SCORE_RULES = { RATE_LIMIT: 10, AUTH_FAILED: 20, HIGH_ERROR_RATE: 5, HONEYPOT: 50 };
const SCORE_THRESHOLDS = { WARNING: 50, BLOCK_1H: 100, BLOCK_24H: 200 };

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore) { if (now - data.windowStart > 60000) rateLimitStore.delete(key); }
  for (const [ip, data] of blacklistStore) {
    if (data.blockedUntil && now > data.blockedUntil) { data.blockedUntil = null; }
    if (data.score > 0) { data.score = Math.max(0, data.score - 2); if (data.score === 0) blacklistStore.delete(ip); }
  }
  if (endpointStats.size > 0) { if (Math.max(...endpointStats.values()) > 500) console.debug('[Security] High traffic detected'); endpointStats.clear(); }
}, 60000);

const ROUTE_LIMITS = { '/api/v1/p2p': { max: 200 }, '/api/v1/agents': { max: 300 }, '/api/v1/feedback': { max: 300 }, '/api/v1/decisions': { max: 300 }, '/api/v1/skills': { max: 100 }, '/api/v1/versions': { max: 100 }, '/api/v1/updates': { max: 50 }, '/api/v1/resources': { max: 200 }, '/api/v1/metrics': { max: 200 }, '/api/': { max: 300 } };
const DEFAULT_AUTH_LIMIT = 500; const UNAUTH_LIMIT = 300;

const getClientId = (req) => req.ip || req.connection?.remoteAddress || 'unknown';
const getRouteLimit = (path) => { for (const [route, config] of Object.entries(ROUTE_LIMITS)) { if (path.startsWith(route)) return config; } return { max: DEFAULT_AUTH_LIMIT }; };
const getBlacklistRecord = (ip) => { if (!blacklistStore.has(ip)) blacklistStore.set(ip, { score: 0, blockedUntil: null, reasons: [] }); return blacklistStore.get(ip); };
const addScore = (ip, score, reason) => { const record = getBlacklistRecord(ip); record.score += score; record.reasons.push(reason); if (record.score >= SCORE_THRESHOLDS.BLOCK_24H) record.blockedUntil = Date.now() + 86400000; else if (record.score >= SCORE_THRESHOLDS.BLOCK_1H) record.blockedUntil = Date.now() + 3600000; return record.score; };

const securityMiddleware = (req, res, next) => {
  const clientIp = getClientId(req); const now = Date.now();
  const blacklist = blacklistStore.get(clientIp);
  if (blacklist && blacklist.blockedUntil && now < blacklist.blockedUntil) return res.status(403).json({ error: 'BLOCKED', message: 'IP temporarily blocked', retryAfter: Math.ceil((blacklist.blockedUntil - now) / 1000) });
  const path = req.path;
  if (HONEYPOT_ROUTES.some(h => path.includes(h))) { addScore(clientIp, SCORE_RULES.HONEYPOT, 'Honeypot access'); return res.status(404).json({ error: 'Not Found' }); }
  endpointStats.set(path, (endpointStats.get(path) || 0) + 1);
  const isAuthenticated = req.headers['authorization']?.startsWith('Bearer ');
  const limit = isAuthenticated ? getRouteLimit(path) : { max: UNAUTH_LIMIT };
  const key = `${clientIp}:${limit.max}`;
  let clientData = rateLimitStore.get(key);
  if (!clientData || now - clientData.windowStart > 60000) { clientData = { windowStart: now, count: 0, limitValue: limit.max }; rateLimitStore.set(key, clientData); }
  clientData.count++;
  const remaining = clientData.limitValue - clientData.count;
  if (clientData.count === 1 || remaining <= 10 || remaining < 0) { res.set('X-RateLimit-Limit', clientData.limitValue); res.set('X-RateLimit-Remaining', Math.max(0, remaining)); }
  if (remaining < 0) { addScore(clientIp, SCORE_RULES.RATE_LIMIT, 'Rate limit exceeded'); return res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests', retryAfter: Math.ceil((clientData.windowStart + 60000 - now) / 1000) }); }
  next();
};

const recordAuthFailure = (ip) => addScore(ip, SCORE_RULES.AUTH_FAILED, 'Authentication failed');
const recordHighErrorRate = (ip) => addScore(ip, SCORE_RULES.HIGH_ERROR_RATE, 'High error rate');
const getBlacklistStatus = () => { const result = {}; for (const [ip, data] of blacklistStore) { if (data.score > 0) result[ip] = { score: data.score, blockedUntil: data.blockedUntil }; } return result; };

export { APIError, errorHandler };
export { MetricsCollector, metricsCollector as metrics, metricsCollector };
export { requestValidator };
export { securityMiddleware, recordAuthFailure, recordHighErrorRate, getBlacklistStatus };
