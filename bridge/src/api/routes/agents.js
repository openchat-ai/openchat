/**
 * P0-02: Agents API Routes
 * 8 个端点 - 多代理协作框架
 * 支持真实模块连接（通过环境变量控制）
 * 扩展：支持 residentId 过滤 + 活动日志
 */

import express from 'express'
import { residentManager } from '../../core/resident-manager.js'

const router = express.Router()

// 模拟的 Agent 存储（后备方案）
const agents = new Map()
let nextAgentId = 1

// 真实模块引用
let coordinator = null
let useRealModule = process.env.USE_REAL_MODULES === 'true'

// 初始化真实模块
async function initCoordinator() {
  if (!coordinator && useRealModule) {
    try {
      const { getMultiAgentCoordinator } = await import('../integrations/index.js')
      coordinator = await getMultiAgentCoordinator()
      console.log('[Agents API] Using real MultiAgentCoordinator')
    } catch (e) {
      console.log('[Agents API] Failed to load real module, using mock:', e.message)
      useRealModule = false
    }
  }
}

// 模块初始化
initCoordinator()

// 角色工厂
const roleCapabilities = {
  security_auditor: {
    description: '安全审计和漏洞检测',
    capabilities: ['vulnerability_scan', 'security_audit', 'threat_detection']
  },
  code_quality_analyzer: {
    description: '代码质量和最佳实践分析',
    capabilities: ['code_review', 'style_check', 'complexity_analysis']
  },
  performance_analyzer: {
    description: '性能分析和优化建议',
    capabilities: ['profiling', 'bottleneck_detection', 'optimization_suggestions']
  },
  test_engineer: {
    description: '测试用例生成和测试执行',
    capabilities: ['test_generation', 'test_execution', 'coverage_analysis']
  },
  custom: {
    description: '自定义角色',
    capabilities: []
  }
}

// POST /api/v1/agents - 创建代理
router.post('/', async (req, res, next) => {
  try {
    const { role, name, capabilities, task, residentId } = req.body

    const agentId = `agent_${nextAgentId++}`
    const agent = {
      id: agentId,
      role: role || 'custom',
      name: name || `${role}_${agentId}`,
      capabilities: capabilities || roleCapabilities[role || 'custom']?.capabilities || [],
      task,
      status: 'RUNNING',
      createdAt: new Date().toISOString(),
      feedback: [],
      residentId: residentId || null
    }

    agents.set(agentId, agent)

    // 活动日志：Agent 出生
    if (residentId) {
      residentManager.addActivity(residentId, {
        type: 'agent_created',
        message: `派出 ${agent.role} 执行任务: ${task || '未知任务'}`,
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        task: task || null
      })
    }

    res.status(201).json({
      id: agent.id,
      role: agent.role,
      name: agent.name,
      status: agent.status,
      createdAt: agent.createdAt,
      residentId: agent.residentId
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/agents - 列出所有代理
router.get('/', async (req, res, next) => {
  try {
    const { status, residentId } = req.query
    let agentList = Array.from(agents.values())

    if (status) {
      agentList = agentList.filter(a => a.status === status)
    }

    if (residentId) {
      const rid = parseInt(residentId, 10)
      if (!isNaN(rid)) {
        agentList = agentList.filter(a => a.residentId === rid)
      }
    }

    res.json({
      agents: agentList.map(a => ({
        id: a.id,
        role: a.role,
        name: a.name,
        status: a.status,
        createdAt: a.createdAt,
        residentId: a.residentId
      })),
      total: agentList.length
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/agents/:id - 获取代理详情
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const agent = agents.get(id)

    if (!agent) {
      return res.status(404).json({ error: 'AGENT_NOT_FOUND', message: `Agent ${id} not found` })
    }

    res.json(agent)
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/agents/:id/feedback - 获取代理反馈
router.get('/:id/feedback', async (req, res, next) => {
  try {
    const { id } = req.params
    const agent = agents.get(id)

    if (!agent) {
      return res.status(404).json({ error: 'AGENT_NOT_FOUND', message: `Agent ${id} not found` })
    }

    res.json({
      agentId: id,
      feedback: agent.feedback || []
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/v1/agents/:id - 终止代理
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const agent = agents.get(id)

    if (!agent) {
      return res.status(404).json({ error: 'AGENT_NOT_FOUND', message: `Agent ${id} not found` })
    }

    // 标记为终止
    agent.status = 'TERMINATED'
    agent.terminatedAt = new Date().toISOString()
    agents.set(id, agent)

    // 活动日志：Agent 完成
    if (agent.residentId) {
      residentManager.addActivity(agent.residentId, {
        type: 'agent_completed',
        message: `完成了任务: ${agent.task || '未知任务'}`,
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        task: agent.task || null
      })
    }

    res.json({
      id: agent.id,
      status: 'TERMINATED',
      terminatedAt: agent.terminatedAt
    })
  } catch (error) {
    next(error)
  }
})

export default router
