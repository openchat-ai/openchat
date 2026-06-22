// === all-routes.mjs — Merged route definitions (6 files) ===
// Combined from: voice.js, signaling.js, skills.js, p2p.js, dev/index.js, lab-dashboard.mjs

import express from 'express';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import { qiniuSignaling } from '../../core/qiniu-signaling.js';
import { SignalRelay } from '../../core/signal-relay.js';
import { listGoals, getStatus, listFailed, listHistory, getExperimentStats, detectRegressions, listEscalated, getEscalationStats } from '../../lab/lab-core.mjs';
import { persistentConfig } from '../../core/core-config.mjs';
import * as providerService from '../../experiments/lib/llm-lib.mjs';
import { sessionManager, sessionEvents } from '../../core/runtime.mjs';
import { memoryManager } from '../../memory/memory-manager.js';
import fs from 'fs/promises';

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

// ===============================
// Legacy Routes (from legacy.js)
// ===============================

/**
 * Legacy Compatibility Layer
 * 旧版 App 请求兼容层 — 已认证 (Bearer Token)
 * 合并 main.js 原始 HTTP 服务器的所有路由
 */

import { getActiveProvider, callLLM } from './lib/llm.js';
import { extractFiles, extractHashlines, applyHashlineEdit } from './lib/file-format.js';
import { PROMPTS, buildMessages } from './lib/prompts.js';
import { ensureProject, writeWithGit, describeProject, scanProjectFiles, getProjectPath } from './lib/workspace.js';

const router = express.Router();
const legacyRouter = router;

let bridgeRef = null;


function setBridgeContext(bridge) {
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
  const providers = providerService.listAll();
  const current = persistentConfig.getPreference('currentProvider');
  res.json({ current, providers });
});

// 3. 会话列表
router.get('/sessions', (req, res) => {
  const smSessions = sessionManager.listSessions().map(s => ({
    sessionId: s.id,
    model: s.model,
    provider: s.providerType,
    created: s.created,
    source: 'sessionManager'
  }));
  const evSessions = sessionEvents.list().map(s => ({
    ...s,
    source: 'eventBus'
  }));
  // 合并去重
  const merged = new Map();
  for (const s of [...evSessions, ...smSessions]) {
    if (!merged.has(s.sessionId)) merged.set(s.sessionId, s);
  }
  res.json({ sessions: [...merged.values()].sort((a, b) => (b.lastEventAt || b.created || 0) - (a.lastEventAt || a.created || 0)) });
});

// SSE 订阅某 session 事件（实时 + 历史回放）
router.get('/sessions/:id/stream', (req, res) => {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'subscribed', sessionId: id, ts: Date.now() })}\n\n`);

  const unsubscribe = sessionEvents.subscribe(id, (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) { console.error('[C0]', e); }
  });
  req.on('close', unsubscribe);
});

// SSE 全 session 事件流（流全部模式）
router.get('/sessions/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(`data: ${JSON.stringify({ type: 'subscribed', ts: Date.now() })}\n\n`);

  // 收集已缓存的历史
  const allHistory = sessionEvents.list().flatMap(s => sessionEvents.getHistory(s.sessionId));
  for (const ev of allHistory.slice(-50)) {
    try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch (e) { console.error('[C0]', e); }
  }

  // 订阅所有 session
  const cbs = new Map();
  const onNewSession = (sessionId, event) => {
    if (cbs.has(sessionId)) return;
    const cb = (ev) => {
      try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch (e) { console.error('[C0]', e); }
    };
    cbs.set(sessionId, cb);
    const unsub = sessionEvents.subscribe(sessionId, cb);
    req.on('close', unsub);
  };

  // 拦截即将 publish 的 session — 简易做法：定期扫描
  const interval = setInterval(() => {
    const sessions = sessionEvents.list();
    for (const s of sessions) {
      if (!cbs.has(s.sessionId)) {
        onNewSession(s.sessionId, null);
      }
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
    for (const [sid, cb] of cbs) {
      sessionEvents.unsubscribe(sid, cb);
    }
    cbs.clear();
  });
});

// 3.5 直通 LLM 端点 — 不走 agent loop，直接调 LLM 返回原始结果
router.post('/direct', async (req, res, next) => {
  try {
    const { message, system } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });
    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = persistentConfig.getPreference('currentModel') || 'openrouter/free';
    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    msgs.push({ role: 'user', content: message });
    const result = await provider.chat(model, msgs);
    res.json({ response: result.content, model: result.model, source: 'direct' });
  } catch (e) {
    console.error('[direct] error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// 3.7 探测模型能力：测试模型支持什么输出格式
router.post('/probe', async (req, res, next) => {
  try {
    const { message, model: probeModel } = req.body;
    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    const model = probeModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });

    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);

    // 测试1：JSON格式请求
    const testPrompt = message || '请用JSON格式回复，只输出 {"answer":"你收到的消息内容"} 这样的格式，不要加其他内容';

    const tests = [];

    // 测试各种格式
    const testCases = [
      { name: 'simple_answer', prompt: '回复 "hello"' },
      { name: 'json_format', prompt: '用JSON格式回复: {"answer":"hello"}' },
      { name: 'tool_call', prompt: '调用 write_file 工具写入 tests/test.txt 内容是 test' },
    ];

    for (const tc of testCases) {
      const start = Date.now();
      try {
        const result = await provider.chat(model, [
          { role: 'user', content: tc.prompt }
        ]);
        const elapsed = Date.now() - start;
        tests.push({
          name: tc.name,
          prompt: tc.prompt,
          model: result.model,
          elapsed_ms: elapsed,
          output: result.content?.substring(0, 500),
          has_think: result.content?.includes('<think>'),
          is_json: false,
          is_action: false,
          is_final: false,
        });
        // 检测格式
        const c = result.content || '';
        if (c.trim().startsWith('{')) {
          try { JSON.parse(c); tests[tests.length-1].is_json = true; } catch (e) { console.error('[C0]', e); }
        }
        if (c.includes('ACTION:') || c.includes('<tool_call>')) tests[tests.length-1].is_action = true;
        if (c.includes('FINAL:')) tests[tests.length-1].is_final = true;
      } catch (e) {
        tests.push({ name: tc.name, prompt: tc.prompt, error: e.message });
      }
    }

    res.json({ provider: providerName, model, tests });
  } catch (e) {
    console.error('[probe] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 4. Spec-first 工作流：分析需求生成 SPEC.md
router.post('/spec', async (req, res, next) => {
  try {
    const { message, model: customModel } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    const prompt = `你是一个顶级需求分析师。请分析以下需求，生成详细的 SPEC.md 文档（施工蓝图，不是高层概述）：

需求：${message}

SPEC.md 格式（每个章节必须填满，不准写"TBD"或省略）：

# spec: [模块名]
> 简短描述 (1-2 行)

## 数据流
逐步骤描述（不是概述）：
1. 用户操作 X → 调用 Y → 更新 Z → 渲染 W
2. ...
列出每个用户操作触发的完整数据流路径

## 接口签名
完整类型化签名（不是空函数名）：
\`\`\`
class ClassName:
  constructor(param: Type)
  methodName(arg1: Type1, arg2: Type2): ReturnType
function helperName(input: Type): ReturnType
\`\`\`
包含所有类、函数、参数类型、返回类型

## 边界条件
- 输入为空时：[处理方式]
- 输入非法时：[处理方式]
- 并发场景：[处理方式]
- 错误状态：[处理方式]
至少 5 条

## 文件清单
| 文件 | 职责 | 行数上限 |
| --- | --- | --- |
| index.html | 入口+DOM+初始化 | 80 |
| script.js | 核心逻辑 | 150 |

## 调试检查点
| C | grep 关键词 | 预期 |
| --- | --- | --- |
| C1 | "[init]" | 初始化时打印 |
| C2 | "[input]" | 每次输入时打印 |
| C3 | "[result]" | 计算完成时打印 |

## 不变量
// === invariants ===
// - currentValue 始终是字符串
// - ...

请严格按照格式输出，所有章节必须填满详细具体内容。SPEC 是代码生成器的输入，不是给人看的概述。`;

    const result = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的需求分析师，擅长将用户需求转化为详细的 SPEC.md 文档。' },
      { role: 'user', content: prompt }
    ], null, { timeout: 120000 });

    const spec = result.content?.replace(/^<think>[\s\S]*?<\/think>\s*/, '').trim() || '';

    res.json({
      spec,
      model: result.model,
      source: 'spec'
    });
  } catch (e) {
    console.error('[spec] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 4.5 根据 SPEC.md 生成骨架文件（框架、空实现）
router.post('/skeleton', async (req, res, next) => {
  try {
    const { spec, workspace, model: customModel } = req.body;
    if (!spec) return res.status(400).json({ error: 'SPEC_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    const prompt = `你是一个顶级代码生成器。根据以下详细 SPEC 直接生成完整可运行的代码（不是骨架，不是 TODO，是完整实现）：

${spec}

要求：
- SPEC 包含完整的接口签名、数据流、边界条件
- 直接根据 SPEC 的接口签名生成完整实现
- 数据流描述的所有步骤必须在代码中可追溯
- 边界条件的所有处理方式必须在代码中实现
- 不变量必须严格遵守
- 调试检查点必须实际打印
- 文件之间必须完整 wiring（不要引用不存在的文件，所有代码自包含）

输出格式（每个文件用 ===FILE:path=== 分隔）：
===FILE:文件路径===
// 完整代码
===FILE:文件路径===
...

只输出代码，不要加其他说明。`;

    const result = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的需求分析师，擅长将用户需求转化为详细的 SPEC.md 文档。' },
      { role: 'user', content: prompt }
    ], null, { timeout: 120000 });

    const output = result.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';

    // 解析骨架文件
    const fileInfos = [];
    const fileMatches = output.matchAll(/===FILE:([^\n]+)===\n([\s\S]*?)(?====FILE:|$)/g);
    for (const match of fileMatches) {
      fileInfos.push({ path: match[1].trim(), content: match[2].trim() });
    }

    // 写入 workspace
    const writeResults = [];
    for (const f of fileInfos) {
      const r = await writeWithGit(workspace, f.path, f.content);
      writeResults.push(r);
    }

    res.json({
      spec: spec.substring(0, 200),
      workspace,
      files: writeResults,
      model: result.model,
      source: 'skeleton'
    });
  } catch (e) {
    console.error('[skeleton] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 5. 根据 SPEC.md 执行实现（确定性路由，不走 agent loop）
// 从文本中提取代码内容
function extractCode(output, filename) {
  // 1. 尝试从 markdown code block 提取
  const codeBlockMatch = output.match(/```[\w]*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // 2. 尝试从指定文件名提取 "```filename\n...```"
  const namedMatch = output.match(new RegExp(`\`\`\`\\w*\\n?([\\s\\S]*?)\`\`\``, 'g'));
  if (namedMatch && namedMatch.length > 0) {
    // 返回最后一个 code block（通常包含完整代码）
    const last = namedMatch[namedMatch.length - 1];
    const inner = last.match(/```[\w]*\n?([\s\S]*?)```/);
    if (inner) return inner[1].trim();
  }
  // 3. 如果没有 code block，返回整段（去掉 <think> 等标记）
  return output.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').replace(/```[\s\S]*?```/g, '').trim();
}

router.post('/implement', async (req, res, next) => {
  try {
    const { spec, tasks, workspace, model: customModel } = req.body;
    if (!spec) return res.status(400).json({ error: 'SPEC_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    const results = [];
    const taskList = tasks || [];

    for (const task of taskList) {
      const start = Date.now();
      try {
        const filePath = task.filename || task.path || task.file;
        const workspacePath = path.resolve('workspaces', workspace);
        const fullPath = path.join(workspacePath, filePath);

        let existingContent = '';
        try {
          existingContent = await fs.readFile(fullPath, 'utf8');
        } catch (e) { console.error('[C0]', e); }

        const prompt = `你是一个代码实现助手。请根据以下 SPEC 实现任务：

SPEC:
${spec}

当前任务:
${task.description}
${existingContent ? `现有文件内容（请在次基础上修改，不要简单覆盖整个文件）：\n\`\`\`\n${existingContent}\n\`\`\`` : ''}

要求：
- 基于现有内容修改，只改必要的部分
- 用 markdown code block 包裹完整文件内容输出
- 不要输出其他内容`;

        const result = await provider.chat(model, [
          { role: 'system', content: '你是一个专业的代码实现助手。严格按要求输出代码。' },
          { role: 'user', content: prompt }
        ], null, { timeout: 300000 });

        const output = result.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
        const code = extractCode(output, filePath);

        if (code && code.length > 10) {
          const writeResult = await writeWithGit(workspace, filePath, code);
          results.push({
            task: task.description || filePath,
            status: writeResult.action === 'unchanged' ? 'unchanged' : 'success',
            ...writeResult,
            elapsed: Date.now() - start
          });
        } else {
          results.push({
            task: task.description,
            status: 'skipped',
            output: output.substring(0, 200),
            elapsed: Date.now() - start
          });
        }
      } catch (e) {
        results.push({
          task: task.description,
          status: 'error',
          error: e.message,
          elapsed: Date.now() - start
        });
      }
    }

    res.json({
      spec: spec.substring(0, 200),
      workspace,
      results,
      model,
      source: 'implement'
    });
  } catch (e) {
    console.error('[implement] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 5.5 完整构建：skeleton + implement 流水线
router.post('/build', async (req, res, next) => {
  try {
    const { spec, workspace, model: customModel } = req.body;
    if (!spec) return res.status(400).json({ error: 'SPEC_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    // Step 1: 生成完整可运行代码（不是骨架）
    const skeletonPrompt = `你是一个顶级代码生成器。根据以下详细 SPEC 直接生成完整可运行的代码（不是骨架，不是 TODO，是完整实现）：

${spec}

要求：
- SPEC 包含完整的接口签名、数据流、边界条件
- 直接根据 SPEC 的接口签名生成完整实现
- 数据流描述的所有步骤必须在代码中可追溯
- 边界条件的所有处理方式必须在代码中实现
- 不变量必须严格遵守
- 调试检查点必须实际打印
- 文件之间必须完整 wiring（不要引用不存在的文件，所有代码自包含）

输出格式（每个文件用 ===FILE:path=== 分隔）：
===FILE:文件路径===
// 完整代码
===FILE:文件路径===
...

只输出代码，不要加其他说明。`;

    const skeletonResult = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的代码架构师，擅长生成骨架代码。' },
      { role: 'user', content: skeletonPrompt }
    ]);

    const skeletonOutput = skeletonResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
    const fileInfos = [];
    const fileMatches = skeletonOutput.matchAll(/===FILE:([^\n]+)===\n([\s\S]*?)(?====FILE:|$)/g);
    for (const match of fileMatches) {
      fileInfos.push({ path: match[1].trim(), content: match[2].trim() });
    }

    // Step 2: 写入骨架文件
    const skeletonResults = [];
    for (const f of fileInfos) {
      const r = await writeWithGit(workspace, f.path, f.content);
      skeletonResults.push(r);
    }

    // Step 3: 并行实现所有文件
    const implementPromises = fileInfos.map(async (f) => {
      const start = Date.now();
      const implementPrompt = `你是一个代码实现助手。请为以下文件实现完整代码：

SPEC:
${spec}

目标文件:
${f.path}

当前骨架:
${f.content}

要求：
- 基于骨架实现完整代码
- 用 markdown code block 包裹代码输出`;

      try {
        const implResult = await provider.chat(model, [
          { role: 'system', content: '你是一个专业的代码实现助手。严格按要求输出代码。' },
          { role: 'user', content: implementPrompt }
        ]);

        const output = implResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
        const code = extractCode(output, f.path);

        if (code && code.length > 10) {
          const writeResult = await writeWithGit(workspace, f.path, code);
          return { file: f.path, ...writeResult, elapsed: Date.now() - start };
        } else {
          return { file: f.path, status: 'skipped', output: output.substring(0, 200), elapsed: Date.now() - start };
        }
      } catch (e) {
        return { file: f.path, status: 'error', error: e.message, elapsed: Date.now() - start };
      }
    });

    const implementResults = await Promise.all(implementPromises);

    // Step 4: 列出 workspace 中的文件
    const workspacePath = path.resolve('workspaces', workspace);
    let fileList = [];
    try {
      const entries = await fs.readdir(workspacePath, { recursive: true });
      fileList = entries.map(e => ({
        path: path.relative(workspacePath, path.join(workspacePath, String(e))),
        type: e.endsWith('.patch') ? 'patch' : 'source'
      }));
    } catch (e) { console.error('[C0]', e); }

    res.json({
      spec: spec.substring(0, 200),
      workspace,
      skeletonResults,
      implementResults,
      fileList,
      model,
      source: 'build'
    });
  } catch (e) {
    console.error('[build] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// === 新版统一端点 ===
// plan: 只做计划（spec），不做代码
// code: 生成代码 + 项目管理（用 lib 模块）
router.post('/code', async (req, res, next) => {
  try {
    const { spec, description, project, session, model: customModel } = req.body;
    const projectName = project || req.body.workspace;
    if (!spec && !description) return res.status(400).json({ error: 'SPEC_OR_DESCRIPTION_REQUIRED' });
    if (!projectName) return res.status(400).json({ error: 'PROJECT_REQUIRED' });

    const { provider, model: cfgModel, type: providerName } = await getActiveProvider();
    const model = customModel || cfgModel;
    const sessionId = session || `s_${Date.now()}`;
    const projectPath = await ensureProject(projectName);
    sessionEvents.publish(sessionId, { type: 'task_start', task: 'code', project: projectName });

    // 1. 若无 spec，先生成 spec
    let finalSpec = spec;
    if (!finalSpec && description) {
      sessionEvents.publish(sessionId, { type: 'thinking', content: '生成 SPEC.md...' });
      const prompt = PROMPTS.generateSpecShort({ description });
      const r = await callLLM(provider, model, buildMessages(prompt), { timeout: 300000 });
      finalSpec = r.content;
      if (!finalSpec) throw new Error('PLAN_FAILED');
      sessionEvents.publish(sessionId, { type: 'spec_ready', length: finalSpec.length });
    }

    // 2. 保存 spec
    await fs.writeFile(path.join(projectPath, `${projectName}.spec.md`), finalSpec, 'utf8');

    // 3. 扫描现有文件（用于多轮编辑）
    const existingFiles = await scanProjectFiles(projectName);

    // 4. 生成 / 修改代码 prompt
    const isEdit = existingFiles.length > 0;
    const prompt = isEdit
      ? PROMPTS.editCodeFromSpec({ spec: finalSpec, description, files: existingFiles })
      : PROMPTS.generateCodeFromSpec({ spec: finalSpec });
    sessionEvents.publish(sessionId, { type: 'thinking', content: isEdit ? `编辑 ${existingFiles.length} 个文件...` : '生成代码...' });
    const r = await callLLM(provider, model, buildMessages(prompt), { timeout: 300000 });
    const output = r.rawContent;

    // 5. 解析文件：===FILE=== + HASHLINE
    const fileInfos = extractFiles(output);
    const hashlines = extractHashlines(output);
    for (const hl of hashlines) {
      const existing = existingFiles.find(f => f.path === hl.path);
      if (!existing) continue;
      const edited = applyHashlineEdit(existing.content, hl.hash, hl.newContent);
      if (edited) fileInfos.push({ path: hl.path, content: edited.newContent });
    }
    sessionEvents.publish(sessionId, { type: 'files_parsed', count: fileInfos.length });

    // 6. 写入所有文件 + git commit
    const writeResults = [];
    for (const f of fileInfos) {
      const wr = await writeWithGit(projectName, f.path, f.content);
      writeResults.push(wr);
      sessionEvents.publish(sessionId, { type: 'file_written', path: f.path, action: wr.action, commit: wr.commit });
    }

    // 7. 返回项目状态
    const desc = await describeProject(projectName);
    sessionEvents.publish(sessionId, { type: 'complete', project: projectName, files: fileInfos.length });
    res.json({
      project: projectName,
      session: sessionId,
      provider: providerName,
      model,
      spec: finalSpec.substring(0, 200),
      files: writeResults,
      fileList: desc.files.map(f => ({ path: f.path, type: f.path.startsWith('.git') ? 'git' : 'source' })),
      gitLog: desc.gitLog,
      isCLI: process.argv.includes('--cli') || process.env.OPENCHAT_CLI === 'true',
      source: 'code'
    });
  } catch (e) {
    console.error('[code] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/code/:project — 列出项目信息
router.get('/code/:project', async (req, res, next) => {
  try {
    const { project } = req.params;
    const isCLI = process.argv.includes('--cli') || process.env.OPENCHAT_CLI === 'true';
    const workspaceRoot = isCLI ? process.cwd() : path.resolve('workspaces');
    const projectPath = path.resolve(workspaceRoot, project);

    // 当前 spec
    let currentSpec = '';
    try {
      currentSpec = await fs.readFile(path.join(projectPath, `${project}.spec.md`), 'utf8');
    } catch (e) { console.error('[C0]', e); }

    res.json({ project, path: projectPath, isCLI, currentSpec: currentSpec?.substring(0, 300) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 5.6 一键生成：用户说需求 → 自动 spec → skeleton → implement → 最终文件（旧版，建议用 /plan + /code）
router.post('/generate', async (req, res, next) => {
  try {
    const { description, workspace, model: customModel } = req.body;
    if (!description) return res.status(400).json({ error: 'DESCRIPTION_REQUIRED' });
    if (!workspace) return res.status(400).json({ error: 'WORKSPACE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);
    const provider = sessionManager.getProvider(providerName);
    const model = customModel || persistentConfig.getPreference('currentModel') || 'openrouter/free';

    // Step 1: 自然语言 → SPEC.md
    const specPrompt = `你是一个需求分析师。用户想要：

${description}

请生成一个完整的 SPEC.md 文档，包含：
1. 项目名称和简短描述
2. 文件清单（哪些文件，每个文件职责）
3. 数据流（输入→处理→输出）
4. 接口设计（关键类/函数签名）
5. 入口行为（页面加载后做什么）

只输出 SPEC.md 内容，不要加其他说明。`;

    const specResult = await provider.chat(model, [
      { role: 'system', content: '你是一个专业的需求分析师，擅长将用户需求转化为详细的 SPEC.md 文档。' },
      { role: 'user', content: specPrompt }
    ], null, { timeout: 120000 });

    const spec = specResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
    if (!spec) throw new Error('SPEC_GENERATION_FAILED');

    // Step 2: SPEC → 完整可运行代码
    const skeletonPrompt = `你是一个顶级代码生成器。根据以下详细 SPEC 直接生成完整可运行的代码（不是骨架，不是 TODO，是完整实现）：

${spec}

要求：
- SPEC 包含完整的接口签名、数据流、边界条件
- 直接根据 SPEC 的接口签名生成完整实现
- 数据流描述的所有步骤必须在代码中可追溯
- 边界条件的所有处理方式必须在代码中实现
- 不变量必须严格遵守
- 调试检查点必须实际打印
- 文件之间必须完整 wiring（不要引用不存在的文件，所有代码自包含）

输出格式（每个文件用 ===FILE:path=== 分隔）：
===FILE:文件路径===
// 完整代码
===FILE:文件路径===
...

只输出代码，不要加其他说明。`;

    const skeletonResult = await provider.chat(model, [
      { role: 'system', content: '你是一个顶级代码生成器，根据详细 SPEC 直接生成完整可运行代码。' },
      { role: 'user', content: skeletonPrompt }
    ]);

    const skeletonOutput = skeletonResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
    const fileInfos = [];
    const fileMatches = skeletonOutput.matchAll(/===FILE:([^\n]+)===\n([\s\S]*?)(?====FILE:|$)/g);
    for (const match of fileMatches) {
      fileInfos.push({ path: match[1].trim(), content: match[2].trim() });
    }

    if (fileInfos.length === 0) throw new Error('SKELETON_GENERATION_FAILED');

    // Step 3: 写入骨架 + 并行实现
    const skeletonResults = [];
    for (const f of fileInfos) {
      const r = await writeWithGit(workspace, f.path, f.content);
      skeletonResults.push(r);
    }

    // Step 4: 并行实现每个文件
    const implementPromises = fileInfos.map(async (f) => {
      const start = Date.now();
      const implementPrompt = `你是一个代码实现助手。请为以下文件实现完整代码：

${spec}

目标文件:
${f.path}

当前骨架:
${f.content}

要求：
- 基于骨架实现完整代码
- 用 markdown code block 包裹代码输出`;

      try {
        const implResult = await provider.chat(model, [
          { role: 'system', content: '你是一个专业的代码实现助手。严格按要求输出代码。' },
          { role: 'user', content: implementPrompt }
        ], null, { timeout: 180000 });

        const output = implResult.content?.replace(/^<think>[\s\S]*?<\/think>\s*/gi, '').trim() || '';
        const code = extractCode(output, f.path);

        if (code && code.length > 10) {
          const writeResult = await writeWithGit(workspace, f.path, code);
          return { file: f.path, ...writeResult, elapsed: Date.now() - start };
        } else {
          return { file: f.path, status: 'skipped', output: output.substring(0, 200), elapsed: Date.now() - start };
        }
      } catch (e) {
        return { file: f.path, status: 'error', error: e.message, elapsed: Date.now() - start };
      }
    });

    const implementResults = await Promise.all(implementPromises);

    // Step 5: 列出 workspace 中的文件
    const workspacePath = path.resolve('workspaces', workspace);
    let fileList = [];
    try {
      const entries = await fs.readdir(workspacePath, { recursive: true });
      fileList = entries.map(e => ({
        path: path.relative(workspacePath, path.join(workspacePath, String(e))),
        type: e.endsWith('.patch') ? 'patch' : 'source'
      }));
    } catch (e) { console.error('[C0]', e); }

    res.json({
      description,
      workspace,
      spec,
      skeletonResults,
      implementResults,
      fileList,
      model,
      source: 'generate'
    });
  } catch (e) {
    console.error('[generate] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 6. 聊天接口 (走 agent-engine 工具循环)
// 内存中的树结构存储（每个 chatId 一棵树）
const chatTrees = new Map();

function initChatTree(chatId) {
  if (!chatTrees.has(chatId)) {
    chatTrees.set(chatId, { version: 1, nodes: [] });
  }
  return chatTrees.get(chatId);
}

function getChatTreePath(tree) {
  if (!tree.nodes.length) return [];
  const nodeMap = {};
  for (const n of tree.nodes) nodeMap[n.id] = n;
  const out = [];
  let id = tree.nodes[0].id;
  while (id && nodeMap[id]) {
    out.push({ id: nodeMap[id].id, role: nodeMap[id].role, content: nodeMap[id].content?.substring(0, 100), ts: nodeMap[id].ts });
    const children = tree.nodes.filter(c => c.parent === id);
    if (!children.length) break;
    const preferred = nodeMap[id].currentChild;
    const next = preferred ? children.find(c => c.id === preferred) : null;
    id = (next || children[children.length - 1]).id;
  }
  return out;
}

function addChatNode(tree, content, role, parentId) {
  const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const node = { id, role, content, parent: parentId || null, ts: Date.now() };
  tree.nodes.push(node);
  if (parentId) {
    const p = tree.nodes.find(n => n.id === parentId);
    if (p) p.currentChild = id;
  }
  return node;
}

router.post('/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    const model = persistentConfig.getPreference('currentModel');
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });

    if (!sessionManager.getProvider(providerName)) {
      await sessionManager.addProvider(providerName, apiKey);
    }

    let sid = sessionId;
    if (!sid || !sessionManager.getSession(sid)) {
      const created = await sessionManager.createSession(providerName, model);
      sid = created.id;
    }

    // 树结构存储：获取当前 chat 的树，追加用户消息
    const tree = initChatTree(sid);
    const path = getChatTreePath(tree);
    const parentId = path.length > 0 ? path[path.length - 1].id : null;
    const userNode = addChatNode(tree, message, 'user', parentId);

    const { orchestrator } = await import('../../core/agent/orchestrator.mjs');
    // 用 processStream 自动发布到 sessionEvents 总线（其他端可以观察）
    let result = '';
    await orchestrator.processStream(sid, 'mobile-user', message, (event) => {
      if (event.type === 'complete' && event.response) result = event.response;
    });

    // 追加 assistant 响应
    const assistNode = addChatNode(tree, result, 'assistant', userNode.id);
    const newPath = getChatTreePath(tree);

    res.json({
      response: result,
      sessionId: sid,
      tree: newPath,
      source: 'chat'
    });
  } catch (e) {
    console.error('[chat] error:', e.message);
    next(e);
  }
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

// 5.5 Agent 内部 debug 流（SSE，带 think/tool_call 事件）
router.post('/chat/debug', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    const model = persistentConfig.getPreference('currentModel');
    if (!providerName || !apiKey) return res.status(400).json({ error: 'NO_API_KEY' });
    if (!sessionManager.getProvider(providerName)) await sessionManager.addProvider(providerName, apiKey);

    let sid = sessionId;
    if (!sid || !sessionManager.getSession(sid)) {
      const created = await sessionManager.createSession(providerName, model);
      sid = created.id;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ type: 'session', sessionId: sid })}\n\n`);

    const { orchestrator, AgentEvents } = await import('../../core/agent/orchestrator.mjs');

    await orchestrator.processStream(sid, 'mobile-user', message, (event) => {
      try {
        const payload = { ...event, ts: Date.now() };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e) { console.error('[C0]', e); }
    });

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (e) {
    try { res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`); res.end(); } catch (e) { console.error('[C0]', e); }
  }
});

// 5.6 网页版 dev UI 已迁移到 ./dev/ 模块
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
    const result = await providerService.configure(providerId, { apiKey, baseUrl });
    if (result.success) {
      const models = providerService.getModels(providerId);
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
    const models = providerService.getModels(providerId) || [];
    res.json({ providerId, models: models.slice(0, 50) });
  } catch (e) { next(e); }
});

router.post('/provider/set', (req, res) => {
  const { provider } = req.body;
  if (provider) persistentConfig.setPreference('currentProvider', provider);
  res.json({ success: true });
});

// 9. Peer 列表
router.get('/peers', (req, res) => {
  const p2p = bridgeRef?.p2p;
  const peers = p2p ? [...p2p.connectedPeers.keys()].map(id => ({
    peerId: id.slice(0, 8),
    info: p2p.peerInfo.get(id) || {}
  })) : [];
  res.json({ peers });
});

// 14. 当前 Provider 信息
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

export { voiceRouter, signalingRouter, skillsRouter, devRouter, labDashboardRouter, legacyRouter, setBridgeContext };
