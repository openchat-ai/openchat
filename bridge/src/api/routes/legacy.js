/**
 * Legacy API Routes — 仅做向后兼容，新客户端请使用 WebSocket (/ws) 或 /api/v1/*
 * @deprecated 将在 v2.0 移除
 */

import express from 'express';
import { persistentConfig } from '../../core/persistent-config.js';

const router = express.Router();

// 1. 状态检查
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    provider: persistentConfig.getCurrentProvider(),
    model: persistentConfig.getCurrentModel(),
    uptime: process.uptime()
  });
});

// 2. Provider 列表
router.get('/providers', (req, res) => {
  const providers = persistentConfig.getEnabledProviders();
  res.json({
    providers: providers.map(p => ({
      id: p.name,
      name: p.name,
      model: p.model,
      enabled: p.enabled
    }))
  });
});

// 3. 聊天接口
router.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'MESSAGE_REQUIRED' });
  }

  res.json({
    success: true,
    sessionId: sessionId || `session_${Date.now()}`,
    response: `Processed: ${message}`
  });
});

// 4. 流式聊天
router.post('/chat/stream', (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'MESSAGE_REQUIRED' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`data: ${JSON.stringify({ type: 'session', sessionId: `session_${Date.now()}` })}\n\n`);

  setTimeout(() => {
    res.write(`data: ${JSON.stringify({ type: 'chunk', content: `Response to: ${message}` })}\n\n`);
  }, 100);

  setTimeout(() => {
    res.write(`data: ${JSON.stringify({ type: 'done', content: 'Response complete' })}\n\n`);
    res.end();
  }, 500);
});

// 5. 当前 Provider 信息
router.get('/ai/main', (req, res) => {
  const provider = persistentConfig.getCurrentProvider();
  const model = persistentConfig.getCurrentModel();

  res.json({
    id: provider || 'default',
    name: provider || 'Primary AI',
    model: model || 'default',
    status: 'ready'
  });
});

export default router;