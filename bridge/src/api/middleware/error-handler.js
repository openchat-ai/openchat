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
  const reqId = req?.id || 'unknown';
  console.error(JSON.stringify({
    level: 'error',
    reqId,
    path: req?.originalUrl,
    method: req?.method,
    message: err.message,
    stack: err.stack?.split('\n').slice(0, 3).join(' | '),
    timestamp: new Date().toISOString(),
  }));

  // Joi 验证错误
  if (err.isJoi) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.details.map(d => d.message),
      reqId,
    });
  }

  // 操作错误（已知错误）
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      reqId,
    });
  }

  // 未知错误
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    reqId,
  });
}

export { APIError, errorHandler }
export default { APIError, errorHandler }