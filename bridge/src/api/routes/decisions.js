/**
 * P0-02: Decisions API Routes
 * 决策记录端点
 */

import express from 'express'
const router = express.Router()

// 模拟决策存储
const decisions = new Map()
let nextDecisionId = 1

// POST /api/v1/decisions - 创建决策
router.post('/', async (req, res, next) => {
  try {
    const { type, feedbackIds, reasoning, metadata } = req.body

    if (!type || !['approve', 'reject', 'defer'].includes(type)) {
      return res.status(400).json({
        error: 'INVALID_DECISION_TYPE',
        message: 'type must be approve, reject, or defer'
      })
    }

    if (!feedbackIds || !Array.isArray(feedbackIds) || feedbackIds.length === 0) {
      return res.status(400).json({
        error: 'INVALID_FEEDBACK_IDS',
        message: 'feedbackIds array is required'
      })
    }

    const decisionId = `decision_${nextDecisionId++}`
    const decision = {
      id: decisionId,
      type,
      feedbackIds,
      reasoning: reasoning || '',
      metadata: metadata || {},
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      executedAt: null
    }

    decisions.set(decisionId, decision)

    res.status(201).json(decision)
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/decisions - 列出所有决策
router.get('/', async (req, res, next) => {
  try {
    const { status, type, limit = 50 } = req.query
    let decisionList = Array.from(decisions.values())

    if (status) {
      decisionList = decisionList.filter(d => d.status === status)
    }
    if (type) {
      decisionList = decisionList.filter(d => d.type === type)
    }

    // 按时间倒序
    decisionList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    // 限制数量
    decisionList = decisionList.slice(0, parseInt(limit))

    res.json({
      decisions: decisionList,
      total: decisions.size
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/decisions/:id - 获取决策详情
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const decision = decisions.get(id)

    if (!decision) {
      return res.status(404).json({
        error: 'DECISION_NOT_FOUND',
        message: `Decision ${id} not found`
      })
    }

    res.json(decision)
  } catch (error) {
    next(error)
  }
})

// PATCH /api/v1/decisions/:id - 更新决策状态
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { status, executedAt } = req.body
    const decision = decisions.get(id)

    if (!decision) {
      return res.status(404).json({
        error: 'DECISION_NOT_FOUND',
        message: `Decision ${id} not found`
      })
    }

    if (status) {
      decision.status = status
    }
    if (executedAt) {
      decision.executedAt = executedAt
    }

    decisions.set(id, decision)

    res.json(decision)
  } catch (error) {
    next(error)
  }
})

export default router