/**
 * API Authentication Middleware
 * Bearer Token 认证中间件
 */

import { recordAuthFailure } from './security.js';

// 从环境变量获取 Bearer Token，支持多个
const getValidTokens = () => {
  const tokens = process.env.API_KEYS || process.env.API_KEY || '';
  if (!tokens) return [];
  return tokens.split(',').map(t => t.trim()).filter(Boolean);
};

// 检查是否禁用认证（开发模式）
const isAuthDisabled = () => {
  return process.env.DISABLE_API_AUTH === 'true' ||
         process.env.NODE_ENV === 'test' ||
         process.env.DEV_MODE === 'true';
};

// 获取客户端 IP
const getClientIp = (req) => req.ip || req.connection?.remoteAddress || 'unknown'

/**
 * Bearer Token 认证中间件（必须认证）
 */
export const authMiddleware = (req, res, next) => {
  if (isAuthDisabled()) {
    req.authenticated = true;
    return next();
  }

  const validTokens = getValidTokens();

  if (validTokens.length === 0) {
    req.authenticated = true;
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    recordAuthFailure(getClientIp(req))
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authorization header required'
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    recordAuthFailure(getClientIp(req))
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid authorization format'
    });
  }

  const token = authHeader.slice(7);

  if (!validTokens.includes(token)) {
    recordAuthFailure(getClientIp(req))
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Invalid token'
    });
  }

  req.authenticated = true;
  req.token = token;
  next();
};

/**
 * 可选认证（兼容旧接口）
 */
export const optionalAuth = (req, res, next) => {
  if (isAuthDisabled()) {
    req.authenticated = true;
    return next();
  }

  const validTokens = getValidTokens();
  if (validTokens.length === 0) {
    req.authenticated = true;
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    req.authenticated = false;
    return next();
  }

  if (!authHeader.startsWith('Bearer ')) {
    recordAuthFailure(getClientIp(req))
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid authorization format'
    });
  }

  const token = authHeader.slice(7);

  if (!validTokens.includes(token)) {
    recordAuthFailure(getClientIp(req))
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: 'Invalid token'
    });
  }

  req.authenticated = true;
  req.token = token;
  next();
};

export default authMiddleware;
