import logger from '../../core/logger.js';
/**
 * API Error Handler Middleware
 */

class APIError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.isOperational = true
  }
}

const errorHandler = (err, req, res, next) => {
  logger.error('[API Error]', err.message, err.stack)

  // Joi 验证错误
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.details.map(d => d.message)
    })
  }

  // 操作错误（已知错误）
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message
    })
  }

  // 未知错误
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  })
}

export { APIError, errorHandler }
export default { APIError, errorHandler }