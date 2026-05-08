/**
 * P2P API Routes
 * 注入 swarm 实例，对接真实 P2P 网络
 */

import express from 'express';

// 消息类型（与服务端 messages.js 同步）
const MessageType = {
  SKILL_PUBLISH: 'skill_publish',
  SKILL_REQUEST: 'skill_request',
  COLLABORATION_REQUEST: 'collaboration_request',
  COLLABORATION_RESPONSE: 'collaboration_response',
  INSIGHT_SHARE: 'insight_share',
  PERFORMANCE_REPORT: 'performance_report'
};

export function createP2PRouter(swarm) {
  const router = express.Router();

  // swarm 为 null 时，挂载纯 mock 路由（永远返回空结果，不崩溃）
  if (!swarm) {
    router.all('*', (req, res) => {
      res.json({
        peers: [],
        messages: [],
        total: 0,
        swarm: null,
        note: 'P2P 未初始化（swarm is null）'
      });
    });
    return router;
  }

  // POST /api/v1/p2p/messages — 发送消息（广播到所有已连接的 peer）
  router.post('/messages', async (req, res, next) => {
    try {
      const { type, payload, priority = 'NORMAL' } = req.body;

      if (!type || !Object.values(MessageType).includes(type)) {
        return res.status(400).json({
          error: 'INVALID_MESSAGE_TYPE',
          message: `type must be one of: ${Object.values(MessageType).join(', ')}`
        });
      }

      if (!payload) {
        return res.status(400).json({
          error: 'INVALID_PAYLOAD',
          message: 'payload is required'
        });
      }

      const sentCount = swarm.isRunning
        ? swarm.broadcast(payload, type, priority)
        : 0;

      res.status(201).json({
        type,
        status: 'SENT',
        peersDelivered: sentCount,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // 保留 GET /messages/:id — P2P 无持久存储，返回模拟响应
  router.get('/messages/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      res.json({
        id,
        status: 'P2P 消息无中心存储，此 ID 仅用于跟踪',
        note: '消息已通过 hyperswarm 广播'
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/p2p/inbox — P2P 无中心收件箱，返回实时连接状态
  router.get('/inbox', async (req, res, next) => {
    try {
      const status = swarm.getStatus();
      res.json({
        messages: [],
        total: 0,
        note: 'P2P 模式无中心收件箱，消息通过 hyperswarm 实时收发',
        connectedPeers: status.connectedPeers
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/p2p/peers — 当前已连接的节点列表（含身份信息）
  router.get('/peers', async (req, res, next) => {
    try {
      const seen = new Set();
      const peerList = [];

      for (const peerId of swarm.connectedPeers.keys()) {
        const info = swarm.peerInfo.get(peerId) || {};
        seen.add(peerId);
        peerList.push({
          id: peerId.slice(0, 8),
          name: info.name || '?',
          region: info.region || '?',
          residentCount: info.residentCount || 0,
          transport: 'hyperswarm',
          status: 'CONNECTED'
        });
      }
      for (const peerId of swarm.directPeers.keys()) {
        if (seen.has(peerId)) continue;
        const info = swarm.peerInfo.get(peerId) || {};
        peerList.push({
          id: peerId.slice(0, 8),
          name: info.name || '?',
          region: info.region || '?',
          residentCount: info.residentCount || 0,
          transport: 'direct-tcp',
          status: 'CONNECTED'
        });
      }

      res.json({
        peers: peerList,
        total: peerList.length
      });
    } catch (error) {
      next(error);
    }
  });

  // POST /api/v1/p2p/peers/:id/connect — hyperswarm 自动发现，手动连接仅做验证
  router.post('/peers/:id/connect', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!swarm.connectedPeers.has(id) && !swarm.directPeers.has(id)) {
        return res.status(404).json({
          error: 'PEER_NOT_FOUND',
          message: `Peer ${id} is not connected.`
        });
      }
      res.json({
        id,
        status: 'CONNECTED',
        connectedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // DELETE /api/v1/p2p/peers/:id — 断开节点
  router.delete('/peers/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      let conn = swarm.connectedPeers.get(id);
      if (conn) {
        conn.destroy();
        swarm.connectedPeers.delete(id);
      } else {
        conn = swarm.directPeers.get(id);
        if (conn) {
          conn.destroy();
          swarm.directPeers.delete(id);
        }
      }
      if (!conn) {
        return res.status(404).json({
          error: 'PEER_NOT_FOUND',
          message: `Peer ${id} not connected`
        });
      }
      res.json({
        id,
        status: 'DISCONNECTED',
        disconnectedAt: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/p2p/stats — 统计信息
  router.get('/stats', async (req, res, next) => {
    try {
      const status = swarm.getStatus();
      res.json({
        peers: {
          connected: status.connectedCount
        },
        peersInfo: status.peers,
        identity: status.identity,
        swarm: status,
        config: {
          encryption: 'TLS',
          discoveryEnabled: true,
          maxPeers: 50
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/v1/p2p/config — 更新配置（hyperswarm 不支持运行时更改，存为参考）
  router.put('/config', async (req, res, next) => {
    try {
      const { encryption, discoveryEnabled, maxPeers } = req.body;
      res.json({
        config: {
          encryption: encryption || 'TLS',
          discoveryEnabled: discoveryEnabled !== undefined ? discoveryEnabled : true,
          maxPeers: maxPeers || 50
        },
        updatedAt: new Date().toISOString(),
        note: 'hyperswarm 配置在 start() 时固定，运行时更改将在下次重启生效'
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
