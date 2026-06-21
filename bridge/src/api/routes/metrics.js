/**
 * Metrics API Endpoint
 */

import express from 'express'
const router = express.Router()
import { metrics } from '../middleware/api-middleware.mjs'

// GET /api/v1/metrics - 获取指标摘要
router.get('/', async (req, res, next) => {
  try {
    res.json(metrics.getSummary())
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/metrics/detailed - 获取详细指标
router.get('/detailed', async (req, res, next) => {
  try {
    res.json(metrics.getDetailed())
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/metrics/endpoints - 按端点统计
router.get('/endpoints', async (req, res, next) => {
  try {
    const detailed = metrics.getDetailed()
    res.json({
      endpoints: detailed.endpoints,
      total: detailed.endpoints.length
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/metrics/errors - 错误统计
router.get('/errors', async (req, res, next) => {
  try {
    const detailed = metrics.getDetailed()
    res.json({
      byType: detailed.errors.byType,
      recent: detailed.errors.recent.slice(-20)
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/metrics/reset - 重置指标
router.post('/reset', async (req, res, next) => {
  try {
    metrics.reset()
    res.json({ status: 'reset', timestamp: new Date().toISOString() })
  } catch (error) {
    next(error)
  }
})

export default router