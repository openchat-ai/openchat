/**
 * P0-03: P2P API Routes
 * 8 个端点 - P2P 通信协议
 */

import express from 'express'
const router = express.Router()

// 模拟 P2P 存储
const peers = new Map()
const messages = new Map()
let nextMessageId = 1

// P2P 配置
let p2pConfig = {
  encryption: 'TLS',
  discoveryEnabled: true,
  maxPeers: 50
}

// 消息类型
const MessageType = {
  SKILL_PUBLISH: 'skill_publish',
  SKILL_REQUEST: 'skill_request',
  COLLABORATION_REQUEST: 'collaboration_request',
  COLLABORATION_RESPONSE: 'collaboration_response',
  INSIGHT_SHARE: 'insight_share',
  PERFORMANCE_REPORT: 'performance_report'
}

// POST /api/v1/p2p/messages - 发送消息
router.post('/messages', async (req, res, next) => {
  try {
    const { type, targetPeerId, payload, priority = 'NORMAL' } = req.body

    if (!type || !Object.values(MessageType).includes(type)) {
      return res.status(400).json({
        error: 'INVALID_MESSAGE_TYPE',
        message: `type must be one of: ${Object.values(MessageType).join(', ')}`
      })
    }

    if (!payload) {
      return res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'payload is required'
      })
    }

    const messageId = `msg_${nextMessageId++}`
    const message = {
      id: messageId,
      type,
      sourcePeerId: 'self', // 后续从 P2P 模块获取
      targetPeerId: targetPeerId || null, // null = 广播
      payload,
      priority,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      deliveredAt: null
    }

    messages.set(messageId, message)

    res.status(201).json({
      id: message.id,
      type: message.type,
      status: message.status,
      createdAt: message.createdAt
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/p2p/messages/:id - 查询消息
router.get('/messages/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const message = messages.get(id)

    if (!message) {
      return res.status(404).json({
        error: 'MESSAGE_NOT_FOUND',
        message: `Message ${id} not found`
      })
    }

    res.json(message)
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/p2p/inbox - 收件箱
router.get('/inbox', async (req, res, next) => {
  try {
    const { status, limit = 50 } = req.query
    let inbox = Array.from(messages.values())
      .filter(m => m.targetPeerId === 'self' || m.targetPeerId === null)

    if (status) {
      inbox = inbox.filter(m => m.status === status)
    }

    inbox.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    inbox = inbox.slice(0, parseInt(limit))

    res.json({
      messages: inbox,
      total: inbox.length
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/p2p/peers - 节点列表
router.get('/peers', async (req, res, next) => {
  try {
    const peerList = Array.from(peers.values())

    res.json({
      peers: peerList,
      total: peerList.length
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/p2p/peers/:id/connect - 连接节点
router.post('/peers/:id/connect', async (req, res, next) => {
  try {
    const { id } = req.params
    const { peerAddress } = req.body

    const peer = {
      id,
      address: peerAddress,
      status: 'CONNECTING',
      connectedAt: null
    }

    peers.set(id, peer)

    // 模拟连接成功
    peer.status = 'CONNECTED'
    peer.connectedAt = new Date().toISOString()
    peers.set(id, peer)

    res.json({
      id: peer.id,
      status: peer.status,
      connectedAt: peer.connectedAt
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/v1/p2p/peers/:id - 断开节点
router.delete('/peers/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const peer = peers.get(id)

    if (!peer) {
      return res.status(404).json({
        error: 'PEER_NOT_FOUND',
        message: `Peer ${id} not found`
      })
    }

    peer.status = 'DISCONNECTED'
    peer.disconnectedAt = new Date().toISOString()
    peers.set(id, peer)

    res.json({
      id: peer.id,
      status: 'DISCONNECTED',
      disconnectedAt: peer.disconnectedAt
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/p2p/stats - 统计信息
router.get('/stats', async (req, res, next) => {
  try {
    const stats = {
      peers: {
        total: peers.size,
        connected: Array.from(peers.values()).filter(p => p.status === 'CONNECTED').length,
        connecting: Array.from(peers.values()).filter(p => p.status === 'CONNECTING').length
      },
      messages: {
        total: messages.size,
        pending: Array.from(messages.values()).filter(m => m.status === 'PENDING').length,
        delivered: Array.from(messages.values()).filter(m => m.status === 'DELIVERED').length
      },
      config: p2pConfig
    }

    res.json(stats)
  } catch (error) {
    next(error)
  }
})

// PUT /api/v1/p2p/config - 更新配置
router.put('/config', async (req, res, next) => {
  try {
    const { encryption, discoveryEnabled, maxPeers } = req.body

    if (encryption) p2pConfig.encryption = encryption
    if (discoveryEnabled !== undefined) p2pConfig.discoveryEnabled = discoveryEnabled
    if (maxPeers) p2pConfig.maxPeers = maxPeers

    res.json({
      config: p2pConfig,
      updatedAt: new Date().toISOString()
    })
  } catch (error) {
    next(error)
  }
})

export default router