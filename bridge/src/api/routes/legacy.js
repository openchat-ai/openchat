/**
 * Legacy Compatibility Layer
 * 旧版 App 请求兼容层 — 已认证 (Bearer Token)
 * 合并 main.js 原始 HTTP 服务器的所有路由
 */

import express from 'express';
import { persistentConfig } from '../../core/persistent-config.js';
import { providerManager } from '../../providers/provider-manager.js';
import { providerRegistry } from '../../providers/provider-registry.js';
import { sessionManager } from '../../session/session-manager.js';
import { memoryManager } from '../../memory/memory-manager.js';
import { residentManager } from '../../core/agent/resident-manager.js';

const router = express.Router();

let bridgeRef = null;

export function setBridgeContext(bridge) {
  bridgeRef = bridge;
}

// 1. 状态检查 (扩展版)
router.get('/status', async (req, res, next) => {
  try {
    const memStats = await memoryManager.getStats();
    res.json({
      status: 'running',
      uptime: Math.floor(process.uptime()),
      currentProvider: persistentConfig.getPreference('currentProvider'),
      currentModel: persistentConfig.getPreference('currentModel'),
      wsClients: bridgeRef?.clients?.size || 0,
      memory: memStats
    });
  } catch (e) { next(e); }
});

// 2. Provider 列表
router.get('/providers', (req, res) => {
  const providers = providerRegistry.listAll();
  const current = persistentConfig.getPreference('currentProvider');
  res.json({ current, providers });
});

// 3. 会话列表
router.get('/sessions', (req, res) => {
  const sessions = sessionManager.listSessions();
  res.json({ sessions });
});

// 4. 聊天接口 (走居民调度器)
router.post('/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    if (bridgeRef?._handleChatViaResident) {
      bridgeRef._handleChatViaResident(message, sessionId, res);
    } else {
      res.json({
        response: `Processed: ${message}`,
        source: 'fallback'
      });
    }
  } catch (e) { next(e); }
});

// 5. 流式聊天 (SSE)
router.post('/chat/stream', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    if (bridgeRef?._handleChatStreamViaSSE) {
      bridgeRef._handleChatStreamViaSSE(req, res);
    } else {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify({ type: 'session', sessionId: sessionId || `session_${Date.now()}` })}\n\n`);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: `Response to: ${message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', content: 'Response complete' })}\n\n`);
        res.end();
      }, 500);
    }
  } catch (e) { next(e); }
});

// 6. 配置管理
router.get('/config', (req, res) => {
  res.json({
    currentProvider: persistentConfig.getPreference('currentProvider'),
    currentModel: persistentConfig.getPreference('currentModel'),
    configuredProviders: persistentConfig.listProviders()
  });
});

router.post('/config', async (req, res, next) => {
  try {
    const { provider, model, apiKey } = req.body;
    if (apiKey) persistentConfig.setApiKey(provider, apiKey);
    if (provider) persistentConfig.setPreference('currentProvider', provider);
    if (model) persistentConfig.setPreference('currentModel', model);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// 7. 内存管理
router.get('/memory', async (req, res, next) => {
  try {
    const stats = await memoryManager.getStats();
    res.json(stats);
  } catch (e) { next(e); }
});

router.post('/memory', async (req, res, next) => {
  try {
    const { action, fact, query } = req.body;
    if (action === 'remember' && fact) {
      const id = await memoryManager.saveFact('default', fact);
      res.json({ success: true, id });
    } else if (action === 'recall' && query) {
      const results = await memoryManager.queryFacts('default', query);
      res.json({ results });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (e) { next(e); }
});

// 8. Provider 连接配置
router.post('/provider/connect', async (req, res, next) => {
  try {
    const { providerId, apiKey, baseUrl } = req.body;
    if (!providerId) return res.status(400).json({ error: 'providerId required' });
    const result = await providerRegistry.configure(providerId, { apiKey, baseUrl });
    if (result.success) {
      const models = providerRegistry.getModels(providerId);
      res.json({ success: true, providerId, modelCount: models.length, models: models.slice(0, 20) });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (e) { next(e); }
});

router.get('/provider/models', async (req, res, next) => {
  try {
    const { providerId } = req.query;
    if (!providerId) return res.status(400).json({ error: 'providerId required' });
    const models = providerRegistry.getModels(providerId) || [];
    res.json({ providerId, models: models.slice(0, 50) });
  } catch (e) { next(e); }
});

router.post('/provider/set', (req, res) => {
  const { provider } = req.body;
  if (provider) persistentConfig.setPreference('currentProvider', provider);
  res.json({ success: true });
});

// 9. Agent 管理
router.get('/agents', (req, res) => {
  if (bridgeRef?.handleAgentsList) {
    bridgeRef.handleAgentsList(req, res);
  } else {
    const residents = residentManager.list(null) || [];
    res.json({ agents: residents.map(r => ({ id: r.id, name: r.name, status: r.status })) });
  }
});

router.get('/agents/history', (req, res) => {
  if (bridgeRef?.handleAgentsHistory) {
    bridgeRef.handleAgentsHistory(req, res);
  } else {
    res.json({ history: [] });
  }
});

router.get('/agents/:id', (req, res) => {
  if (bridgeRef?.handleAgentStatus) {
    bridgeRef.handleAgentStatus(req, res, req.params.id);
  } else {
    res.json({ agent: req.params.id, status: 'unknown' });
  }
});

router.post('/agents/:id', (req, res) => {
  if (bridgeRef?.handleAgentAction) {
    bridgeRef.handleAgentAction(req, res, req.params.id);
  } else {
    res.json({ success: true, action: 'noted' });
  }
});

// 10. 学习核心状态
router.get('/learning', (req, res) => {
  if (bridgeRef?.handleLearningStatus) {
    bridgeRef.handleLearningStatus(req, res);
  } else {
    res.json({ iq: 0, age: 0, solvedCount: 0 });
  }
});

// 11. 心跳（已禁用）

// 12. Dashboard 数据
router.get('/dashboard', async (req, res, next) => {
  try {
    const lc = bridgeRef?.learningCore;
    let pool = 0, solved = 0, iq = 100, age = 0;
    if (lc) {
      pool = lc.problemPool?.length || 0;
      solved = lc.solvedCount || 0;
      iq = lc.iq || 100;
      age = lc.age || 0;
    }
    res.json({ iq, age, solved, poolSize: pool, pending: Math.max(0, pool - solved) });
  } catch (e) { next(e); }
});

// 13. Peer 列表
router.get('/peers', (req, res) => {
  const p2p = bridgeRef?.p2p;
  const peers = p2p ? [...p2p.connectedPeers.keys()].map(id => ({
    peerId: id.slice(0, 8),
    info: p2p.peerInfo.get(id) || {}
  })) : [];
  res.json({ peers });
});

// 14. 根路径 HTML Dashboard
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<html lang="zh"><head><meta charset="utf-8"><title>OpenChat</title></head>
<body style="background:#0a0a1a;color:#e0e0e0;font-family:monospace;padding:20px">
<h1 style="color:#7c8aff">OpenChat Bridge</h1>
<pre id="out" style="font-size:13px;line-height:1.6">Loading...</pre>
<script>
async function R(){
  try{const d=await(await fetch('/api/dashboard')).json();
  let h='IQ: <b style=color:#7c8aff>'+d.iq+'</b>  Age: <b style=color:#ffa502>'+d.age+'</b>  Solved: <b style=color:#2ed573>'+d.solved+'</b>  Pool: <b style=color:#4fc3f7>'+d.poolSize+'</b> (Pending: '+d.pending+')';
  document.getElementById('out').innerHTML=h;
  }catch(e){document.getElementById('out').textContent='Waiting...';}
}R();setInterval(R,3000);
</script></body></html>`);
});

// 15. 当前 Provider 信息
router.get('/ai/main', (req, res) => {
  const provider = persistentConfig.getPreference('currentProvider');
  const model = persistentConfig.getPreference('currentModel');
  res.json({
    id: provider || 'default',
    name: provider || 'Primary AI',
    model: model || 'default',
    status: 'ready'
  });
});

export default router;