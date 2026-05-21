/**
 * OpenChat API Server
 * 统一的 REST API 框架
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import http from 'http';
import net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import swaggerUi from 'swagger-ui-express';

import { errorHandler } from './middleware/error-handler.js';
import requestValidator from './middleware/request-validator.js';
import { securityMiddleware, recordAuthFailure } from './middleware/security.js';
import { authMiddleware } from './middleware/auth.js';
import { DEFAULT_PORT } from '../constants.js';

// 路由
import agentsRouter from './routes/agents.js';
import feedbackRouter from './routes/feedback.js';
import decisionsRouter from './routes/decisions.js';
import { createP2PRouter } from './routes/p2p.js';
import updatesRouter from './routes/updates.js';
import skillsRouter from './routes/skills.js';
import versionsRouter from './routes/versions.js';
import resourcesRouter from './routes/resources.js';
import legacyRouter from './routes/legacy.js';
import metricsRouter from './routes/metrics.js';
import healthRouter from './routes/health.js';
import voiceRouter from './routes/voice.js';
import signalingRouter from './routes/signaling.js';
import residentsRouter from './routes/residents.js';
import sageRouter from './routes/sage.js';
import { residentManager } from '../core/agent/resident-manager.js';

class APIServer {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.swarm = options.swarm || null;
    this.deployEnabled = options.deployEnabled !== false;
    this.app = express();
    this.server = null;
    this.wss = null;
    this.signalingWss = null;
    this._signalingRooms = new Map();
    this._onWSMessage = null;

    this.setupMiddlewares();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setWSMessageHandler(handler) {
    this._onWSMessage = handler;
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
        ? ['https://localhost:3800']
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
    // 健康检查 + 公开端点（无需认证）
    this.app.use('/health', healthRouter);
    this.app.get('/peers', (req, res) => {
      const p2p = this.swarm;
      const peers = p2p ? [...(p2p.connectedPeers?.keys() || [])].map(id => ({
        peerId: id.slice(0, 8),
        info: (p2p.peerInfo?.get(id)) || {}
      })) : [];
      res.json({ peers });
    });

    // OpenAPI docs (no auth required)
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const openApiPath = path.resolve(__dirname, 'openapi.json');
    if (fs.existsSync(openApiPath)) {
      const openApiDoc = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
      this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'OpenChat API Docs',
      }));
    }

    // 根路径 HTML Dashboard
    this.app.get('/', (req, res) => {
      res.send(`<html lang="zh"><head><meta charset="utf-8"><title>OpenChat</title></head>
<body style="background:#0a0a1a;color:#e0e0e0;font-family:monospace;padding:20px">
<h1 style="color:#7c8aff">OpenChat Bridge</h1>
<pre id="out" style="font-size:13px;line-height:1.6">Loading...</pre>
<script>
async function R(){
  try{const d=await(await fetch('/api/dashboard')).json();
  let h='IQ: <b style=color:#7c8aff>'+d.iq+'</b>  Age: <b style=color:#ffa502>'+d.age+'</b>  Solved: <b style=color:#2ed573>'+d.solved+'</b>  Pool: <b style=color:#4fc3f7>'+d.poolSize+'</b> (Pending: '+d.pending+')';
  document.getElementById('out').innerHTML=h;
  }catch(e){document.getElementById('out').textContent='Waiting...';}
}R();setInterval(R,3000);
</script></body></html>`);
    });

    // API 信息（无需认证）
    this.app.get('/api/v1', (req, res) => {
      res.json({
        version: '1.0',
        endpoints: '/api/v1/agents, /api/v1/p2p, /api/v1/updates, /api/v1/skills, /api/v1/versions, /api/v1/resources, /api/v1/voice, /api/v1/residents, /api/v1/sage'
      });
    });

    // 以下路由使用 Bearer Token 强制认证
    // Legacy Compatibility Layer
    this.app.use('/api', authMiddleware, legacyRouter);

    // P0-02: 多代理协作 API
    this.app.use('/api/v1/agents', authMiddleware, agentsRouter);
    this.app.use('/api/v1/feedback', authMiddleware, feedbackRouter);
    this.app.use('/api/v1/decisions', authMiddleware, decisionsRouter);

    // P0-03: P2P 通信 API（createP2PRouter 内部有 null-swarm guard）
    this.app.use('/api/v1/p2p', authMiddleware, createP2PRouter(this.swarm));

    // P0-01: 热更新 API
    this.app.use('/api/v1/updates', authMiddleware, updatesRouter);

    // P0-04: 版本管理和 Skill 市场 API
    this.app.use('/api/v1/skills', authMiddleware, skillsRouter);
    this.app.use('/api/v1/versions', authMiddleware, versionsRouter);

    // P0-05: 资源优化 API
    this.app.use('/api/v1/resources', authMiddleware, resourcesRouter);

    // Voice API (语音房间管理)
    this.app.use('/api/v1/voice', authMiddleware, voiceRouter);
    this.app.use('/api/v1/signaling', authMiddleware, signalingRouter);

    // Residents API (AI 居民管理)
    this.app.use('/api/v1/residents', authMiddleware, residentsRouter);

    // Sage API (智者 — 天人点拨)
    this.app.use('/api/v1/sage', authMiddleware, sageRouter);

    // Community feed — 社区动态流（聚合所有居民最新活动）
    this.app.get('/api/v1/community/feed', authMiddleware, (req, res, next) => {
      try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const feed = residentManager.getCommunityFeed(limit);
        res.json({ feed, total: feed.length });
      } catch (e) { next(e); }
    });

    // Metrics API
    this.app.use('/api/v1/metrics', authMiddleware, metricsRouter);

    // Deploy 站点（Bridge 自带 — 可配 bridge.deployServerEnabled=false 关闭）
    if (this.deployEnabled) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const deployDir = path.resolve(__dirname, '..', '..', '..', 'deploy');
      this.app.use('/deploy', express.static(deployDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.zip')) res.set('Content-Type', 'application/zip');
          if (filePath.endsWith('.tar.gz')) res.set('Content-Type', 'application/gzip');
        }
      }));
    }

    // 404 处理
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not Found', path: req.path });
    });
  }

  setupErrorHandling() {
    this.app.use(errorHandler);
  }

  setupWebSocket(server) {

    // Track connected clients (used by route-handlers for P2P forwarding)
    this.clients = new Set();

    // Chat WebSocket
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      console.log('[WS] client connected');
      ws._peerId = 'ws-' + Date.now().toString(36);
      this.clients.add(ws);
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (this._onWSMessage) this._onWSMessage(ws, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', data: { message: e.message } }));
        }
      });
      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('[WS] client disconnected');
      });
      ws.send(JSON.stringify({ type: 'bridge_handshake', data: { version: 2 } }));
    });

    // WebRTC 信令 WebSocket
    this.signalingWss = new WebSocketServer({ server, path: '/signaling' });
    this.signalingWss.on('connection', (ws) => {
      let registeredPeerId = null;
      console.log('[Signaling] 客户端已连接 via Express');
      ws.on('message', (data) => {
        // Binary frame → forward to target peer as-is
        if (Buffer.isBuffer(data)) {
          if (data.length < 3) return;
          // Relay binary to target peer extracted from frame header
          const frameType = data[2];
          if (frameType === 0x01 || frameType === 0x03) {
            // Audio/ACK frames relay to registered peerId
            if (registeredPeerId && this.swarm) {
              this._relayToNetwork({ raw: true, data: data }, ws);
            }
          }
          // Forward binary frame to all peers on this bridge (for 1-to-1)
          const targetWs = this._signalingRooms.get(registeredPeerId);
          if (targetWs && targetWs.readyState === 1 && targetWs !== ws) {
            targetWs.send(data);
          }
          return;
        }

        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'signaling_message' && msg.data) {
            const d = msg.data;
            if (d.action === 'register') {
              registeredPeerId = d.peerId;
              this._signalingRooms.set(registeredPeerId, ws);
              ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'registered', peerId: registeredPeerId } }));
              return;
            }
            if (d.action === 'audio-data' || d.action === 'route-gossip' || d.action === 'route-update') {
              this._routeSignaling(d, ws);
              return;
            }
            if (d.toPeerId) {
              const target = this._signalingRooms.get(d.toPeerId);
              if (target && target.readyState === 1) {
                target.send(JSON.stringify(msg));
              } else {
                // Target not on this Bridge — forward via P2P network
                this._relayToNetwork(d, ws);
              }
              return;
            }
          }
        } catch (e) { console.error('[Signaling] error:', e.message); }
      });
      ws.on('close', () => {
        if (registeredPeerId) this._signalingRooms.delete(registeredPeerId);
        // Notify P2P network that this peer left
        if (this.swarm && registeredPeerId) {
          this.swarm.broadcast({ type: 'peer_left', peerId: registeredPeerId });
        }
      });
    });
  }

  /** Route audio/gossip messages — try local first, then P2P network */
  _routeSignaling(data, ws) {
    const toPeerId = data['toPeerId'];
    if (!toPeerId) return;

    const target = this._signalingRooms.get(toPeerId);
    if (target && target.readyState === 1) {
      target.send(JSON.stringify({ type: 'signaling_message', data: data }));
      return;
    }

    // Forward via P2P network to the Bridge that has this peer
    this._relayToNetwork(data, ws);
  }

  /** Forward signaling data through P2P network to remote Bridges */
  _relayToNetwork(data, ws) {
    if (!this.swarm) return;
    this.swarm.broadcast({
      type: 'signaling_relay',
      fromBridge: this.swarm._peerId || 'unknown',
      data: data,
    });
  }

  async start() {
    // Start raw TCP signaling server (port = Express port + 1)
    this._tcpServer = net.createServer((socket) => {
      let registeredPeerId = null;
      socket.on('data', (buffer) => {
        // Frame format: [type(1), targetLen(1), target, payload...]
        // type: 1=register, 2=data, 3=forward
        if (buffer.length < 2) return;
        const type = buffer[0];
        const targetLen = buffer[1];

        if (type === 1) {
          // Register: payload = peerId
          registeredPeerId = buffer.subarray(2).toString('utf8').replace(/\0/g, '');
          this._signalingRooms.set(registeredPeerId, socket);
          // Send registration confirmation
          socket.write(Buffer.from([0x01, 0x00]));
          console.log('[TCP] Peer registered:', registeredPeerId?.slice(0, 8));
          return;
        }

        if (type === 2 && targetLen > 0 && buffer.length >= 2 + targetLen + 1) {
          const targetId = buffer.subarray(2, 2 + targetLen).toString('utf8');
          const payload = buffer.subarray(2 + targetLen);
          const target = this._signalingRooms.get(targetId);
          if (target) {
            target.write(Buffer.concat([Buffer.from([0x02, registeredPeerId?.length || 0, ...(registeredPeerId || '').split('').map(c => c.charCodeAt(0))]), payload]));
          }
          return;
        }

        // Raw binary frame (VoiceFrame format)
        if (buffer.length >= 5 && buffer[0] === 0x0C && buffer[1] === 0x7A) {
          const frameType = buffer[2];
          if (frameType === 0x01 || frameType === 0x03) {
            // Audio/ACK: relay to all other peers on this bridge
            for (const [id, s] of this._signalingRooms) {
              if (id !== registeredPeerId && s.readyState === 'open') {
                s.write(buffer);
              }
            }
          }
        }
      });

      socket.on('close', () => {
        if (registeredPeerId) {
          this._signalingRooms.delete(registeredPeerId);
          console.log('[TCP] Peer left:', registeredPeerId?.slice(0, 8));
        }
      });

      socket.on('error', () => {});
    });

    const tcpPort = this.port + 1;
    this._tcpServer.listen(tcpPort, () => {
      console.log(`[Signaling] TCP server on port ${tcpPort}`);
    });

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
      if (this.wss) this.wss.close();
      if (this.signalingWss) this.signalingWss.close();
      if (this._tcpServer) this._tcpServer.close();
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('[API] Server stopped');
          resolve();
        });
      });
    }
  }
}

import { setBridgeContext } from './routes/legacy.js';
export { setBridgeContext };
export default APIServer;
