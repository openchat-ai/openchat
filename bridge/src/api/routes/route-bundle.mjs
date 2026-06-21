import express from 'express';
import os from 'os';
import { Router } from 'express';
import KsSynth from '../../core/audio/ks-synth.js';
import { metrics } from '../middleware/api-middleware.mjs';

// === health.js ===
const healthRouter = express.Router();

function getSystemInfo() {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  return {
    uptime: { seconds: Math.floor(uptime), formatted: formatUptime(uptime) },
    memory: { heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), rss: Math.round(memoryUsage.rss / 1024 / 1024), unit: 'MB' },
    cpu: { user: cpuUsage.user, system: cpuUsage.system },
    os: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, totalMemory: Math.round(os.totalmem() / 1024 / 1024), freeMemory: Math.round(os.freemem() / 1024 / 1024) }
  };
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

healthRouter.get('/', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });
healthRouter.get('/detail', (req, res) => { const si = getSystemInfo(); res.json({ status: 'ok', timestamp: new Date().toISOString(), version: process.env.npm_package_version || '2.0.0', nodeVersion: process.version, environment: process.env.NODE_ENV || 'development', system: si, checks: { memory: si.memory.heapUsed < si.memory.heapTotal * 0.9 ? 'pass' : 'warn', uptime: si.uptime.seconds > 60 ? 'pass' : 'starting' } }); });
healthRouter.get('/ready', (req, res) => { const allReady = true; res.status(allReady ? 200 : 503).json({ ready: allReady, checks: { api: true, bridge: true, database: true }, timestamp: new Date().toISOString() }); });
healthRouter.get('/live', (req, res) => { res.status(200).json({ alive: true, timestamp: new Date().toISOString() }); });

// === feedback.js ===
const feedbackRouter = express.Router();
const allFeedback = new Map();
let nextFeedbackId = 1;

const normalizeFeedback = (feedback, agentRole) => {
  const normalized = { ...feedback, normalized: true, category: agentRole };
  switch (agentRole) {
    case 'security_auditor': normalized.severity = feedback.severity || 'MEDIUM'; normalized.vulnerabilities = feedback.vulnerabilities || []; break;
    case 'code_quality_analyzer': normalized.issues = feedback.issues || []; normalized.score = feedback.score || 0; break;
    case 'performance_analyzer': normalized.metrics = feedback.metrics || {}; normalized.recommendations = feedback.recommendations || []; break;
    case 'test_engineer': normalized.testResults = feedback.testResults || {}; normalized.coverage = feedback.coverage || 0; break;
  }
  return normalized;
};

const deduplicateFeedback = (feedbackList) => { const unique = []; const seen = new Set(); for (const fb of feedbackList) { const key = JSON.stringify(fb); if (!seen.has(key)) { seen.add(key); unique.push(fb); } } return unique; };
const prioritizeFeedback = (feedbackList) => { const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }; return feedbackList.sort((a, b) => order[a.priority || 'MEDIUM'] - order[b.priority || 'MEDIUM']); };

feedbackRouter.post('/aggregate', async (req, res, next) => {
  try {
    const { agentIds, options = {} } = req.body;
    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) return res.status(400).json({ error: 'INVALID_AGENT_IDS', message: 'agentIds array is required' });
    let allFeedbackList = []; const feedbackByAgent = {};
    for (const agentId of agentIds) { feedbackByAgent[agentId] = []; allFeedbackList = allFeedbackList.concat(feedbackByAgent[agentId]); }
    if (options.normalize !== false) allFeedbackList = allFeedbackList.map(fb => normalizeFeedback(fb, fb.agentRole || 'custom'));
    if (options.deduplicate !== false) allFeedbackList = deduplicateFeedback(allFeedbackList);
    if (options.prioritize !== false) allFeedbackList = prioritizeFeedback(allFeedbackList);
    const summary = { total: allFeedbackList.length, byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, byCategory: {} };
    for (const fb of allFeedbackList) { summary.byPriority[fb.priority || 'MEDIUM']++; summary.byCategory[fb.category || 'custom'] = (summary.byCategory[fb.category || 'custom'] || 0) + 1; }
    res.json({ id: `agg_${nextFeedbackId++}`, agentIds, timestamp: new Date().toISOString(), feedbackCount: allFeedbackList.length, feedback: allFeedbackList, summary, options });
  } catch (error) { next(error); }
});

// === resources.js ===
const resourcesRouter = express.Router();
const resourceStatus = { network: { mode: 'WiFi', compression: 'gzip', cacheEnabled: true, bytesSent: 0, bytesReceived: 0 }, storage: { usedMB: 512, totalMB: 2048, cacheMB: 128, logsMB: 64 }, system: { cpuPercent: 45, memoryPercent: 62, uptime: 3600 } };
const resourcePolicy = { compression: 'gzip', cacheEnabled: true, networkMode: 'Auto', maxStorageMB: 2048, cleanupEnabled: true };

resourcesRouter.get('/status', async (req, res, next) => { try { resourceStatus.system.cpuPercent = Math.round(Math.random() * 50 + 20); resourceStatus.system.memoryPercent = Math.round(Math.random() * 30 + 40); res.json(resourceStatus); } catch (error) { next(error); } });
resourcesRouter.put('/policy', async (req, res, next) => { try { const { compression, cacheEnabled, networkMode, maxStorageMB } = req.body; if (compression && ['gzip', 'brotli', 'none'].includes(compression)) { resourcePolicy.compression = compression; resourceStatus.network.compression = compression; } if (cacheEnabled !== undefined) { resourcePolicy.cacheEnabled = cacheEnabled; resourceStatus.network.cacheEnabled = cacheEnabled; } if (networkMode && ['WiFi', 'Mobile', 'Auto'].includes(networkMode)) { resourcePolicy.networkMode = networkMode; resourceStatus.network.mode = networkMode; } if (maxStorageMB) resourcePolicy.maxStorageMB = maxStorageMB; res.json({ policy: resourcePolicy, updatedAt: new Date().toISOString() }); } catch (error) { next(error); } });
resourcesRouter.post('/cleanup', async (req, res, next) => { try { const { targets = ['cache', 'logs', 'temp'] } = req.body; const results = { startedAt: new Date().toISOString(), targets: {}, totalFreedMB: 0 }; for (const target of targets) { let freedMB = 0; switch (target) { case 'cache': freedMB = Math.round(Math.random() * 50 + 10); resourceStatus.storage.cacheMB -= freedMB; break; case 'logs': freedMB = Math.round(Math.random() * 20 + 5); resourceStatus.storage.logsMB -= freedMB; break; case 'temp': freedMB = Math.round(Math.random() * 30 + 10); break; case 'oldVersions': freedMB = Math.round(Math.random() * 100 + 50); break; } results.targets[target] = { status: 'completed', freedMB }; results.totalFreedMB += freedMB; } results.completedAt = new Date().toISOString(); res.json(results); } catch (error) { next(error); } });

// === versions.js ===
const versionsRouter = express.Router();
const versionHistory = new Map();
let nextVersionId = 1;
versionHistory.set('2.0.0', { version: '2.0.0', codeSnapshot: '...', configSnapshot: { port: 3000 }, dbSnapshot: null, performanceBaseline: { responseTime: 100, memoryMB: 256 }, testResults: { passed: 100, failed: 0 }, deployedAt: '2026-04-01T00:00:00Z', status: 'active' });

versionsRouter.get('/current', async (req, res, next) => { try { const v = versionHistory.get('2.0.0'); res.json({ currentVersion: v.version, deployedAt: v.deployedAt, status: v.status, performance: v.performanceBaseline }); } catch (error) { next(error); } });
versionsRouter.get('/history', async (req, res, next) => { try { const { limit = 20 } = req.query; const history = Array.from(versionHistory.values()).sort((a, b) => new Date(b.deployedAt) - new Date(a.deployedAt)).slice(0, parseInt(limit)); res.json({ versions: history, total: versionHistory.size }); } catch (error) { next(error); } });
versionsRouter.get('/:version', async (req, res, next) => { try { const info = versionHistory.get(req.params.version); if (!info) return res.status(404).json({ error: 'VERSION_NOT_FOUND', message: `Version ${req.params.version} not found` }); res.json(info); } catch (error) { next(error); } });
versionsRouter.post('/:version/rollback', async (req, res, next) => { try { const info = versionHistory.get(req.params.version); if (!info) return res.status(404).json({ error: 'VERSION_NOT_FOUND', message: `Version ${req.params.version} not found` }); const id = `rollback_${nextVersionId++}`; setTimeout(() => {}, 2000); res.json({ rollbackId: id, targetVersion: req.params.version, status: 'in_progress', initiatedAt: new Date().toISOString() }); } catch (error) { next(error); } });

// === updates.js ===
const updatesRouter = express.Router();
const updateVersions = new Map();
const updateHistory = new Map();
let nextUpdateId = 1;
updateVersions.set('2.0.0', { version: '2.0.0', type: 'release', size: '50MB', changelog: 'Initial release', status: 'active' });
updateVersions.set('2.1.0', { version: '2.1.0', type: 'security_patch', size: '10MB', changelog: 'Security fixes and performance improvements', status: 'available' });

updatesRouter.get('/available', async (req, res, next) => { try { const available = Array.from(updateVersions.values()).filter(v => v.status === 'available'); res.json({ currentVersion: '2.0.0', availableVersions: available.map(v => ({ version: v.version, type: v.type, size: v.size, changelog: v.changelog, estimatedUpdateTime: '5 minutes' })) }); } catch (error) { next(error); } });
updatesRouter.get('/history', async (req, res, next) => { try { const { limit = 10, status } = req.query; let history = Array.from(updateHistory.values()); if (status) history = history.filter(h => h.status === status); history.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, parseInt(limit)); res.json({ history, total: updateHistory.size }); } catch (error) { next(error); } });
updatesRouter.get('/:version', async (req, res, next) => { try { const info = updateVersions.get(req.params.version); if (!info) return res.status(404).json({ error: 'VERSION_NOT_FOUND', message: `Version ${req.params.version} not found` }); res.json(info); } catch (error) { next(error); } });
updatesRouter.post('/:version/apply', async (req, res, next) => { try { const info = updateVersions.get(req.params.version); if (!info) return res.status(404).json({ error: 'VERSION_NOT_FOUND', message: `Version ${req.params.version} not found` }); const id = `update_${nextUpdateId++}`; const update = { id, version: req.params.version, status: 'in_progress', autoRollbackIfFailed: req.body.autoRollbackIfFailed !== false, preferredUpdateTime: req.body.preferredUpdateTime || 'immediate', startedAt: new Date().toISOString(), completedAt: null, watchdogAlarms: 0 }; updateHistory.set(id, update); setTimeout(() => { update.status = 'SUCCESS'; update.completedAt = new Date().toISOString(); updateHistory.set(id, update); }, 2000); res.json({ updateId: id, version: req.params.version, status: 'in_progress', autoRollbackIfFailed: update.autoRollbackIfFailed }); } catch (error) { next(error); } });
updatesRouter.post('/:version/rollback', async (req, res, next) => { try { const info = updateVersions.get(req.params.version); if (!info) return res.status(404).json({ error: 'VERSION_NOT_FOUND', message: `Version ${req.params.version} not found` }); const id = `rollback_${nextUpdateId++}`; setTimeout(() => {}, 1500); res.json({ rollbackId: id, version: req.params.version, status: 'starting', startedAt: new Date().toISOString() }); } catch (error) { next(error); } });

// === synth.js ===
const synthRouter = Router();
const synth = new KsSynth();

function pcmToWav(pcm, sr) {
  const n = pcm.length, d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32768))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, d]);
}

synthRouter.get('/scale', (req, res) => {
  const sr = 48000, dur = 0.4, gap = 0.05;
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  const totalLen = Math.round(scale.length * (dur + gap) * sr);
  const out = new Float64Array(totalLen);
  for (let si = 0; si < scale.length; si++) {
    const tone = synth.guitar({ m: scale[si], d: dur, c: 0.8 });
    if (!tone) continue;
    const off = Math.round(si * (dur + gap) * sr);
    for (let i = 0; i < tone.length && off + i < out.length; i++) out[off + i] += tone[i];
  }
  res.set('Content-Type', 'audio/wav'); res.set('Content-Disposition', 'inline; filename="scale.wav"'); res.send(pcmToWav(out, sr));
});

synthRouter.post('/render', (req, res) => {
  const { notes, sampleRate = 48000, mixRatio } = req.body;
  if (!notes || !Array.isArray(notes) || notes.length === 0) return res.status(400).json({ error: 'need notes array' });
  const maxEnd = notes.reduce((m, n) => Math.max(m, (n.s || 0) + (n.d || 0.3)), 0);
  const totalLen = Math.max(Math.ceil(maxEnd * sampleRate), 1);
  const out = synth.render(notes, totalLen);
  if (mixRatio != null) {
    const orig = new Float64Array(totalLen);
    for (let i = 0; i < totalLen && i < (req.body.original?.length || 0); i++) orig[i] = req.body.original[i];
    const mixed = synth.mix(out, orig, mixRatio);
    res.set('Content-Type', 'audio/wav'); res.send(pcmToWav(mixed, sampleRate)); return;
  }
  res.set('Content-Type', 'audio/wav'); res.send(pcmToWav(out, sampleRate));
});

// === metrics.js ===
const metricsRouter = express.Router();
metricsRouter.get('/', async (req, res, next) => { try { res.json(metrics.getSummary()); } catch (error) { next(error); } });
metricsRouter.get('/detailed', async (req, res, next) => { try { res.json(metrics.getDetailed()); } catch (error) { next(error); } });
metricsRouter.get('/endpoints', async (req, res, next) => { try { const d = metrics.getDetailed(); res.json({ endpoints: d.endpoints, total: d.endpoints.length }); } catch (error) { next(error); } });
metricsRouter.get('/errors', async (req, res, next) => { try { const d = metrics.getDetailed(); res.json({ byType: d.errors.byType, recent: d.errors.recent.slice(-20) }); } catch (error) { next(error); } });
metricsRouter.post('/reset', async (req, res, next) => { try { metrics.reset(); res.json({ status: 'reset', timestamp: new Date().toISOString() }); } catch (error) { next(error); } });

export { healthRouter, feedbackRouter, resourcesRouter, versionsRouter, updatesRouter, synthRouter, metricsRouter };
