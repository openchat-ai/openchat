/**
 * P0-01: Updates API Routes
 * 5 个端点 - 热更新系统
 */

import express from 'express'
const router = express.Router()

// 模拟更新存储
const versions = new Map()
const updateHistory = new Map()
let nextUpdateId = 1

// 初始化一些示例版本
versions.set('2.0.0', {
  version: '2.0.0',
  type: 'release',
  size: '50MB',
  changelog: 'Initial release',
  status: 'active'
})
versions.set('2.1.0', {
  version: '2.1.0',
  type: 'security_patch',
  size: '10MB',
  changelog: 'Security fixes and performance improvements',
  status: 'available'
})

// GET /api/v1/updates/available - 检查可用更新
router.get('/available', async (req, res, next) => {
  try {
    const available = Array.from(versions.values())
      .filter(v => v.status === 'available')

    res.json({
      currentVersion: '2.0.0',
      availableVersions: available.map(v => ({
        version: v.version,
        type: v.type,
        size: v.size,
        changelog: v.changelog,
        estimatedUpdateTime: '5 minutes'
      }))
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/updates/history - 获取更新历史（必须在 /:version 之前）
router.get('/history', async (req, res, next) => {
  try {
    const { limit = 10, status } = req.query
    let history = Array.from(updateHistory.values())

    if (status) {
      history = history.filter(h => h.status === status)
    }

    history.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    history = history.slice(0, parseInt(limit))

    res.json({
      history,
      total: updateHistory.size
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/updates/:version - 获取版本信息
router.get('/:version', async (req, res, next) => {
  try {
    const { version } = req.params
    const versionInfo = versions.get(version)

    if (!versionInfo) {
      return res.status(404).json({
        error: 'VERSION_NOT_FOUND',
        message: `Version ${version} not found`
      })
    }

    res.json(versionInfo)
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/updates/:version/apply - 执行更新
router.post('/:version/apply', async (req, res, next) => {
  try {
    const { version } = req.params
    const { autoRollbackIfFailed = true, preferredUpdateTime = 'immediate' } = req.body

    const versionInfo = versions.get(version)
    if (!versionInfo) {
      return res.status(404).json({
        error: 'VERSION_NOT_FOUND',
        message: `Version ${version} not found`
      })
    }

    const updateId = `update_${nextUpdateId++}`
    const update = {
      id: updateId,
      version,
      status: 'in_progress',
      autoRollbackIfFailed,
      preferredUpdateTime,
      startedAt: new Date().toISOString(),
      completedAt: null,
      watchdogAlarms: 0
    }

    updateHistory.set(updateId, update)

    // 模拟更新完成
    setTimeout(() => {
      update.status = 'SUCCESS'
      update.completedAt = new Date().toISOString()
      updateHistory.set(updateId, update)
    }, 2000)

    res.json({
      updateId: update.id,
      version: update.version,
      status: update.status,
      autoRollbackIfFailed: update.autoRollbackIfFailed
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/updates/:version/rollback - 回滚更新
router.post('/:version/rollback', async (req, res, next) => {
  try {
    const { version } = req.params

    const versionInfo = versions.get(version)
    if (!versionInfo) {
      return res.status(404).json({
        error: 'VERSION_NOT_FOUND',
        message: `Version ${version} not found`
      })
    }

    const rollbackId = `rollback_${nextUpdateId++}`
    const rollback = {
      id: rollbackId,
      version,
      status: 'starting',
      startedAt: new Date().toISOString()
    }

    // 模拟回滚完成
    setTimeout(() => {
      rollback.status = 'completed'
    }, 1500)

    res.json({
      rollbackId: rollback.id,
      version: rollback.version,
      status: rollback.status,
      startedAt: rollback.startedAt
    })
  } catch (error) {
    next(error)
  }
})

export default router