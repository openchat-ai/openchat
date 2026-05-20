import logger from '../../core/logger.js';
/**
 * Rate Limiter Middleware
 * 双重限流策略 + 分路由限流 + 内部流量统计
 */

// 限流存储
const rateLimitStore = new Map()

// 内部流量统计（不暴露给客户端）
const endpointStats = new Map()

// 清理过期的记录 + 统计
setInterval(() => {
  const now = Date.now()

  // 清理限流记录
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.windowStart > 60000) {
      rateLimitStore.delete(key)
    }
  }

  // 输出流量统计（只记录，不暴露给外部）
  if (endpointStats.size > 0) {
    const sorted = [...endpointStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    // 只在高频异常时输出
    const topTraffic = sorted[0]?.[1] || 0
    if (topTraffic > 500) {
      logger.info('[RateLimit] High traffic detected:', sorted.map(([k, v]) => `${k}:${v}`).join(', '))
    }

    // 重置统计
    endpointStats.clear()
  }
}, 60000)

// 已认证用户的分路由限流配置
const ROUTE_LIMITS = {
  // P2P 通信 - 中高频
  '/api/v1/p2p': { windowMs: 60000, max: 200 },
  // Agents/Feedback/Decisions - 中频
  '/api/v1/agents': { windowMs: 60000, max: 300 },
  '/api/v1/feedback': { windowMs: 60000, max: 300 },
  '/api/v1/decisions': { windowMs: 60000, max: 300 },
  // Skills/Versions - 低频
  '/api/v1/skills': { windowMs: 60000, max: 100 },
  '/api/v1/versions': { windowMs: 60000, max: 100 },
  // Updates - 低频
  '/api/v1/updates': { windowMs: 60000, max: 50 },
  // Resources/Metrics - 中频
  '/api/v1/resources': { windowMs: 60000, max: 200 },
  '/api/v1/metrics': { windowMs: 60000, max: 200 },
  // Legacy - 中频
  '/api/': { windowMs: 60000, max: 300 }
}

// 默认已认证限制
const DEFAULT_AUTH_LIMIT = 500

// 未认证限制
const UNAUTH_LIMIT = 50

const getClientId = (req) => {
  return req.ip || req.connection.remoteAddress || 'unknown'
}

// 获取路由对应的限流配置
const getRouteLimit = (path) => {
  // 精确匹配优先
  if (ROUTE_LIMITS[path]) {
    return ROUTE_LIMITS[path]
  }

  // 前缀匹配
  for (const [route, config] of Object.entries(ROUTE_LIMITS)) {
    if (path.startsWith(route)) {
      return config
    }
  }

  // 默认限制
  return { windowMs: 60000, max: DEFAULT_AUTH_LIMIT }
}

// 获取限流 key
const getRateLimitKey = (req, limitConfig) => {
  const clientId = getClientId(req)
  return `${clientId}:${limitConfig.max}`
}

const rateLimiter = (req, res, next) => {
  // 统计内部流量（不暴露）
  const endpoint = req.path.split('?')[0]
  endpointStats.set(endpoint, (endpointStats.get(endpoint) || 0) + 1)

  // 判断是否已认证
  const isAuthenticated = req.headers['authorization']?.startsWith('Bearer ')

  // 获取对应路由的限流配置
  const limitConfig = isAuthenticated
    ? getRouteLimit(req.path)
    : { windowMs: 60000, max: UNAUTH_LIMIT }

  const limit = limitConfig
  const key = getRateLimitKey(req, limit)
  const now = Date.now()

  let clientData = rateLimitStore.get(key)

  // 窗口过期则重置
  if (!clientData || now - clientData.windowStart > limit.windowMs) {
    clientData = {
      windowStart: now,
      count: 0,
      limitValue: limit.max  // 记录该客户端的限流值
    }
    rateLimitStore.set(key, clientData)
  }

  clientData.count++
  const remaining = clientData.limitValue - clientData.count

  // 只在以下情况返回限流头：
  // 1. 每分钟第1次请求（让客户端知道限额）
  // 2. 剩余 <= 10（快超限警告）
  // 3. 已被限流（必须返回）
  if (clientData.count === 1 || remaining <= 10 || remaining < 0) {
    res.set('X-RateLimit-Limit', clientData.limitValue)
    res.set('X-RateLimit-Remaining', Math.max(0, remaining))
  }

  if (remaining < 0) {
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Limit: ${clientData.limitValue} per minute`,
      retryAfter: Math.ceil((clientData.windowStart + limit.windowMs - now) / 1000)
    })
  }

  next()
}

export default rateLimiter