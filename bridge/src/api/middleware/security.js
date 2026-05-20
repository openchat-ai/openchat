import logger from '../../core/monitoring/logger.js';
/**
 * Security Middleware
 * 包含：限流、黑名单评分、认证
 */

const rateLimitStore = new Map()
const endpointStats = new Map()

// 蜜罐路由（不存在的隐藏路由）
const HONEYPOT_ROUTES = ['/admin', '/.env', '/wp-admin', '/phpinfo']

// 黑名单存储
const blacklistStore = new Map()

// 评分规则
const SCORE_RULES = {
  RATE_LIMIT: 10,          // 超限 1 次
  AUTH_FAILED: 20,         // 认证失败
  HIGH_ERROR_RATE: 5,      // 请求错误率高
  HONEYPOT: 50             // 访问蜜罐
}

// 评分阈值
const SCORE_THRESHOLDS = {
  WARNING: 50,
  BLOCK_1H: 100,
  BLOCK_24H: 200
}

// 清理 + 统计
setInterval(() => {
  const now = Date.now()

  // 清理过期限流记录
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.windowStart > 60000) {
      rateLimitStore.delete(key)
    }
  }

  // 自动解锁 + 评分恢复
  for (const [ip, data] of blacklistStore.entries()) {
    // 检查封禁是否到期，到期直接释放
    if (data.blockedUntil && now > data.blockedUntil) {
      data.blockedUntil = null
      logger.info(`[Security] Block expired: ${ip}, remaining score: ${data.score}`)
    }

    // 评分恢复：每分钟无异常扣 2 分
    if (data.score > 0) {
      data.score = Math.max(0, data.score - 2)
      if (data.score === 0) {
        blacklistStore.delete(ip)
      }
    }
  }

  // 高频告警（不暴露具体数据）
  if (endpointStats.size > 0) {
    const topTraffic = Math.max(...endpointStats.values())
    if (topTraffic > 500) {
      logger.info('[Security] High traffic detected')
    }
    endpointStats.clear()
  }
}, 60000)

// 路由限流配置
const ROUTE_LIMITS = {
  '/api/v1/p2p': { max: 200 },
  '/api/v1/agents': { max: 300 },
  '/api/v1/feedback': { max: 300 },
  '/api/v1/decisions': { max: 300 },
  '/api/v1/skills': { max: 100 },
  '/api/v1/versions': { max: 100 },
  '/api/v1/updates': { max: 50 },
  '/api/v1/resources': { max: 200 },
  '/api/v1/metrics': { max: 200 },
  '/api/': { max: 300 }
}

const DEFAULT_AUTH_LIMIT = 500
const UNAUTH_LIMIT = 50

// 获取客户端 ID
const getClientId = (req) => req.ip || req.connection?.remoteAddress || 'unknown'

// 获取路由限流配置
const getRouteLimit = (path) => {
  for (const [route, config] of Object.entries(ROUTE_LIMITS)) {
    if (path.startsWith(route)) return config
  }
  return { max: DEFAULT_AUTH_LIMIT }
}

// 获取或创建黑名单记录
const getBlacklistRecord = (ip) => {
  if (!blacklistStore.has(ip)) {
    blacklistStore.set(ip, { score: 0, blockedUntil: null, reasons: [] })
  }
  return blacklistStore.get(ip)
}

// 加分并检查是否需要拉黑
const addScore = (ip, score, reason) => {
  const record = getBlacklistRecord(ip)
  record.score += score
  record.reasons.push(reason)

  // 检查是否需要拉黑
  if (record.score >= SCORE_THRESHOLDS.BLOCK_24H) {
    record.blockedUntil = Date.now() + 24 * 60 * 60 * 1000
    logger.info(`[Security] BLOCKED 24H: ${ip}, score: ${record.score}`)
  } else if (record.score >= SCORE_THRESHOLDS.BLOCK_1H) {
    record.blockedUntil = Date.now() + 60 * 60 * 1000
    logger.info(`[Security] BLOCKED 1H: ${ip}, score: ${record.score}`)
  } else if (record.score >= SCORE_THRESHOLDS.WARNING) {
    logger.info(`[Security] WARNING: ${ip}, score: ${record.score}`)
  }

  return record.score
}

// 中间件函数
export const securityMiddleware = (req, res, next) => {
  const clientIp = getClientId(req)
  const now = Date.now()

  // 1. 检查黑名单
  const blacklist = blacklistStore.get(clientIp)
  if (blacklist && blacklist.blockedUntil && now < blacklist.blockedUntil) {
    const remaining = Math.ceil((blacklist.blockedUntil - now) / 1000)
    return res.status(403).json({
      error: 'BLOCKED',
      message: 'IP temporarily blocked due to suspicious activity',
      retryAfter: remaining
    })
  }

  // 2. 检查蜜罐路由 - 累加分数，多次触发会升级封禁时间
  const path = req.path
  if (HONEYPOT_ROUTES.some(honeypot => path.includes(honeypot))) {
    const record = addScore(clientIp, SCORE_RULES.HONEYPOT, 'Honeypot access')
    logger.info(`[Security] Honeypot triggered: ${clientIp} -> ${path}, score: ${record}`)
    return res.status(404).json({ error: 'Not Found' })
  }

  // 3. 内部流量统计
  endpointStats.set(path, (endpointStats.get(path) || 0) + 1)

  // 4. 限流检查
  const isAuthenticated = req.headers['authorization']?.startsWith('Bearer ')
  const limit = isAuthenticated ? getRouteLimit(path) : { max: UNAUTH_LIMIT }
  const key = `${clientIp}:${limit.max}`

  let clientData = rateLimitStore.get(key)
  if (!clientData || now - clientData.windowStart > 60000) {
    clientData = { windowStart: now, count: 0, limitValue: limit.max }
    rateLimitStore.set(key, clientData)
  }

  clientData.count++
  const remaining = clientData.limitValue - clientData.count

  // 限流响应头
  if (clientData.count === 1 || remaining <= 10 || remaining < 0) {
    res.set('X-RateLimit-Limit', clientData.limitValue)
    res.set('X-RateLimit-Remaining', Math.max(0, remaining))
  }

  // 超限处理
  if (remaining < 0) {
    addScore(clientIp, SCORE_RULES.RATE_LIMIT, 'Rate limit exceeded')
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      retryAfter: Math.ceil((clientData.windowStart + 60000 - now) / 1000)
    })
  }

  next()
}

// 认证失败处理
export const recordAuthFailure = (ip) => {
  addScore(ip, SCORE_RULES.AUTH_FAILED, 'Authentication failed')
}

// 错误率高处理
export const recordHighErrorRate = (ip) => {
  addScore(ip, SCORE_RULES.HIGH_ERROR_RATE, 'High error rate')
}

// 获取黑名单状态（内部使用）
export const getBlacklistStatus = () => {
  const result = {}
  for (const [ip, data] of blacklistStore) {
    if (data.score > 0) {
      result[ip] = { score: data.score, blockedUntil: data.blockedUntil }
    }
  }
  return result
}

export default securityMiddleware