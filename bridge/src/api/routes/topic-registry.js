/**
 * Topic Registry API Routes — peer discovery via HTTP
 * 轻量级 topic 注册中心 API
 */
import express from 'express';
import { TopicRegistry } from '../../../src/p2p/topic-registry.js';

const router = express.Router();
const registry = new TopicRegistry();

// 注册到 topic
router.post('/announce', (req, res) => {
  const { topic, peerId, ...info } = req.body;
  if (!topic || !peerId) return res.status(400).json({ error: 'topic and peerId required' });
  const result = registry.announce(topic, peerId, info);
  res.json(result);
});

// 查询 topic 在线节点
router.get('/peers', (req, res) => {
  const { topic } = req.query;
  if (!topic) return res.status(400).json({ error: 'topic query param required' });
  const peers = registry.getPeers(topic, req.query.exclude);
  res.json({ topic, count: peers.length, peers });
});

// 心跳刷新
router.post('/renew', (req, res) => {
  const { topic, peerId } = req.body;
  if (!topic || !peerId) return res.status(400).json({ error: 'topic and peerId required' });
  res.json(registry.renew(topic, peerId));
});

// 离开 topic
router.post('/leave', (req, res) => {
  const { topic, peerId } = req.body;
  if (!topic || !peerId) return res.status(400).json({ error: 'topic and peerId required' });
  res.json(registry.leave(topic, peerId));
});

// 统计（调试用）
router.get('/stats', (req, res) => {
  res.json(registry.getStats());
});

export { router, registry };
export default router;
