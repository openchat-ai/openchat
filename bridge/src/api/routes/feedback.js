/**
 * P0-02: Feedback API Routes
 * 反馈聚合端点
 */

import express from 'express'
const router = express.Router()

// 模拟反馈存储
const allFeedback = new Map()
let nextFeedbackId = 1

// 反馈规范化（按角色类型）
const normalizeFeedback = (feedback, agentRole) => {
  const normalized = {
    ...feedback,
    normalized: true,
    category: agentRole
  }

  switch (agentRole) {
    case 'security_auditor':
      normalized.severity = feedback.severity || 'MEDIUM'
      normalized.vulnerabilities = feedback.vulnerabilities || []
      break
    case 'code_quality_analyzer':
      normalized.issues = feedback.issues || []
      normalized.score = feedback.score || 0
      break
    case 'performance_analyzer':
      normalized.metrics = feedback.metrics || {}
      normalized.recommendations = feedback.recommendations || []
      break
    case 'test_engineer':
      normalized.testResults = feedback.testResults || {}
      normalized.coverage = feedback.coverage || 0
      break
  }

  return normalized
}

// 反馈去重（简单文本相似度）
const deduplicateFeedback = (feedbackList) => {
  const unique = []
  const seen = new Set()

  for (const fb of feedbackList) {
    const key = JSON.stringify(fb)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(fb)
    }
  }

  return unique
}

// 反馈优先级排序
const prioritizeFeedback = (feedbackList) => {
  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

  return feedbackList.sort((a, b) => {
    const pa = priorityOrder[a.priority || 'MEDIUM']
    const pb = priorityOrder[b.priority || 'MEDIUM']
    return pa - pb
  })
}

// POST /api/v1/feedback/aggregate - 聚合反馈
router.post('/aggregate', async (req, res, next) => {
  try {
    const { agentIds, options = {} } = req.body

    if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ error: 'INVALID_AGENT_IDS', message: 'agentIds array is required' })
    }

    // 收集所有反馈
    let allFeedbackList = []
    const feedbackByAgent = {}

    for (const agentId of agentIds) {
      // 这里应该从实际的 agent storage 获取
      feedbackByAgent[agentId] = []
      allFeedbackList = allFeedbackList.concat(feedbackByAgent[agentId])
    }

    // 步骤 1：规范化
    if (options.normalize !== false) {
      allFeedbackList = allFeedbackList.map(fb =>
        normalizeFeedback(fb, fb.agentRole || 'custom')
      )
    }

    // 步骤 2：去重
    if (options.deduplicate !== false) {
      allFeedbackList = deduplicateFeedback(allFeedbackList)
    }

    // 步骤 3：优先级排序
    if (options.prioritize !== false) {
      allFeedbackList = prioritizeFeedback(allFeedbackList)
    }

    // 生成聚合结果
    const aggregatedResult = {
      id: `agg_${nextFeedbackId++}`,
      agentIds,
      timestamp: new Date().toISOString(),
      feedbackCount: allFeedbackList.length,
      feedback: allFeedbackList,
      summary: generateSummary(allFeedbackList),
      options
    }

    res.json(aggregatedResult)
  } catch (error) {
    next(error)
  }
})

// 生成摘要
function generateSummary(feedbackList) {
  const summary = {
    total: feedbackList.length,
    byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byCategory: {}
  }

  for (const fb of feedbackList) {
    const priority = fb.priority || 'MEDIUM'
    summary.byPriority[priority]++

    const category = fb.category || 'custom'
    summary.byCategory[category] = (summary.byCategory[category] || 0) + 1
  }

  return summary
}

export default router