/**
 * Request Validator Middleware
 */

import Joi from 'joi'

// 验证模式
const schemas = {
  // P0-02: Agent schemas
  createAgent: Joi.object({
    role: Joi.string().valid(
      'security_auditor',
      'code_quality_analyzer',
      'performance_analyzer',
      'test_engineer',
      'custom'
    ).required(),
    name: Joi.string().max(100),
    capabilities: Joi.array().items(Joi.string()),
    task: Joi.string().required()
  }),

  aggregateFeedback: Joi.object({
    agentIds: Joi.array().items(Joi.string()).required(),
    options: Joi.object({
      deduplicate: Joi.boolean().default(true),
      prioritize: Joi.boolean().default(true)
    })
  }),

  createDecision: Joi.object({
    type: Joi.string().valid('approve', 'reject', 'defer').required(),
    feedbackIds: Joi.array().items(Joi.string()).required(),
    reasoning: Joi.string().max(2000),
    metadata: Joi.object()
  }),

  // P0-03: P2P schemas
  sendMessage: Joi.object({
    type: Joi.string().valid(
      'skill_publish',
      'skill_request',
      'collaboration_request',
      'collaboration_response',
      'insight_share',
      'performance_report'
    ).required(),
    targetPeerId: Joi.string(),
    payload: Joi.object().required(),
    priority: Joi.string().valid('CRITICAL', 'HIGH', 'NORMAL', 'LOW').default('NORMAL')
  }),

  connectPeer: Joi.object({
    peerAddress: Joi.string().required()
  }),

  // P0-01: Update schemas
  applyUpdate: Joi.object({
    version: Joi.string().required(),
    autoRollbackIfFailed: Joi.boolean().default(true),
    preferredUpdateTime: Joi.string().valid('off_peak', 'immediate')
  }),

  rollbackUpdate: Joi.object({
    version: Joi.string().required()
  }),

  // P0-04: Skill schemas
  createSkill: Joi.object({
    name: Joi.string().max(100).required(),
    description: Joi.string().max(500),
    type: Joi.string().valid('ALGORITHM', 'MODEL', 'PATTERN').required(),
    code: Joi.string().required(),
    tests: Joi.string(),
    documentation: Joi.string()
  }),

  rateSkill: Joi.object({
    skillId: Joi.string().required(),
    rating: Joi.number().min(1).max(5).required(),
    comment: Joi.string().max(500)
  }),

  searchSkills: Joi.object({
    query: Joi.string().max(100),
    type: Joi.string().valid('ALGORITHM', 'MODEL', 'PATTERN'),
    minRating: Joi.number().min(1).max(5),
    limit: Joi.number().min(1).max(100).default(20)
  }),

  // P0-05: Resource schemas
  updateResourcePolicy: Joi.object({
    compression: Joi.string().valid('gzip', 'brotli', 'none'),
    cacheEnabled: Joi.boolean(),
    networkMode: Joi.string().valid('WiFi', 'Mobile', 'Auto'),
    maxStorageMB: Joi.number().min(100)
  })
}

const requestValidator = (req, res, next) => {
  // 根据路径和方法选择验证模式
  const route = req.path
  const method = req.method

  let schema = null

  // P0-02: Agents
  if (route.startsWith('/agents') && method === 'POST') {
    if (route === '/agents') schema = schemas.createAgent
  }
  if (route.startsWith('/feedback') && route.includes('aggregate')) {
    schema = schemas.aggregateFeedback
  }
  if (route.startsWith('/decisions') && method === 'POST') {
    schema = schemas.createDecision
  }

  // P0-03: P2P
  if (route.startsWith('/p2p')) {
    if (route.includes('/messages') && method === 'POST') {
      schema = schemas.sendMessage
    }
    if (route.includes('/connect') && method === 'POST') {
      schema = schemas.connectPeer
    }
  }

  // P0-01: Updates
  if (route.startsWith('/updates')) {
    if (route.includes('/apply') && method === 'POST') {
      schema = schemas.applyUpdate
    }
    if (route.includes('/rollback') && method === 'POST') {
      schema = schemas.rollbackUpdate
    }
  }

  // P0-04: Skills
  if (route.startsWith('/skills')) {
    if (method === 'POST' && !route.includes('/search')) {
      schema = schemas.createSkill
    }
    if (route.includes('/rate') && method === 'POST') {
      schema = schemas.rateSkill
    }
    if (route.includes('/search') || route === '/') {
      schema = schemas.searchSkills
    }
  }

  // P0-05: Resources
  if (route.startsWith('/resources') && method === 'PUT') {
    schema = schemas.updateResourcePolicy
  }

  // 如果有模式，验证请求体
  if (schema) {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    })

    if (error) {
      error.isJoi = true
      return next(error)
    }

    req.body = value
  }

  next()
}

export default requestValidator