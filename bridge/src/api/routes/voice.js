/**
 * Voice API Routes
 * 语音房间管理 API
 *
 * Endpoints:
 * - POST /api/v1/voice/rooms - 创建房间
 * - GET /api/v1/voice/rooms - 获取房间列表
 * - GET /api/v1/voice/rooms/:roomId - 获取房间详情
 * - POST /api/v1/voice/rooms/:roomId/join - 加入房间
 * - POST /api/v1/voice/rooms/:roomId/leave - 离开房间
 * - POST /api/v1/voice/rooms/:roomId/signal - WebRTC 信号
 * - POST /api/v1/voice/rooms/:roomId/mode - 切换模式
 * - GET /api/v1/voice/rooms/:roomId/stats - 获取统计
 */

import express from 'express'
import crypto from 'crypto'

const router = express.Router()

// 内存存储
const rooms = new Map()
const participants = new Map()
let nextRoomId = 1
let nextParticipantId = 1

// 传输模式配置
const transportModes = {
  raw: { name: 'Raw PCM', bitrate: 256, quality: 100 },
  neural: { name: 'Neural Codec', bitrate: 32, quality: 90 },
  opus_high: { name: 'Opus HQ', bitrate: 128, quality: 75 },
  opus_low: { name: 'Opus Low', bitrate: 32, quality: 50 },
  adaptive: { name: 'Adaptive', bitrate: 32, quality: 'auto' } // 默认 32kbps
}

// 辅助函数：计算流量
function estimateTraffic(bitrate) {
  if (typeof bitrate !== 'number') bitrate = 32; // fallback
  return {
    hourly: `${(bitrate * 3600 / 8 / 1000).toFixed(1)} MB`,
    daily: `${(bitrate * 3600 * 24 / 8 / 1000).toFixed(1)} MB`
  };
}

// ICE 服务器配置
const iceServers = {
  stun: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  turn: []
}

// 初始化默认房间
function initDefaultRoom() {
  const roomId = 'room_default'
  rooms.set(roomId, {
    id: roomId,
    name: 'AI Discussion',
    maxParticipants: 10,
    mode: 'adaptive',
    status: 'active',
    createdAt: new Date().toISOString(),
    participants: new Set()
  })
}
initDefaultRoom()

// POST /api/v1/voice/rooms - 创建房间
router.post('/rooms', async (req, res, next) => {
  try {
    const { name, maxParticipants = 10, mode = 'adaptive' } = req.body

    // 验证模式
    if (!transportModes[mode]) {
      return res.status(400).json({
        error: 'INVALID_MODE',
        message: `mode must be one of: ${Object.keys(transportModes).join(', ')}`
      })
    }

    const roomId = `room_${nextRoomId++}`
    const room = {
      id: roomId,
      name: name || `Room ${roomId}`,
      maxParticipants,
      mode,
      status: 'active',
      createdAt: new Date().toISOString(),
      participants: new Set()
    }

    rooms.set(roomId, room)

    res.status(201).json({
      id: room.id,
      name: room.name,
      participantCount: 0,
      maxParticipants: room.maxParticipants,
      status: room.status,
      mode: room.mode,
      createdAt: room.createdAt
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/voice/rooms - 获取房间列表
router.get('/rooms', async (req, res, next) => {
  try {
    const roomList = Array.from(rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      participantCount: room.participants.size,
      maxParticipants: room.maxParticipants,
      mode: room.mode,
      status: room.status,
      createdAt: room.createdAt
    }))

    res.json({
      rooms: roomList,
      total: roomList.length
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/voice/rooms/:roomId - 获取房间详情
router.get('/rooms/:roomId', async (req, res, next) => {
  try {
    const { roomId } = req.params
    const room = rooms.get(roomId)

    if (!room) {
      return res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: `Room ${roomId} not found`
      })
    }

    const participantList = Array.from(room.participants)
      .map(pid => participants.get(pid))
      .filter(p => p)

    res.json({
      id: room.id,
      name: room.name,
      maxParticipants: room.maxParticipants,
      mode: room.mode,
      status: room.status,
      transportConfig: transportModes[room.mode],
      participants: participantList.map(p => ({
        id: p.id,
        agentId: p.agentId,
        agentType: p.agentType,
        role: p.role,
        speaking: p.speaking,
        audioEnabled: p.audioEnabled,
        joinedAt: p.joinedAt
      })),
      createdAt: room.createdAt
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/voice/rooms/:roomId/join - 加入房间
router.post('/rooms/:roomId/join', async (req, res, next) => {
  try {
    const { roomId } = req.params
    const { agentId, agentType, role = 'participant', sttEnabled = true, ttsEnabled = true } = req.body

    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: `Room ${roomId} not found`
      })
    }

    if (room.participants.size >= room.maxParticipants) {
      return res.status(400).json({
        error: 'ROOM_FULL',
        message: 'Room is full'
      })
    }

    if (!agentId) {
      return res.status(400).json({
        error: 'INVALID_AGENT',
        message: 'agentId is required'
      })
    }

    const participantId = `p_${nextParticipantId++}`
    const participant = {
      id: participantId,
      roomId,
      agentId,
      agentType: agentType || 'unknown',
      role,
      speaking: false,
      audioEnabled: true,
      sttEnabled,
      ttsEnabled,
      volume: 0,
      joinedAt: new Date().toISOString()
    }

    room.participants.add(participantId)
    participants.set(participantId, participant)

    res.status(201).json({
      participant: {
        id: participant.id,
        agentId: participant.agentId,
        agentType: participant.agentType,
        role: participant.role,
        speaking: participant.speaking,
        audioEnabled: participant.audioEnabled,
        sttEnabled: participant.sttEnabled,
        ttsEnabled: participant.ttsEnabled
      },
      room: {
        id: room.id,
        name: room.name,
        mode: room.mode
      },
      iceServers: iceServers,
      transportConfig: transportModes[room.mode]
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/voice/rooms/:roomId/leave - 离开房间
router.post('/rooms/:roomId/leave', async (req, res, next) => {
  try {
    const { roomId } = req.params
    const { participantId } = req.body

    if (!participantId) {
      return res.status(400).json({
        error: 'INVALID_PARTICIPANT',
        message: 'participantId is required'
      })
    }

    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: `Room ${roomId} not found`
      })
    }

    const participant = participants.get(participantId)
    if (!participant || participant.roomId !== roomId) {
      return res.status(404).json({
        error: 'PARTICIPANT_NOT_FOUND',
        message: `Participant ${participantId} not found in room`
      })
    }

    room.participants.delete(participantId)
    participants.delete(participantId)

    res.json({
      success: true,
      participantId,
      roomId,
      leftAt: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/voice/rooms/:roomId/signal - WebRTC 信号
router.post('/rooms/:roomId/signal', async (req, res, next) => {
  try {
    const { roomId } = req.params
    const { participantId, signal } = req.body

    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: `Room ${roomId} not found`
      })
    }

    if (!participantId || !signal) {
      return res.status(400).json({
        error: 'INVALID_SIGNAL',
        message: 'participantId and signal are required'
      })
    }

    const participant = participants.get(participantId)
    if (!participant || participant.roomId !== roomId) {
      return res.status(404).json({
        error: 'PARTICIPANT_NOT_FOUND',
        message: `Participant ${participantId} not found in room`
      })
    }

    // 验证信号类型
    if (!['offer', 'answer', 'ice-candidate'].includes(signal.type)) {
      return res.status(400).json({
        error: 'INVALID_SIGNAL_TYPE',
        message: 'signal.type must be offer, answer, or ice-candidate'
      })
    }

    // 模拟信号转发给房间内其他参与者
    const otherParticipants = Array.from(room.participants)
      .filter(pid => pid !== participantId)
      .map(pid => participants.get(pid))
      .filter(p => p)

    // 在实际实现中，这里会通过 WebRTC 或信令服务器转发
    res.json({
      success: true,
      roomId,
      participantId,
      signalType: signal.type,
      forwardedTo: otherParticipants.map(p => p.id),
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/voice/rooms/:roomId/mode - 切换语音/文字模式
router.post('/rooms/:roomId/mode', async (req, res, next) => {
  try {
    const { roomId } = req.params
    const { participantId, mode } = req.body

    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: `Room ${roomId} not found`
      })
    }

    if (!participantId) {
      return res.status(400).json({
        error: 'INVALID_PARTICIPANT',
        message: 'participantId is required'
      })
    }

    // mode: 'voice' | 'text'
    if (!['voice', 'text'].includes(mode)) {
      return res.status(400).json({
        error: 'INVALID_MODE',
        message: 'mode must be voice or text'
      })
    }

    const participant = participants.get(participantId)
    if (!participant || participant.roomId !== roomId) {
      return res.status(404).json({
        error: 'PARTICIPANT_NOT_FOUND',
        message: `Participant ${participantId} not found in room`
      })
    }

    // 更新参与者模式
    participant.mode = mode
    participants.set(participantId, participant)

    res.json({
      success: true,
      participantId,
      roomId,
      mode,
      message: mode === 'voice' ? 'Switched to voice mode' : 'Switched to text mode'
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/voice/rooms/:roomId/stats - 获取房间统计
router.get('/rooms/:roomId/stats', async (req, res, next) => {
  try {
    const { roomId } = req.params

    const room = rooms.get(roomId)
    if (!room) {
      return res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: `Room ${roomId} not found`
      })
    }

    const participantList = Array.from(room.participants)
      .map(pid => participants.get(pid))
      .filter(p => p)

    const stats = {
      roomId: room.id,
      name: room.name,
      participantCount: room.participants.size,
      maxParticipants: room.maxParticipants,
      mode: room.mode,
      transportConfig: transportModes[room.mode],
      participants: {
        speaking: participantList.filter(p => p.speaking).length,
        audioEnabled: participantList.filter(p => p.audioEnabled).length,
        total: participantList.length
      },
      traffic: {
        currentBitrate: transportModes[room.mode].bitrate,
        ...estimateTraffic(transportModes[room.mode].bitrate)
      }
    }

    res.json(stats)
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/voice/modes - 获取所有传输模式
router.get('/modes', async (req, res, next) => {
  try {
    const modes = Object.entries(transportModes).map(([key, value]) => ({
      mode: key,
      ...value,
      estimatedTraffic: estimateTraffic(value.bitrate)
    }))

    res.json({ modes })
  } catch (error) {
    next(error)
  }
})

export default router