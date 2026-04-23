/**
 * OpenChat API Server
 * 统一的 REST API 框架
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { errorHandler } from './middleware/error-handler.js';
import requestValidator from './middleware/request-validator.js';
import { securityMiddleware, recordAuthFailure } from './middleware/security.js';
import { authMiddleware } from './middleware/auth.js';

// 路由
import agentsRouter from './routes/agents.js';
import feedbackRouter from './routes/feedback.js';
import decisionsRouter from './routes/decisions.js';
import p2pRouter from './routes/p2p.js';
import updatesRouter from './routes/updates.js';
import skillsRouter from './routes/skills.js';
import versionsRouter from './routes/versions.js';
import resourcesRouter from './routes/resources.js';
import legacyRouter from './routes/legacy.js';
import metricsRouter from './routes/metrics.js';
import healthRouter from './routes/health.js';

class APIServer {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.app = express();
    this.server = null;

    this.setupMiddlewares();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddlewares() {
    // 安全头
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: true,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: { maxAge: 31536000, includeSubDomains: true },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true
    }));

    // CORS - 根据环境配置
    const corsOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
      : process.env.NODE_ENV === 'production'
        ? ['https://localhost:3000']
        : '*';

    this.app.use(cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
      credentials: true,
      maxAge: 86400 // 24 hours
    }));

    // 请求日志
    this.app.use(morgan('combined'));

    // 请求体解析 - 限制大小
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // 请求验证
    this.app.use(requestValidator);

    // 安全中间件（限流 + 黑名单）
    this.app.use(securityMiddleware);
  }

  setupRoutes() {
    // 健康检查（无需认证，无限流）
    this.app.use('/health', healthRouter);

    // API 信息（无需认证）
    this.app.get('/api/v1', (req, res) => {
      res.json({
        version: '1.0',
        endpoints: '/api/v1/agents, /api/v1/p2p, /api/v1/updates, /api/v1/skills, /api/v1/versions, /api/v1/resources'
      });
    });

    // 以下路由使用 Bearer Token 强制认证
    // Legacy Compatibility Layer
    this.app.use('/api', authMiddleware, legacyRouter);

    // P0-02: 多代理协作 API
    this.app.use('/api/v1/agents', authMiddleware, agentsRouter);
    this.app.use('/api/v1/feedback', authMiddleware, feedbackRouter);
    this.app.use('/api/v1/decisions', authMiddleware, decisionsRouter);

    // P0-03: P2P 通信 API
    this.app.use('/api/v1/p2p', authMiddleware, p2pRouter);

    // P0-01: 热更新 API
    this.app.use('/api/v1/updates', authMiddleware, updatesRouter);

    // P0-04: 版本管理和 Skill 市场 API
    this.app.use('/api/v1/skills', authMiddleware, skillsRouter);
    this.app.use('/api/v1/versions', authMiddleware, versionsRouter);

    // P0-05: 资源优化 API
    this.app.use('/api/v1/resources', authMiddleware, resourcesRouter);

    // Metrics API
    this.app.use('/api/v1/metrics', authMiddleware, metricsRouter);

    // 404 处理
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not Found', path: req.path });
    });
  }

  setupErrorHandling() {
    this.app.use(errorHandler);
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          console.log(`[API] Server running on port ${this.port}`);
          resolve(this.server);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('[API] Server stopped');
          resolve();
        });
      });
    }
  }
}

export default APIServer;
