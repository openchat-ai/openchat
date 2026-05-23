/**
 * Topic Registry API Routes ?distributed peer discovery
 * 分布?topic 注册中心 API（每个节点共同维护注册表? */
import express from 'express';

const router = express.Router();
// Registry injected from outside (one per Bridge with gossip sync)
let _registry = null;

export function setRegistry(reg) {
  _registry = reg;
}

// Register topic (broadcast to network)
router.post('/announce', (req, res) => {
  const { topic, peerId, ...info } = req.body;
  if (!topic || !peerId) return res.status(400).json({ error: 'topic and peerId required' });
  if (!_registry) return res.status(503).json({ error: 'registry not available' });
  res.json(_registry.announce(topic, peerId, info));
});

// 查询 topic 在线节点
router.get('/peers', (req, res) => {
  const { topic } = req.query;
  if (!topic) return res.status(400).json({ error: 'topic query param required' });
  if (!_registry) return res.status(503).json({ error: 'registry not available' });
  const peers = _registry.getPeers(topic, req.query.exclude);
  res.json({ topic, count: peers.length, peers });
});

// 离开 topic
router.post('/leave', (req, res) => {
  const { topic, peerId } = req.body;
  if (!topic || !peerId) return res.status(400).json({ error: 'topic and peerId required' });
  if (!_registry) return res.status(503).json({ error: 'registry not available' });
  res.json(_registry.leave(topic, peerId));
});

export default router;
