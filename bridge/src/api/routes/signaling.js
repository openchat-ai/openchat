/**
 * 信令交换 API Routes
 *
 * 通过七牛云存储实现手机与 Bridge 的 P2P 打洞信令交换
 */

import express from 'express';
const router = express.Router();

// 七牛云信令模块
import { qiniuSignaling } from '../../core/qiniu-signaling.js';
import { SignalRelay } from '../../core/signal-relay.js';

// 共享房间状态（与 server.js 的 TCP 信令共享同一个 Map）
// server.js 在 mount 时通过 setBridgeContext 注入
let _signalingRooms = null;
let _signalRelay = null;
export function setSignalingContext(rooms, relay) {
  _signalingRooms = rooms;
  _signalRelay = relay;
}

// 房间状态存储 (内存中)
const rooms = new Map();

// POST /api/v1/signaling/request-room - 手机申请房间
router.post('/request-room', async (req, res) => {
  try {
    const { peerId, capabilities } = req.body;

    // 申请房间
    const result = await qiniuSignaling.applyForRoom(peerId);

    // 记录房间状态
    rooms.set(result.roomId, {
      id: result.roomId,
      peerId,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    res.json({
      success: true,
      roomId: result.roomId,
      offerUrl: result.offerUrl,
      message: 'Room allocated, please write offer'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/v1/signaling/room/:roomId - Bridge 检查房间状态
router.get('/room/:roomId', async (req, res) => {
  const { roomId } = req.params;

  // 检查是否有新 offer
  const offer = await qiniuSignaling.checkForOffer(roomId);

  if (offer) {
    res.json({
      roomId,
      status: 'offer_received',
      offer: offer.sdp
    });
  } else {
    res.json({
      roomId,
      status: 'waiting',
      message: 'No offer yet'
    });
  }
});

// POST /api/v1/signaling/room/:roomId/answer - Bridge 写入 answer
router.post('/room/:roomId/answer', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { sdp, iceCandidates } = req.body;

    await qiniuSignaling.writeAnswer(roomId, sdp, iceCandidates || []);

    res.json({
      success: true,
      roomId,
      message: 'Answer written'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/v1/signaling/room/:roomId/ice - Bridge 写入 ICE candidates
router.post('/room/:roomId/ice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { candidates } = req.body;

    await qiniuSignaling.writeIceCandidates(roomId, candidates || []);

    res.json({
      success: true,
      roomId,
      message: 'ICE candidates written'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/v1/signaling/room/:roomId/ice - 手机读取 ICE candidates
router.get('/room/:roomId/ice', async (req, res) => {
  const { roomId } = req.params;

  const candidates = await qiniuSignaling.readIceCandidates(roomId);

  if (candidates && candidates['candidates']) {
    res.json({
      success: true,
      roomId,
      candidates: candidates['candidates']
    });
  } else {
    res.json({
      success: false,
      roomId,
      message: 'No ICE candidates yet'
    });
  }
});

// DELETE /api/v1/signaling/room/:roomId - 释放房间
router.delete('/room/:roomId', async (req, res) => {
  const { roomId } = req.params;

  await qiniuSignaling.releaseRoom(roomId);
  rooms.delete(roomId);

  res.json({
    success: true,
    roomId,
    message: 'Room released'
  });
});

// GET /api/v1/signaling/token - 获取上传 Token
router.get('/token', (req, res) => {
  const key = req.query.key || `signaling/peer-${Date.now()}.json`;
  const token = qiniuSignaling.getUploadToken(key);

  res.json({
    success: true,
    key,
    token,
    uploadUrl: 'https://upload.qiniup.com/'
  });
});

// ========== 数据转发 API ==========

// POST /api/v1/signaling/room/:roomId/data - 手机发送数据到 Bridge
router.post('/room/:roomId/data', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { data } = req.body;

    await qiniuSignaling.phoneSendData(roomId, data);

    res.json({
      success: true,
      roomId,
      message: 'Data sent to bridge'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/v1/signaling/room/:roomId/data - Bridge 检查手机发来的数据
router.get('/room/:roomId/data', async (req, res) => {
  const { roomId } = req.params;
  const lastTimestamp = req.query.lastTimestamp || '';

  const result = await qiniuSignaling.checkPhoneData(roomId, lastTimestamp);

  if (result) {
    res.json({
      success: true,
      roomId,
      data: result.data,
      timestamp: result.timestamp
    });
  } else {
    res.json({
      success: false,
      roomId,
      message: 'No new data'
    });
  }
});

// POST /api/v1/signaling/room/:roomId/relay - Bridge 发送数据到手机 (中继模式)
router.post('/room/:roomId/relay', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { data } = req.body;

    await qiniuSignaling.bridgeSendData(roomId, data);

    res.json({
      success: true,
      roomId,
      mode: 'relay',
      message: 'Data relayed to phone'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/v1/signaling/room/:roomId/relay - 手机检查中继数据
router.get('/room/:roomId/relay', async (req, res) => {
  const { roomId } = req.params;
  const lastTimestamp = req.query.lastTimestamp || '';

  const result = await qiniuSignaling.checkBridgeData(roomId, lastTimestamp);

  if (result) {
    res.json({
      success: true,
      roomId,
      data: result.data,
      timestamp: result.timestamp
    });
  } else {
    res.json({
      success: false,
      roomId,
      message: 'No new relay data'
    });
  }
});

// ========== UDP 打洞 ==========

// UDP 端点注册表: peerId → { ip, port, timestamp }
const _udpEndpoints = new Map();

// 注册 UDP 端点
router.post('/udp-register', (req, res) => {
  const { peerId, udpPort } = req.body;
  if (!peerId || !udpPort) return res.status(400).json({ error: 'peerId and udpPort required' });

  const publicIp = req.ip || req.connection?.remoteAddress || 'unknown';
  // Normalize IPv6 localhost
  const ip = publicIp === '::1' || publicIp === '::ffff:127.0.0.1' ? '127.0.0.1' : publicIp;

  _udpEndpoints.set(peerId, { ip, port: udpPort, ts: Date.now() });
  res.json({ success: true });
});

// 获取对端 UDP 端点
router.get('/udp-query/:peerId', (req, res) => {
  const entry = _udpEndpoints.get(req.params.peerId);
  if (!entry || Date.now() - entry.ts > 60000) {
    return res.json({ success: false, error: 'peer not found or expired' });
  }
  res.json({ success: true, ip: entry.ip, port: entry.port });
});

// 打洞中继：发送 UDP 打洞包命令给对端
router.post('/udp-punch', async (req, res) => {
  const { myPeerId, targetPeerId, myPort } = req.body;
  if (!myPeerId || !targetPeerId) return res.status(400).json({ error: 'missing peerId' });

  const myIp = req.ip?.replace(/^::ffff:/, '') || '0.0.0.0';
  const ip = (myIp === '::1' || myIp === '127.0.0.1') ? '127.0.0.1' : myIp;

  // Register self
  _udpEndpoints.set(myPeerId, { ip, port: myPort || 0, ts: Date.now() });

  // Get target
  const target = _udpEndpoints.get(targetPeerId);
  if (!target || Date.now() - target.ts > 60000) {
    return res.json({ success: false, error: 'target not found' });
  }

  res.json({
    success: true,
    targetIp: target.ip,
    targetPort: target.port,
    myIp: ip,
  });
});

// 获取所有活跃 peer 列表（用于选路）
router.get('/udp-peers', (req, res) => {
  const now = Date.now();
  const peers = [];
  for (const [id, entry] of _udpEndpoints) {
    if (now - entry.ts <= 60000) {
      peers.push({ peerId: id, ip: entry.ip, port: entry.port });
    }
  }
  res.json({ success: true, peers });
});

export default router;