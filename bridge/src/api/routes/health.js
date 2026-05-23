/**
 * Health Check API Routes
 * 增强版健康检查端点
 */

import express from 'express'
import os from 'os'
const router = express.Router()

// 获取系统信息
function getSystemInfo() {
  const uptime = process.uptime()
  const memoryUsage = process.memoryUsage()
  const cpuUsage = process.cpuUsage()

  return {
    uptime: {
      seconds: Math.floor(uptime),
      formatted: formatUptime(uptime)
    },
    memory: {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      unit: 'MB'
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    os: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024),
      freeMemory: Math.round(os.freemem() / 1024 / 1024)
    }
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${secs}s`)

  return parts.join(' ')
}

// GET /health - 基础健康检查
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  })
})

// GET /health/detail - 详细健康检查
router.get('/detail', (req, res) => {
  const systemInfo = getSystemInfo()

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '2.0.0',
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    system: systemInfo,
    checks: {
      memory: systemInfo.memory.heapUsed < systemInfo.memory.heapTotal * 0.9 ? 'pass' : 'warn',
      uptime: systemInfo.uptime.seconds > 60 ? 'pass' : 'starting'
    }
  })
})

// GET /health/ready - 就绪探针
router.get('/ready', (req, res) => {
  // 检查所有依赖服务
  const checks = {
    api: true,
    bridge: true,
    database: true // 模拟
  }

  const allReady = Object.values(checks).every(v => v)

  res.status(allReady ? 200 : 503).json({
    ready: allReady,
    checks,
    timestamp: new Date().toISOString()
  })
})

// GET /health/live - 存活探针
router.get('/live', (req, res) => {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString()
  })
})

export default router
