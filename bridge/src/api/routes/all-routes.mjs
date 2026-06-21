// === all-routes.mjs — Merged route definitions (6 files) ===
// Combined from: voice.js, signaling.js, skills.js, p2p.js, dev/index.js, lab-dashboard.mjs

import express from 'express';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import { qiniuSignaling } from '../../core/qiniu-signaling.js';
import { SignalRelay } from '../../core/signal-relay.js';
import { listGoals, getStatus, listFailed, listHistory, getExperimentStats, detectRegressions, listEscalated, getEscalationStats } from '../../lab/lab-core.mjs';

// ===============================
// Voice Routes (from voice.js)
// ===============================

const voiceRouter = express.Router();

const rooms = new Map();
const participants = new Map();
let nextRoomId = 1;
let nextParticipantId = 1;

const transportModes = {
  raw: { name: 'Raw PCM', bitrate: 256, quality: 100 },
  neural: { name: 'Neural Codec', bitrate: 32, quality: 90 },
  opus_high: { name: 'Opus HQ', bitrate: 128, quality: 75 },
  opus_low: { name: 'Opus Low', bitrate: 32, quality: 50 },
  adaptive: { name: 'Adaptive', bitrate: 32, quality: 'auto' }
};

function estimateTraffic(bitrate) {
  if (typeof bitrate !== 'number') bitrate = 32;
  return {
    hourly: `${(bitrate * 3600 / 8 / 1000).toFixed(1)} MB`,
    daily: `${(bitrate * 3600 * 24 / 8 / 1000).toFixed(1)} MB`
  };
}

const iceServers = {
  stun: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  turn: []
};

function initDefaultRoom() {
  const roomId = 'room_default';
  rooms.set(roomId, {
    id: roomId,
    name: 'AI Discussion',
    maxParticipants: 10,
    mode: 'adaptive',
    status: 'active',
    createdAt: new Date().toISOString(),
    participants: new Set()
  });
}
initDefaultRoom();

voiceRouter.post('/rooms', async (req, res, next) => {
  try {
    const { name, maxParticipants = 10, mode = 'adaptive' } = req.body;
    if (!transportModes[mode]) {
      return res.status(400).json({ error: 'INVALID_MODE', message: `mode must be one of: ${Object.keys(transportModes).join(', ')}` });
    }
    const roomId = `room_${nextRoomId++}`;
    const room = {
      id: roomId, name: name || `Room ${roomId}`, maxParticipants, mode,
      status: 'active', createdAt: new Date().toISOString(), participants: new Set()
    };
    rooms.set(roomId, room);
    res.status(201).json({
      id: room.id, name: room.name, participantCount: 0, maxParticipants: room.maxParticipants,
      status: room.status, mode: room.mode, createdAt: room.createdAt
    });
  } catch (error) { next(error); }
});

voiceRouter.get('/rooms', async (req, res, next) => {
  try {
    const roomList = Array.from(rooms.values()).map(room => ({
      id: room.id, name: room.name, participantCount: room.participants.size,
      maxParticipants: room.maxParticipants, mode: room.mode, status: room.status, createdAt: room.createdAt
    }));
    res.json({ rooms: roomList, total: roomList.length });
  } catch (error) { next(error); }
});

voiceRouter.get('/rooms/:roomId', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    const participantList = Array.from(room.participants).map(pid => participants.get(pid)).filter(p => p);
    res.json({
      id: room.id, name: room.name, maxParticipants: room.maxParticipants, mode: room.mode,
      status: room.status, transportConfig: transportModes[room.mode],
      participants: participantList.map(p => ({
        id: p.id, agentId: p.agentId, agentType: p.agentType, role: p.role,
        speaking: p.speaking, audioEnabled: p.audioEnabled, joinedAt: p.joinedAt
      })),
      createdAt: room.createdAt
    });
  } catch (error) { next(error); }
});

voiceRouter.post('/rooms/:roomId/join', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { agentId, agentType, role = 'participant', sttEnabled = true, ttsEnabled = true } = req.body;
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    if (room.participants.size >= room.maxParticipants) return res.status(400).json({ error: 'ROOM_FULL', message: 'Room is full' });
    if (!agentId) return res.status(400).json({ error: 'INVALID_AGENT', message: 'agentId is required' });
    const participantId = `p_${nextParticipantId++}`;
    const participant = {
      id: participantId, roomId, agentId, agentType: agentType || 'unknown', role,
      speaking: false, audioEnabled: true, sttEnabled, ttsEnabled, volume: 0, joinedAt: new Date().toISOString()
    };
    room.participants.add(participantId);
    participants.set(participantId, participant);
    res.status(201).json({
      participant: { id: participant.id, agentId: participant.agentId, agentType: participant.agentType, role: participant.role, speaking: participant.speaking, audioEnabled: participant.audioEnabled, sttEnabled: participant.sttEnabled, ttsEnabled: participant.ttsEnabled },
      room: { id: room.id, name: room.name, mode: room.mode },
      iceServers, transportConfig: transportModes[room.mode]
    });
  } catch (error) { next(error); }
});

voiceRouter.post('/rooms/:roomId/leave', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { participantId } = req.body;
    if (!participantId) return res.status(400).json({ error: 'INVALID_PARTICIPANT', message: 'participantId is required' });
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    const participant = participants.get(participantId);
    if (!participant || participant.roomId !== roomId) return res.status(404).json({ error: 'PARTICIPANT_NOT_FOUND', message: `Participant ${participantId} not found in room` });
    room.participants.delete(participantId);
    participants.delete(participantId);
    res.json({ success: true, participantId, roomId, leftAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

voiceRouter.post('/rooms/:roomId/signal', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { participantId, signal } = req.body;
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    if (!participantId || !signal) return res.status(400).json({ error: 'INVALID_SIGNAL', message: 'participantId and signal are required' });
    const participant = participants.get(participantId);
    if (!participant || participant.roomId !== roomId) return res.status(404).json({ error: 'PARTICIPANT_NOT_FOUND', message: `Participant ${participantId} not found in room` });
    if (!['offer', 'answer', 'ice-candidate'].includes(signal.type)) return res.status(400).json({ error: 'INVALID_SIGNAL_TYPE', message: 'signal.type must be offer, answer, or ice-candidate' });
    const otherParticipants = Array.from(room.participants).filter(pid => pid !== participantId).map(pid => participants.get(pid)).filter(p => p);
    res.json({ success: true, roomId, participantId, signalType: signal.type, forwardedTo: otherParticipants.map(p => p.id), timestamp: new Date().toISOString() });
  } catch (error) { next(error); }
});

voiceRouter.post('/rooms/:roomId/mode', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const { participantId, mode } = req.body;
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    if (!participantId) return res.status(400).json({ error: 'INVALID_PARTICIPANT', message: 'participantId is required' });
    if (!['voice', 'text'].includes(mode)) return res.status(400).json({ error: 'INVALID_MODE', message: 'mode must be voice or text' });
    const participant = participants.get(participantId);
    if (!participant || participant.roomId !== roomId) return res.status(404).json({ error: 'PARTICIPANT_NOT_FOUND', message: `Participant ${participantId} not found in room` });
    participant.mode = mode;
    participants.set(participantId, participant);
    res.json({ success: true, participantId, roomId, mode, message: mode === 'voice' ? 'Switched to voice mode' : 'Switched to text mode' });
  } catch (error) { next(error); }
});

voiceRouter.get('/rooms/:roomId/stats', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND', message: `Room ${roomId} not found` });
    const participantList = Array.from(room.participants).map(pid => participants.get(pid)).filter(p => p);
    res.json({
      roomId: room.id, name: room.name, participantCount: room.participants.size,
      maxParticipants: room.maxParticipants, mode: room.mode,
      transportConfig: transportModes[room.mode],
      participants: { speaking: participantList.filter(p => p.speaking).length, audioEnabled: participantList.filter(p => p.audioEnabled).length, total: participantList.length },
      traffic: { currentBitrate: transportModes[room.mode].bitrate, ...estimateTraffic(transportModes[room.mode].bitrate) }
    });
  } catch (error) { next(error); }
});

voiceRouter.get('/modes', async (req, res, next) => {
  try {
    const modes = Object.entries(transportModes).map(([key, value]) => ({ mode: key, ...value, estimatedTraffic: estimateTraffic(value.bitrate) }));
    res.json({ modes });
  } catch (error) { next(error); }
});

// ===============================
// Signaling Routes (from signaling.js)
// ===============================

const signalingRouter = express.Router();

let _signalingRooms = null;
let _signalRelay = null;
export function setSignalingContext(rooms, relay) {
  _signalingRooms = rooms;
  _signalRelay = relay;
}

const signalRoomMap = new Map();

signalingRouter.post('/request-room', async (req, res) => {
  try {
    const { peerId, capabilities } = req.body;
    const result = await qiniuSignaling.applyForRoom(peerId);
    signalRoomMap.set(result.roomId, { id: result.roomId, peerId, status: 'pending', createdAt: new Date().toISOString() });
    res.json({ success: true, roomId: result.roomId, offerUrl: result.offerUrl, message: 'Room allocated, please write offer' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

signalingRouter.get('/room/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const offer = await qiniuSignaling.checkForOffer(roomId);
  if (offer) {
    res.json({ roomId, status: 'offer_received', offer: offer.sdp });
  } else {
    res.json({ roomId, status: 'waiting', message: 'No offer yet' });
  }
});

signalingRouter.post('/room/:roomId/answer', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { sdp, iceCandidates } = req.body;
    await qiniuSignaling.writeAnswer(roomId, sdp, iceCandidates || []);
    res.json({ success: true, roomId, message: 'Answer written' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

signalingRouter.post('/room/:roomId/ice', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { candidates } = req.body;
    await qiniuSignaling.writeIceCandidates(roomId, candidates || []);
    res.json({ success: true, roomId, message: 'ICE candidates written' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

signalingRouter.get('/room/:roomId/ice', async (req, res) => {
  const { roomId } = req.params;
  const candidates = await qiniuSignaling.readIceCandidates(roomId);
  if (candidates && candidates['candidates']) {
    res.json({ success: true, roomId, candidates: candidates['candidates'] });
  } else {
    res.json({ success: false, roomId, message: 'No ICE candidates yet' });
  }
});

signalingRouter.delete('/room/:roomId', async (req, res) => {
  const { roomId } = req.params;
  await qiniuSignaling.releaseRoom(roomId);
  signalRoomMap.delete(roomId);
  res.json({ success: true, roomId, message: 'Room released' });
});

signalingRouter.get('/token', (req, res) => {
  const key = req.query.key || `signaling/peer-${Date.now()}.json`;
  const token = qiniuSignaling.getUploadToken(key);
  res.json({ success: true, key, token, uploadUrl: 'https://upload.qiniup.com/' });
});

signalingRouter.post('/room/:roomId/data', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { data } = req.body;
    await qiniuSignaling.phoneSendData(roomId, data);
    res.json({ success: true, roomId, message: 'Data sent to bridge' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

signalingRouter.get('/room/:roomId/data', async (req, res) => {
  const { roomId } = req.params;
  const lastTimestamp = req.query.lastTimestamp || '';
  const result = await qiniuSignaling.checkPhoneData(roomId, lastTimestamp);
  if (result) {
    res.json({ success: true, roomId, data: result.data, timestamp: result.timestamp });
  } else {
    res.json({ success: false, roomId, message: 'No new data' });
  }
});

signalingRouter.post('/room/:roomId/relay', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { data } = req.body;
    await qiniuSignaling.bridgeSendData(roomId, data);
    res.json({ success: true, roomId, mode: 'relay', message: 'Data relayed to phone' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

signalingRouter.get('/room/:roomId/relay', async (req, res) => {
  const { roomId } = req.params;
  const lastTimestamp = req.query.lastTimestamp || '';
  const result = await qiniuSignaling.checkBridgeData(roomId, lastTimestamp);
  if (result) {
    res.json({ success: true, roomId, data: result.data, timestamp: result.timestamp });
  } else {
    res.json({ success: false, roomId, message: 'No new relay data' });
  }
});

const _udpEndpoints = new Map();

signalingRouter.post('/udp-register', (req, res) => {
  const { peerId, udpPort } = req.body;
  if (!peerId || !udpPort) return res.status(400).json({ error: 'peerId and udpPort required' });
  const publicIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const ip = publicIp === '::1' || publicIp === '::ffff:127.0.0.1' ? '127.0.0.1' : publicIp;
  _udpEndpoints.set(peerId, { ip, port: udpPort, ts: Date.now() });
  res.json({ success: true });
});

signalingRouter.get('/udp-query/:peerId', (req, res) => {
  const entry = _udpEndpoints.get(req.params.peerId);
  if (!entry || Date.now() - entry.ts > 60000) {
    return res.json({ success: false, error: 'peer not found or expired' });
  }
  res.json({ success: true, ip: entry.ip, port: entry.port });
});

signalingRouter.post('/udp-punch', async (req, res) => {
  const { myPeerId, targetPeerId, myPort } = req.body;
  if (!myPeerId || !targetPeerId) return res.status(400).json({ error: 'missing peerId' });
  const myIp = req.ip?.replace(/^::ffff:/, '') || '0.0.0.0';
  const ip = (myIp === '::1' || myIp === '127.0.0.1') ? '127.0.0.1' : myIp;
  _udpEndpoints.set(myPeerId, { ip, port: myPort || 0, ts: Date.now() });
  const target = _udpEndpoints.get(targetPeerId);
  if (!target || Date.now() - target.ts > 60000) {
    return res.json({ success: false, error: 'target not found' });
  }
  res.json({ success: true, targetIp: target.ip, targetPort: target.port, myIp: ip });
});

signalingRouter.get('/udp-peers', (req, res) => {
  const now = Date.now();
  const peers = [];
  for (const [id, entry] of _udpEndpoints) {
    if (now - entry.ts <= 60000) {
      peers.push({ peerId: id, ip: entry.ip, port: entry.port });
    }
  }
  res.json({ success: true, peers });
});

// ===============================
// Skills Routes (from skills.js)
// ===============================

const skillsRouter = express.Router();

const skills = new Map();
let nextSkillId = 1;
const skillRatings = new Map();

const exampleSkill = {
  id: 'skill_1',
  name: 'Quick Sort Algorithm',
  description: 'Efficient sorting algorithm implementation',
  type: 'ALGORITHM',
  code: 'function quickSort(arr) { ... }',
  version: '1.0.0',
  author: 'Bridge_A',
  status: 'active',
  ratings: { average: 4.5, count: 10 },
  createdAt: '2026-04-01T00:00:00Z',
  publishedAt: '2026-04-02T00:00:00Z'
};
skills.set(exampleSkill.id, exampleSkill);

skillsRouter.post('/', async (req, res, next) => {
  try {
    const { name, description, type, code, tests, documentation } = req.body;
    if (!name || !type || !code) return res.status(400).json({ error: 'INVALID_SKILL_DATA', message: 'name, type, and code are required' });
    const skillId = `skill_${nextSkillId++}`;
    const skill = {
      id: skillId, name, description: description || '', type, code, tests: tests || '',
      documentation: documentation || '', version: '1.0.0', author: 'self', status: 'draft',
      ratings: { average: 0, count: 0 }, createdAt: new Date().toISOString(), validatedAt: null, publishedAt: null
    };
    skills.set(skillId, skill);
    res.status(201).json({ id: skill.id, name: skill.name, type: skill.type, status: skill.status, createdAt: skill.createdAt });
  } catch (error) { next(error); }
});

skillsRouter.get('/', async (req, res, next) => {
  try {
    const { type, minRating, limit = 20 } = req.query;
    let skillList = Array.from(skills.values()).filter(s => s.status === 'active');
    if (type) skillList = skillList.filter(s => s.type === type);
    if (minRating) skillList = skillList.filter(s => s.ratings.average >= parseFloat(minRating));
    skillList = skillList.slice(0, parseInt(limit));
    res.json({ skills: skillList, total: skillList.length });
  } catch (error) { next(error); }
});

skillsRouter.get('/search', async (req, res, next) => {
  try {
    const { query, type, minRating, limit = 20 } = req.query;
    let results = Array.from(skills.values()).filter(s => s.status === 'active');
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    if (type) results = results.filter(s => s.type === type);
    if (minRating) results = results.filter(s => s.ratings.average >= parseFloat(minRating));
    results = results.slice(0, parseInt(limit));
    res.json({ skills: results, total: results.length, query: query || '' });
  } catch (error) { next(error); }
});

skillsRouter.get('/:skillId', async (req, res, next) => {
  try {
    const { skillId } = req.params;
    const skill = skills.get(skillId);
    if (!skill) return res.status(404).json({ error: 'SKILL_NOT_FOUND', message: `Skill ${skillId} not found` });
    res.json(skill);
  } catch (error) { next(error); }
});

skillsRouter.post('/:skillId/validate', async (req, res, next) => {
  try {
    const { skillId } = req.params;
    const skill = skills.get(skillId);
    if (!skill) return res.status(404).json({ error: 'SKILL_NOT_FOUND', message: `Skill ${skillId} not found` });
    skill.status = 'validating';
    skill.validatedAt = new Date().toISOString();
    skill.status = 'validated';
    skills.set(skillId, skill);
    res.json({ id: skill.id, status: skill.status, validatedAt: skill.validatedAt });
  } catch (error) { next(error); }
});

skillsRouter.post('/:skillId/publish', async (req, res, next) => {
  try {
    const { skillId } = req.params;
    const skill = skills.get(skillId);
    if (!skill) return res.status(404).json({ error: 'SKILL_NOT_FOUND', message: `Skill ${skillId} not found` });
    if (skill.status !== 'validated') return res.status(400).json({ error: 'SKILL_NOT_VALIDATED', message: 'Skill must be validated before publishing' });
    skill.status = 'active';
    skill.publishedAt = new Date().toISOString();
    skills.set(skillId, skill);
    res.json({ id: skill.id, status: skill.status, publishedAt: skill.publishedAt });
  } catch (error) { next(error); }
});

skillsRouter.post('/:skillId/rate', async (req, res, next) => {
  try {
    const { skillId } = req.params;
    const { rating, comment } = req.body;
    const skill = skills.get(skillId);
    if (!skill) return res.status(404).json({ error: 'SKILL_NOT_FOUND', message: `Skill ${skillId} not found` });
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'INVALID_RATING', message: 'Rating must be between 1 and 5' });
    const ratings = skillRatings.get(skillId) || [];
    ratings.push({ rating, comment: comment || '', createdAt: new Date().toISOString() });
    skillRatings.set(skillId, ratings);
    const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
    skill.ratings = { average: Math.round(avg * 10) / 10, count: ratings.length };
    skills.set(skillId, skill);
    res.json({ skillId: skill.id, rating: skill.ratings.average, totalRatings: skill.ratings.count });
  } catch (error) { next(error); }
});

// ===============================
// P2P Routes (from p2p.js)
// ===============================

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

  if (!swarm) {
    router.all('*', (req, res) => {
      res.json({ peers: [], messages: [], total: 0, swarm: null, note: 'P2P not initialized (swarm is null)' });
    });
    return router;
  }

  router.post('/messages', async (req, res, next) => {
    try {
      const { type, payload, priority = 'NORMAL' } = req.body;
      if (!type || !Object.values(MessageType).includes(type)) {
        return res.status(400).json({ error: 'INVALID_MESSAGE_TYPE', message: `type must be one of: ${Object.values(MessageType).join(', ')}` });
      }
      if (!payload) return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'payload is required' });
      const sentCount = swarm.isRunning ? swarm.broadcast(payload, type, priority) : 0;
      res.status(201).json({ type, status: 'SENT', peersDelivered: sentCount, createdAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  router.get('/messages/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      res.json({ id, status: 'P2P message has no central storage, this ID is for tracking only', note: 'Message broadcast via hyperswarm' });
    } catch (error) { next(error); }
  });

  router.get('/inbox', async (req, res, next) => {
    try {
      const status = swarm.getStatus();
      res.json({ messages: [], total: 0, note: 'P2P mode has no central inbox, messages are real-time via hyperswarm', connectedPeers: status.connectedPeers });
    } catch (error) { next(error); }
  });

  router.get('/peers', async (req, res, next) => {
    try {
      const seen = new Set();
      const peerList = [];
      for (const peerId of swarm.connectedPeers.keys()) {
        const info = swarm.peerInfo.get(peerId) || {};
        seen.add(peerId);
        peerList.push({ id: peerId.slice(0, 8), name: info.name || '?', region: info.region || '?', residentCount: info.residentCount || 0, transport: 'hyperswarm', status: 'CONNECTED' });
      }
      for (const peerId of swarm.directPeers.keys()) {
        if (seen.has(peerId)) continue;
        const info = swarm.peerInfo.get(peerId) || {};
        peerList.push({ id: peerId.slice(0, 8), name: info.name || '?', region: info.region || '?', residentCount: info.residentCount || 0, transport: 'direct-tcp', status: 'CONNECTED' });
      }
      res.json({ peers: peerList, total: peerList.length });
    } catch (error) { next(error); }
  });

  router.post('/peers/:id/connect', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!swarm.connectedPeers.has(id) && !swarm.directPeers.has(id)) {
        return res.status(404).json({ error: 'PEER_NOT_FOUND', message: `Peer ${id} is not connected.` });
      }
      res.json({ id, status: 'CONNECTED', connectedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });

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
      if (!conn) return res.status(404).json({ error: 'PEER_NOT_FOUND', message: `Peer ${id} not connected` });
      res.json({ id, status: 'DISCONNECTED', disconnectedAt: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  router.get('/stats', async (req, res, next) => {
    try {
      const status = swarm.getStatus();
      res.json({ peers: { connected: status.connectedCount }, peersInfo: status.peers, identity: status.identity, swarm: status, config: { encryption: 'TLS', discoveryEnabled: true, maxPeers: 50 } });
    } catch (error) { next(error); }
  });

  router.put('/config', async (req, res, next) => {
    try {
      const { encryption, discoveryEnabled, maxPeers } = req.body;
      res.json({ config: { encryption: encryption || 'TLS', discoveryEnabled: discoveryEnabled !== undefined ? discoveryEnabled : true, maxPeers: maxPeers || 50 }, updatedAt: new Date().toISOString(), note: 'hyperswarm config is fixed at start(), runtime changes will apply on next restart' });
    } catch (error) { next(error); }
  });

  return router;
}

// ===============================
// Dev Routes (from dev/index.js)
// ===============================

const _devRoot = path.dirname(fileURLToPath(import.meta.url));
const devRouter = express.Router();

devRouter.get('/', (req, res) => {
  res.sendFile(path.join(_devRoot, 'dev', 'page.html'));
});

devRouter.get('/page.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.sendFile(path.join(_devRoot, 'dev', 'page.css'));
});

devRouter.get('/page.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.sendFile(path.join(_devRoot, 'dev', 'page.js'));
});

// ===============================
// Lab Dashboard Routes (from lab-dashboard.mjs)
// ===============================

const labDashboardRouter = express.Router();

labDashboardRouter.get('/api/status', (req, res) => {
  res.json(getStatus());
});

labDashboardRouter.get('/api/queue', (req, res) => {
  res.json({ goals: listGoals() });
});

labDashboardRouter.get('/api/history', (req, res) => {
  const since = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
  res.json({ runs: listHistory(since ? { since } : {}) });
});

labDashboardRouter.get('/api/failures', (req, res) => {
  const since = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
  let failed = listFailed();
  if (since) failed = failed.filter(g => (g.finishedAt || 0) >= since);
  res.json({ failed });
});

labDashboardRouter.get('/api/escalated', (req, res) => {
  const since = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
  let records = listEscalated();
  if (since) records = records.filter(r => r.escalatedAt >= since);
  res.json({ records, stats: getEscalationStats() });
});

labDashboardRouter.get('/api/regressions', (req, res) => {
  res.json(detectRegressions());
});

labDashboardRouter.get('/api/aggregate', (req, res) => {
  res.json({ experiments: getExperimentStats() });
});

labDashboardRouter.get('/api/retry-stats', (req, res) => {
  const all = listHistory();
  if (all.length === 0) return res.json({ empty: true });
  const perAttempt = { 1: 0, 2: 0, 3: 0 };
  for (const r of all) {
    if (r.classification?.category === 'transient') perAttempt[r.retryAttempt] = (perAttempt[r.retryAttempt] || 0) + 1;
  }
  const goalHistory = new Map();
  for (const r of all) {
    if (!goalHistory.has(r.goalId)) goalHistory.set(r.goalId, []);
    goalHistory.get(r.goalId).push(r);
  }
  let transientFails = 0, transientSucceeded = 0, transientExhausted = 0;
  for (const records of goalHistory.values()) {
    const hitTransient = records.some(r => r.classification?.category === 'transient');
    if (!hitTransient) continue;
    transientFails++;
    const last = records.sort((a, b) => a.finishedAt - b.finishedAt).pop();
    if (last.status === 'done') transientSucceeded++;
    else transientExhausted++;
  }
  const saveRate = transientFails > 0 ? transientSucceeded / transientFails : null;
  res.json({ transientFails, transientSucceeded, transientExhausted, saveRate, perAttempt });
});

labDashboardRouter.get('/', (req, res) => {
  res.set('Content-Security-Policy', "default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';connect-src 'self' ws:;img-src 'self' data:");
  res.set('Cache-Control', 'no-store');
  res.send(HTML_PAGE);
});

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Lab Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#e0e0e0;font:13px/1.5 -apple-system,monospace;padding:16px}
h1{color:#7c8aff;font-size:18px;margin-bottom:12px}
.bar{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.bar .stat{background:#1a1a2e;padding:6px 12px;border-radius:4px;font-size:12px}
.bar .stat b{color:#7c8aff;margin-right:6px}
.tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid #333}
.tab{background:none;color:#888;border:none;padding:8px 16px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent}
.tab.active{color:#7c8aff;border-bottom-color:#7c8aff}
.tab:hover{color:#e0e0e0}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{text-align:left;color:#888;border-bottom:1px solid #333;padding:6px 8px;font-size:11px;font-weight:normal}
td{padding:6px 8px;border-bottom:1px solid #1a1a2e;font-size:12px}
tr:hover{background:#1a1a2e}
.status-done{color:#51cf66}
.status-failed{color:#ff6b6b}
.status-pending{color:#888}
.status-running{color:#ffd43b}
.cat-success{color:#51cf66}
.cat-transient{color:#ffd43b}
.cat-code{color:#ff6b6b}
.cat-config{color:#ff922b}
.cat-unknown{color:#888}
.empty{color:#666;padding:24px;text-align:center;font-style:italic}
.win-pick{background:#1a1a2e;color:#e0e0e0;border:1px solid #333;padding:4px 8px;border-radius:4px;font-size:12px}
.error{color:#ff6b6b;padding:8px}
.refresh{color:#666;font-size:11px;margin-left:auto}
.refresh.live{color:#51cf66}
.refresh.dead{color:#ff6b6b}
.btn{background:#7c8aff;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px}
.btn:hover{opacity:.85}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:#1a1a2e;padding:12px;border-radius:4px;border:1px solid #333}
.card h3{color:#7c8aff;font-size:13px;margin-bottom:8px;font-weight:normal}
.kv{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}
.kv .k{color:#888}
.kv .v{color:#e0e0e0}
</style>
</head>
<body>
<h1>Lab Dashboard <span class="refresh" id="ws-status">connecting…</span></h1>
<div class="bar">
  <span class="stat" id="stat-total"><b>total</b>--</span>
  <span class="stat" id="stat-pending"><b>pending</b>--</span>
  <span class="stat" id="stat-running"><b>running</b>--</span>
  <span class="stat" id="stat-done"><b>done</b>--</span>
  <span class="stat" id="stat-failed"><b>failed</b>--</span>
  <select class="win-pick" id="win">
    <option value="3600000">last 1h</option>
    <option value="86400000" selected>last 24h</option>
    <option value="604800000">last 7d</option>
    <option value="0">all time</option>
  </select>
</div>
<div class="tabs">
  <button class="tab active" data-tab="queue">Queue</button>
  <button class="tab" data-tab="history">History</button>
  <button class="tab" data-tab="failures">Failures</button>
  <button class="tab" data-tab="escalated">Escalated</button>
  <button class="tab" data-tab="stats">Stats</button>
</div>
<div id="content"></div>
<script>
let _tab = 'queue';
let _sinceMs = 86400000;
const $ = (s) => document.querySelector(s);
const fmtTime = (ms) => ms ? new Date(ms).toISOString().slice(0,19).replace('T',' ') : '-';
const dur = (ms) => ms == null ? '-' : (ms/1000).toFixed(1)+'s';
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
function sinceQuery() { return _sinceMs > 0 ? '?sinceMs='+(Date.now()-_sinceMs) : ''; }
async function refresh() {
  try {
    const s = await fetchJson('/lab/api/status');
    $('#stat-total').innerHTML = '<b>total</b>'+s.total;
    $('#stat-pending').innerHTML = '<b>pending</b>'+s.pending;
    $('#stat-running').innerHTML = '<b>running</b>'+s.running;
    $('#stat-done').innerHTML = '<b>done</b>'+s.done;
    $('#stat-failed').innerHTML = '<b>failed</b>'+s.failed;
    await renderTab();
  } catch (e) { $('#content').innerHTML = '<div class="error">'+esc(e.message)+'</div>'; }
}
async function renderTab() {
  const c = $('#content');
  if (_tab === 'queue') return c.innerHTML = await renderQueue();
  if (_tab === 'history') return c.innerHTML = await renderHistory();
  if (_tab === 'failures') return c.innerHTML = await renderFailures();
  if (_tab === 'escalated') return c.innerHTML = await renderEscalated();
  if (_tab === 'stats') return c.innerHTML = await renderStats();
}
async function renderQueue() {
  const d = await fetchJson('/lab/api/queue');
  if (!d.goals.length) return '<div class="empty">(empty queue)</div>';
  let h = '<table><thead><tr><th>STATUS</th><th>ID</th><th>ADDED</th><th>RETRY</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const g of d.goals) {
    h += '<tr><td class="status-'+g.status+'">'+g.status+'</td><td>'+esc(g.id)+'</td><td>'+fmtTime(g.addedAt)+'</td><td>'+(g.retryCount||0)+'</td><td>'+esc(g.description.slice(0,80))+'</td></tr>';
  }
  return h + '</tbody></table>';
}
async function renderHistory() {
  const d = await fetchJson('/lab/api/history'+sinceQuery());
  if (!d.runs.length) return '<div class="empty">(no history in window)</div>';
  const last = d.runs.slice(-50).reverse();
  let h = '<table><thead><tr><th>FINISHED</th><th>STATUS</th><th>DUR</th><th>CAT</th><th>RETRY</th><th>GOAL-ID</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const r of last) {
    const cat = r.classification?.category || '-';
    h += '<tr><td>'+fmtTime(r.finishedAt)+'</td><td class="status-'+r.status+'">'+r.status+'</td><td>'+dur(r.durationMs)+'</td><td class="cat-'+cat+'">'+cat+'</td><td>'+(r.retryAttempt||'-')+'</td><td>'+esc(r.goalId)+'</td><td>'+esc((r.description||'').slice(0,50))+'</td></tr>';
  }
  return h + '</tbody></table><div style="color:#666;font-size:11px;margin-top:8px">showing last '+last.length+' of '+d.runs.length+' (window: '+($('#win').selectedOptions[0].text)+')</div>';
}
async function renderFailures() {
  const d = await fetchJson('/lab/api/failures'+sinceQuery());
  if (!d.failed.length) return '<div class="empty">(no failures in window)</div>';
  const byCat = {};
  for (const g of d.failed) {
    const c = g.classification?.category || 'unclassified';
    byCat[c] = (byCat[c]||0)+1;
  }
  let h = '<div class="grid2"><div class="card"><h3>By Category</h3>';
  for (const [c,n] of Object.entries(byCat).sort((a,b)=>b[1]-a[1])) {
    h += '<div class="kv"><span class="k cat-'+c+'">'+c+'</span><span class="v">'+n+'</span></div>';
  }
  h += '</div></div><table style="margin-top:16px"><thead><tr><th>ID</th><th>RETRY</th><th>CATEGORY</th><th>REASON</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const g of d.failed) {
    const cat = g.classification?.category || 'unclassified';
    h += '<tr><td>'+esc(g.id)+'</td><td>'+(g.retryCount||0)+'</td><td class="cat-'+cat+'">'+cat+'</td><td>'+esc(g.classification?.reason||'-')+'</td><td>'+esc(g.description.slice(0,60))+'</td></tr>';
  }
  return h + '</tbody></table>';
}
async function renderEscalated() {
  const d = await fetchJson('/lab/api/escalated'+sinceQuery());
  if (!d.records.length) return '<div class="empty">(no escalations in window)</div>';
  let h = '<div class="grid2"><div class="card"><h3>Stats</h3><div class="kv"><span class="k">total</span><span class="v">'+d.stats.total+'</span></div>';
  for (const [c,n] of Object.entries(d.stats.byCategory)) h += '<div class="kv"><span class="k cat-'+c+'">'+c+'</span><span class="v">'+n+'</span></div>';
  h += '</div><div class="card"><h3>Top</h3>';
  for (const t of (d.stats.byDescription||[]).slice(0,5)) h += '<div class="kv"><span class="k">'+esc(t.description.slice(0,40))+'</span><span class="v">'+t.count+'x</span></div>';
  h += '</div></div><table style="margin-top:16px"><thead><tr><th>ESCALATED</th><th>ATT</th><th>CAT</th><th>GOAL-ID</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const r of d.records.slice(-20).reverse()) {
    const cat = r.classification?.category || 'unclassified';
    h += '<tr><td>'+fmtTime(r.escalatedAt)+'</td><td>'+r.attempts+'</td><td class="cat-'+cat+'">'+cat+'</td><td>'+esc(r.goalId)+'</td><td>'+esc(r.description.slice(0,50))+'</td></tr>';
  }
  return h + '</tbody></table>';
}
async function renderStats() {
  const [agg, reg, ret] = await Promise.all([
    fetchJson('/lab/api/aggregate'),
    fetchJson('/lab/api/regressions'),
    fetchJson('/lab/api/retry-stats'),
  ]);
  let h = '<div class="grid2">';
  h += '<div class="card"><h3>Retry Stats</h3>';
  if (ret.empty) h += '<div class="empty">(no data)</div>';
  else {
    h += '<div class="kv"><span class="k">transient goals</span><span class="v">'+ret.transientFails+'</span></div>';
    h += '<div class="kv"><span class="k">saved by retry</span><span class="v cat-success">'+ret.transientSucceeded+'</span></div>';
    h += '<div class="kv"><span class="k">exhausted</span><span class="v cat-code">'+ret.transientExhausted+'</span></div>';
    if (ret.saveRate != null) h += '<div class="kv"><span class="k">save rate</span><span class="v">'+(ret.saveRate*100).toFixed(0)+'%</span></div>';
  }
  h += '</div>';
  h += '<div class="card"><h3>Regressions</h3>';
  if (reg.message) h += '<div class="empty">'+esc(reg.message)+'</div>';
  else {
    h += '<div class="kv"><span class="k">regressions</span><span class="v cat-code">'+reg.regressions.length+'</span></div>';
    h += '<div class="kv"><span class="k">improvements</span><span class="v cat-success">'+reg.improvements.length+'</span></div>';
    for (const r of reg.regressions.slice(0,3)) h += '<div class="kv"><span class="k">'+esc(r.type)+'</span><span class="v">'+esc(r.message.slice(0,40))+'</span></div>';
  }
  h += '</div></div>';
  h += '<h3 style="margin-top:16px;color:#7c8aff">Per-Experiment</h3>';
  if (!agg.experiments.length) h += '<div class="empty">(no data)</div>';
  else {
    h += '<table><thead><tr><th>DESCRIPTION</th><th>RUNS</th><th>PASS</th><th>FAIL</th><th>RATE</th><th>AVG_DUR</th><th>LAST5</th></tr></thead><tbody>';
    for (const s of agg.experiments) {
      const rate = (s.successRate*100).toFixed(0)+'%';
      h += '<tr><td>'+esc(s.description.slice(0,50))+'</td><td>'+s.total+'</td><td class="cat-success">'+s.success+'</td><td class="cat-code">'+s.failed+'</td><td>'+rate+'</td><td>'+dur(s.avgDurationMs)+'</td><td>'+s.last5Success+'/5</td></tr>';
    }
    h += '</tbody></table>';
  }
  return h;
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  _tab = t.dataset.tab;
  renderTab();
}));
$('#win').addEventListener('change', e => { _sinceMs = Number(e.target.value); renderTab(); });
let _ws = null;
function setStatus(text, cls) {
  const el = $('#ws-status');
  el.textContent = text;
  el.className = 'refresh ' + (cls || '');
}
function connectWS() {
  setStatus('connecting…', '');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  _ws = new WebSocket(proto + '://' + location.host + '/lab/ws');
  _ws.onopen = () => setStatus('● live', 'live');
  _ws.onclose = () => { setStatus('● offline (retry 3s)', 'dead'); setTimeout(connectWS, 3000); };
  _ws.onerror = () => _ws.close();
  _ws.onmessage = () => refresh();
}
refresh();
connectWS();
</script>
</body>
</html>`;

// ===============================
// Exports
// ===============================

export { voiceRouter, signalingRouter, skillsRouter, devRouter, labDashboardRouter };
