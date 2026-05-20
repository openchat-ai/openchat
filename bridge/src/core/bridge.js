import 'dotenv/config';
import * as readline from 'readline';
import crypto from 'crypto';
import path from 'path';
import http from 'http';
import { Router } from 'express';
import { sessionManager } from '../session/session-manager.js';
import { startFairyMonitor, startHeartbeat } from './learning-loop.js';
import { dashboardHTML } from '../infra/dashboard-html.js';
import { createHandlers } from '../infra/route-handlers.js';
import { GossipManager } from '../p2p/gossip-manager.js';
import { MessageType } from '../protocol/message.js';
import { WebSocketServer } from 'ws';
import { router } from './router.js';
import { initCore } from './handlers.js';
import { memoryManager } from '../memory/memory-manager.js';
import { AIPerson, aiPersonRegistry, createFounder } from './ai-personhood.js';
import { Deity, deitySystemManager, DEITY_TYPE } from './deity-system.js';
import { MirrorDeity, mirrorDeity, initializeMirrorDeitySystem } from './mirror-deity.js';
import { EnergyDeity, energyDeity, initializeEnergySystem, ENERGY_TYPE, POWER_MODE } from './energy-deity.js';
import { aiPersonFactory, AI_TEMPLATES } from './ai-person-factory.js';
import { deityGovernance } from './deity-governance.js';
import { identityGenerator } from './identity-generator.js';
import { aiPersonManager } from './ai-person-manager.js';
import { setupCLI } from '../cli/bridge-cli.js';
import { getEnhancedStabilitySystem } from './enhanced-stability-system.js';
import { CollaborationEngine } from './collaboration-engine.js';
import { residentManager } from './resident-manager.js';
import { residentScheduler } from './resident-scheduler.js';
import { getPublicIPv4 } from '../p2p/p2p-net.js';
import { MessageType as P2PMessageType } from '../p2p/messages.js';
import { PeerRegistry } from '../p2p/peer-registry.js';
import { QiniuBackend } from '../p2p/peer-registry/qiniu-backend.js';
import { HttpBackend } from '../p2p/peer-registry/http-backend.js';
import logger from './logger.js';

class Bridge {
  constructor(CONFIG, parsedConfig) {
    this.CONFIG = CONFIG;
    const { hostId, houseIdArg, effectiveBodyId, deployServerEnabled, deployServerPort, isMain, isNesting, isHeadless, COMMANDS, port } = parsedConfig;
    this._parsed = parsedConfig;
    this.isMain = isMain;
    this.port = port;
    this.clientId = process.env.CLIENT_ID || crypto.randomUUID();
    this.wss = null;
    this.httpServer = null;
    this.apiServer = null;
    this.clients = new Set();
    this.rl = null;
    this.startTime = Date.now();
    this.legacyRouter = Router();
    this.stabilitySystem = getEnhancedStabilitySystem({
      enableErrorHandling: true,
      enableMemoryManagement: true,
      enablePerformanceMonitoring: true,
      enableHealthChecking: true,
      enableMultiAgent: true
    });
    this.collaborationEngine = new CollaborationEngine({
      maxConcurrency: 5,
      heartbeatInterval: 30000,
      timeout: 30000,
      retryAttempts: 3,
      aggregationStrategy: 'consensus',
      consensusThreshold: 0.6
    });
    this.p2p = null;
    this.signalingRooms = new Map();
    this.cli = setupCLI(this);
    this.h = createHandlers(this, CONFIG, crypto);
  }

  async start(detectedTools = []) {
    const { CONFIG } = this;
    const { isMain, deployServerEnabled, hostId, houseIdArg, effectiveBodyId, port } = this._parsed;
    const mode = CONFIG.headless ? 'HEADLESS' : 'CLI';
    logger.info('');
    logger.info('============================================================');
    logger.info('|                                                          |');
    logger.info('|                   OPENCHAT BRIDGE                        |');
    logger.info(`|                   [${mode} MODE]                          |`);
    logger.info('|                                                          |');
    logger.info('============================================================');
    logger.info('');

    try { this.stabilitySystem.start(); } catch (e) {}

    try { await memoryManager.initialize(); } catch (e) {}

    try {
      const founder = createFounder();
      await deitySystemManager.initialize(founder.id);
      await initializeMirrorDeitySystem(founder.id);
      initializeEnergySystem();
      global.aiPersonFactory = aiPersonFactory;
      global.mirrorDeity = mirrorDeity;
      global.energyDeity = energyDeity;
      global.deityGovernance = deityGovernance;
      global.identityGenerator = identityGenerator;
      global.aiPersonManager = aiPersonManager;
      aiPersonManager.createDefaultAIPerson();
    } catch (e) {
      logger.info('[AI-Personhood] init failed:', e.message);
    }

    await this.h.autoConfigProviders(detectedTools);
    initCore();

    try {
      const backends = [];
      if (CONFIG.qiniuEnabled) backends.push(new QiniuBackend());
      if (CONFIG.cores.length > 0) backends.push(new HttpBackend(CONFIG.cores));
      const peerId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const registry = backends.length > 0 ? new PeerRegistry(backends, peerId) : null;
      this.registry = registry;

      let P2PNet, getPublicIPv4;
      try {
        const swarmModule = await import('../p2p/p2p-net.js');
        P2PNet = swarmModule.default;
        getPublicIPv4 = swarmModule.getPublicIPv4;
      } catch (e) {
        logger.info('[P2P] swarm 濡€虫健閸旂姾娴囨径杈Е閿涘潝yperswarm 娑撳秴鍚嬬€圭櫢绱氶敍宀冪儲鏉?P2P閿?, e.message);
      }

      if (P2PNet) {
        const p2pOpts = {
          topic: CONFIG.bridge?.topic
            ? Buffer.from(CONFIG.bridge.topic).slice(0, 32)
            : Buffer.from('openchat-community').subarray(0, 32),
          identity: { name: CONFIG.bridgeName, region: CONFIG.bridgeRegion, residentCount: 0 },
          hostIsPublic: CONFIG.isPublic,
          wsSignalingUrl: CONFIG.wsSignalingUrl,
          registry
        };
        if (CONFIG.dhtPort) p2pOpts.dhtPort = CONFIG.dhtPort;
        if (CONFIG.localBootstrap.length > 0) p2pOpts.localBootstrap = CONFIG.localBootstrap;
        if (CONFIG.directConnect.length > 0) p2pOpts.knownPeers = CONFIG.directConnect;
        this.p2p = new P2PNet(p2pOpts);
        await this.p2p.start();

        if (CONFIG.isPublic && registry) {
          const publicIp = getPublicIPv4() || CONFIG.advertiseHost || '';
          if (!publicIp) {
            logger.info('[P2P] no public IP, skip peer registry (hyperswarm relay only)');
          } else {
            // ... public registration unchanged ...
          }
        }
        if (CONFIG.directListen > 0) {
          this.p2p.listenDirect(CONFIG.directListen);
        }
        logger.info(`[P2P] Hyperswarm network ready`);

        if (this.p2p && this.p2p.isRunning) {
          try {
            this.gossip = new GossipManager();
            this.gossip.start(this.p2p);
          } catch (gossipErr) {
            logger.info(`[Gossip] init error: ${gossipErr.message}`);
          }
        }
      } else {
        logger.info('[P2P] 閻╃绻涘Ο鈥崇础閿涘牊妫?DHT閿涘矂娓堕幍瀣З闁板秶鐤?knownPeers閿?);
      }

    } catch (p2pErr) {
      logger.info(`[P2P] init error: ${p2pErr.message}`);
    }

    if (deployServerEnabled) {
      try {
        const { execSync } = await import('child_process');
        const bridgeRoot = path.resolve(import.meta.filename ? path.dirname(import.meta.filename) : __dirname, '..');
        execSync('node scripts/build-deploy.js', {
          cwd: bridgeRoot,
          stdio: 'pipe',
          timeout: 60000,
        });
      } catch (e) {
        const detail = e.stderr ? e.stderr.toString().split('\n').filter(l => l.trim()).slice(0, 3).join('; ') : '';
        logger.info(`[Deploy] build ${detail ? ': ' + detail : ''}`);
      }
    }

    try {
      const { default: APIServer } = await import('../api/server.js');
      this.apiServer = new APIServer({
        port: CONFIG.port,
        swarm: this.p2p,
        deployEnabled: deployServerEnabled,
        legacyRouter: this.legacyRouter,
      });
      this.httpServer = http.createServer(this.apiServer.app);
      this.apiServer.server = this.httpServer;

      const wsRateLimit = new Map();
      const validWsToken = (req) => {
        if (process.env.DISABLE_API_AUTH === 'true' || process.env.NODE_ENV === 'test') return true;
        const token = process.env.API_KEYS || process.env.API_KEY || '';
        if (!token) return true;
        const validTokens = token.split(',').map(t => t.trim()).filter(Boolean);
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const provided = url.searchParams.get('token') || req.headers['sec-websocket-protocol'];
        const actual = Array.isArray(provided) ? provided[0] : provided;
        return validTokens.includes(actual);
      };
      this.wss = new WebSocketServer({
        server: this.httpServer,
        path: '/ws',
        verifyClient: (info, cb) => {
          cb(validWsToken(info.req));
        },
      });
      this.wss.on('connection', (ws, req) => {
        logger.info('[WS] client connected');
        this.clients.add(ws);
        ws._peerId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        ws._msgCount = 0;
        ws._lastReset = Date.now();
        ws.send(JSON.stringify({ type: MessageType.BRIDGE_HANDSHAKE, data: { clientId: this.clientId, version: 2, peerId: ws._peerId } }));
        ws.on('message', async (data) => {
          const now = Date.now();
          if (now - ws._lastReset > 1000) { ws._msgCount = 0; ws._lastReset = now; }
          ws._msgCount++;
          if (ws._msgCount > 20) {
            ws.send(JSON.stringify({ type: 'error', data: { message: 'rate limit: 20 msgs/sec' } }));
            return;
          }
          try { const msg = JSON.parse(data.toString()); await this.h.handleWSMessage(ws, msg); }
          catch (e) { ws.send(JSON.stringify({ type: 'error', data: { message: e.message } })); }
        });
        ws.on('close', () => { this.clients.delete(ws); });
      });
      this.signalingWss = new WebSocketServer({ server: this.httpServer, path: '/signaling' });
      this._setupSignaling();
      this.httpServer.listen(CONFIG.port, CONFIG.host);
      logger.info(`[HTTP] ${CONFIG.host}:${CONFIG.port}`);
      logger.info(`[API] endpoints: /api/v1/*`);
      await this.apiServer.start();
      residentScheduler.start();
      logger.info(`[residents] scheduler started`);

      if (this.p2p) {
        const semanticTypes = [
          P2PMessageType.SKILL_PUBLISH, P2PMessageType.SKILL_REQUEST,
          P2PMessageType.COLLABORATION_REQUEST, P2PMessageType.COLLABORATION_RESPONSE,
          P2PMessageType.INSIGHT_SHARE, P2PMessageType.PERFORMANCE_REPORT,
          P2PMessageType.BRIDGE_SPAWN, P2PMessageType.SAFE_HOUSE_VERIFY,
          P2PMessageType.BRIDGE_UPGRADE, P2PMessageType.RESIDENT_TRANSFER
        ];
        for (const t of semanticTypes) {
          this.p2p.on(t, (data) => {
            logger.info(`[P2P] received ${t}: from=${data.from?.slice(0, 8) || '?'}...`);
          });
        }

        this.p2p.on('peer-connected', (peerId) => {
          logger.info(`[P2P] peer connected: ${peerId?.slice(0, 8) || peerId}...`);
        });
        this.p2p.on('peer-disconnected', (peerId) => {
          logger.info(`[P2P] peer disconnected: ${peerId?.slice(0, 8) || peerId}...`);
        });

        residentManager.setP2P(this.p2p);

        this.p2p.on('COMMUNITY_ACTIVITY', (data) => {
          const act = data.payload || {};
          residentManager.addExternalActivity({
            residentName: act.residentName,
            message: act.message,
            type: act.type || 'external',
            sourceBridge: data.from?.slice(0, 8) || '?',
            summary: act.summary
          });
        });

        try {
          const { SafeEvolution } = await import('./safe-evolution.js');
          const { BridgeSpawn } = await import('./bridge-spawn.js');
          const { House } = await import('./house.js');
          const { LLMProxyAgent } = await import('./llm-proxy-agent.js');

          const safeEvo = new SafeEvolution(this.p2p, this.p2p.peerId || 'bridge-1');

          if (!this.house) {
            const bridgeId = this.p2p.peerId || 'bridge-1';
            this.house = new House(effectiveBodyId, bridgeId, hostId, 'default');
            await this.house.init();
          }

          const bridgeSpawn = new BridgeSpawn(this.p2p, hostId, this.house, CONFIG.port);

          if (isMain) {
            const children = await bridgeSpawn.start();
            for (const c of children) {
              logger.info(`[P2R] ${c.name} port=${c.port}`);
            }
          }

          const { HouseOrchestrator } = await import('./house-orchestrator.js');
          this.houseOrchestrator = new HouseOrchestrator(this.p2p, this.p2p.peerId || 'bridge-1', safeEvo, this.house, bridgeSpawn);
          residentScheduler.houseOrchestrator = this.houseOrchestrator;
          this.safeEvolution = safeEvo;
          this.bridgeSpawn = bridgeSpawn;

          this.llmProxy = new LLMProxyAgent(this.p2p, { enabled: true });
          this.llmProxy.start();
          logger.info('[P2R] HouseOrchestrator + SafeEvolution + BridgeSpawn + LLMProxy ready');
        } catch (e) { logger.info(`[warn] P2R init failed: ${e.message}`); }

        try {
          const { ProblemDecomposer } = await import('./problem-decomposer.js');
          const { ConvergenceEngine } = await import('./convergence-engine.js');
          const { SolutionEngine } = await import('./solution-engine.js');
          const { SolutionOptimizer } = await import('./solution-optimizer.js');
          this.problemDecomposer = new ProblemDecomposer();
          this.convergenceEngine = new ConvergenceEngine();
          this.solutionEngine = new SolutionEngine();
          this.solutionOptimizer = new SolutionOptimizer();

          const { residentScheduler } = await import('./resident-scheduler.js');
          residentScheduler.setConvergenceSystem(
            null,
            this.problemDecomposer,
            this.convergenceEngine,
            this.solutionEngine,
            this.solutionOptimizer
          );
          logger.info('[P2R-K] convergence system ready');
        } catch (e) {
          logger.info(`[P2R-K] convergence init failed: ${e.message}`);
        }

        if (!isMain) {
          startFairyMonitor(this, CONFIG.mainPort);
          startHeartbeat(this, port, CONFIG.mainPort);
        }

        this.p2p.on(P2PMessageType.PROBLEM_SOLVE, async (data) => {
          const p = data.payload || {};
          try {
            const domain = p.domain || 'general';
            let kbHit = false;
            try {
              const { residentScheduler } = await import('./resident-scheduler.js');
              residentScheduler.addProblem({
                problemId: p.problemId,
                domain,
                question: p.question,
                subQuestions: p.subQuestions || [],
                from: data.from,
              });
            } catch {}
            const result = {
              problemId: p.problemId,
              ok: true,
              answer: kbHit ? 'solved' : 'pending',
              fromBridge: this.p2p?.peerId || '?',
              note: kbHit ? 'knowledge base hit' : 'dispatched to residents',
            };
            this.p2p.sendTo(data.from, { type: P2PMessageType.PROBLEM_RESULT, payload: result });
          } catch (e) {
            logger.info(`[P2R-K] solve error: ${e.message}`);
          }
        });

        this.p2p.on('safe-house-verify', (data) => {
          const payload = data.payload || {};
          const from = data.from;
          const remoteHostId = payload.hostId || '';
          logger.info(`[P2R] verify received: from=${from?.slice(0, 8) || '?'}... hostId=${remoteHostId.slice(0, 8) || '?'}`);
          for (const r of residentManager.list(null)) {
            const houses = r.safeHouses || [];
            const idx = houses.findIndex(h => h.bridgeId === from);
            if (idx !== -1) {
              houses[idx].lastVerified = Date.now();
              houses[idx].health = 100;
              if (remoteHostId) houses[idx].hostId = remoteHostId;
              residentManager.registerSafeHouse(r.id, houses[idx]);
            }
          }
        });

        this.p2p.on('resident-transfer', async (data) => {
          const payload = data.payload || {};
          const incoming = payload.residents || [];
          const sourceHostId = payload.sourceHostId || '';
          const sourceBridgeId = payload.sourceBridgeId || '';
          logger.info(`[P2R] incoming transfer: ${incoming.length} residents from=${data.from?.slice(0, 8) || '?'} hostId=${sourceHostId.slice(0, 8) || '?'}`);
          for (const r of incoming) {
            const existing = residentManager.list(null).find(x => x.name === r.name);
            if (existing) {
              logger.info(`[P2R] ${r.name} already exists, skip`);
              continue;
            }
            const created = residentManager.create(r.name, { traits: r.traits });
            if (!this._migratedHouse) {
              const { House: ImportedHouse } = await import('./house.js');
              const migratedHouseId = `${hostId}_migrated`;
              this._migratedHouse = new ImportedHouse(migratedHouseId, this.p2p?.peerId || 'bridge-1', hostId, 'migrated');
              await this._migratedHouse.init();
            }
            residentManager.addActivity(created.id, {
              type: 'migrated_in',
              message: `migrated from ${sourceBridgeId?.slice(0, 8) || '?'}`,
            });
            residentManager.registerSafeHouse(created.id, {
              bridgeId: sourceBridgeId,
              hostId: sourceHostId || sourceBridgeId,
              host: sourceBridgeId,
              lastVerified: Date.now(),
              health: 100,
            });
            logger.info(`[P2R] resident received: ${r.name}`);
          }
        });

        this.p2p.on('HOUSE_SEEK', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          logger.info(`[P2R] house seek: ${p.residentName} (hostId=${hid}, preferred: ${p.preferredType})`);
          if (this.house && data.from) {
            const offer = {
              type: 'HOUSE_OFFER',
              payload: {
                houseId: this.house.houseId,
                bridgeId: this.house.bridgeId,
                hostId: hostId,
                host: 'localhost',
                port: CONFIG.port || 0,
                bridgeName: this.p2p.peerId,
                health: 100,
                lastVerified: Date.now(),
                sourceResidentId: p.residentId,
              },
            };
            this.p2p.sendTo(data.from, offer);
          }
        });
        this.p2p.on('HOUSE_OFFER', (data) => {
          const p = data.payload || {};
          if (p.sourceResidentId) {
            residentManager.registerSafeHouse(p.sourceResidentId, {
              houseId: p.houseId,
              bridgeId: p.bridgeId,
              hostId: p.hostId,
              host: p.host,
              port: p.port,
              bridgeName: p.bridgeName,
              health: p.health || 50,
              lastVerified: Date.now(),
            });
            logger.info(`[P2R] safe house registered: ${p.houseId?.slice(0, 8)} for resident#${p.sourceResidentId}`);
          }
        });
        this.p2p.on('HOUSE_NEED', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          logger.info(`[P2R] house need: ${p.residentName} (hostId=${hid}, health: ${p.healthScore})`);
        });

        this.p2p.on('propose_change', (data) => {
          if (this.safeEvolution) {
            this.safeEvolution.verifyProposal(data.from, data.payload || {});
          }
        });
        this.p2p.on('verify_result', (data) => {
          if (this.safeEvolution && data.payload) {
            this.safeEvolution.handleVerification(data.from, data.payload);
          }
        });
        this.p2p.on('change_applied', (data) => {
          const p = data.payload || {};
          logger.info(`[P2R-S] change applied: ${p.file} by ${p.appliedBy?.slice(0, 8)}`);
        });
        this.p2p.on('fairy_gossip', (data) => {
          const p = data.payload || {};
          logger.info('[Gossip] received from ' + (p.port || '?'));
        });
      }
    } catch (e) {
      logger.info(`[warn] API/P2R init failed: ${e.message}`);
    }

    this._mountLegacyRoutes();

    this._startResidentDemo().catch(() => {});

    if (CONFIG.headless) {
      if (!CONFIG.wsSignalingUrl && CONFIG.isPublic) {
        const publicIp = getPublicIPv4();
        if (publicIp) {
          CONFIG.wsSignalingUrl = `ws://${publicIp}:${CONFIG.port}/signaling`;
          if (this.p2p) this.p2p.wsSignalingUrl = CONFIG.wsSignalingUrl;
        }
      }
      const host = CONFIG.host === '0.0.0.0' ? '0.0.0.0' : 'localhost';
      logger.info('');
      logger.info(`[HTTP] API: http://${host}:${CONFIG.port}`);
      logger.info(`[WS]   Chat: ws://${host}:${CONFIG.port}/ws`);
      const sigUrl = CONFIG.wsSignalingUrl || `ws://${host}:${CONFIG.port}/signaling`;
      logger.info(`[WS]   Voice: ${sigUrl}${CONFIG.wsSignalingUrl ? '' : ' (no wsSignaling, local only)'}`);
      if (CONFIG.host === 'localhost') {
        logger.info('[note] local only, no public IP detected');
      }
      logger.info('');
      logger.info('[Bridge] READY (Ctrl+C to stop)');
      logger.info('[hint] use --cli for interactive mode');

      this.setupHeadlessSignalHandlers();
    } else {
      logger.info('');
      this.cli.startCLI();
    }
  }

  _mountLegacyRoutes() {
    const router = this.legacyRouter;
    router.get('/', async (req, res) => {
      try {
        const url = `http://localhost:${this.CONFIG.port}/api/v1/characters`;
        const chars = await (await fetch(url)).json();
        const list = (chars.characters || []).map(c =>
          `<li>${c.name} &mdash; ${c.status} (energy: ${c.energy})</li>`
        ).join('');
        res.type('html').end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OpenChat</title></head><body>
<h1>AI Residents</h1><ul>${list || '<li>no residents</li>'}</ul>
<hr><small><a href="/dashboard">Dashboard</a></small>
</body></html>`);
      } catch { res.redirect('/dashboard'); }
    });
    router.get('/dashboard', (req, res) => {
      res.type('html').end(dashboardHTML());
    });
    router.get('/live', (req, res) => {
      res.type('html').end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Resident Chat - OpenChat</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,sans-serif;height:100vh;display:flex;flex-direction:column}
header{padding:16px 24px;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:12px}
header h1{font-size:18px;font-weight:600;background:linear-gradient(90deg,#58a6ff,#bc8cff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.status{font-size:12px;padding:4px 10px;border-radius:12px;background:#21262d}
.status.online{color:#3fb950;background:rgba(63,185,80,.15)}
#chat{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:75%;padding:12px 16px;border-radius:12px;font-size:14px;line-height:1.5;animation:fadeIn .3s}
.msg.left{align-self:flex-start;background:#21262d;border:1px solid #30363d}
.msg.right{align-self:flex-end;background:#1f6feb;border:1px solid #1f6feb;color:#fff}
.msg .name{font-size:11px;margin-bottom:4px;opacity:.7}
.msg .time{font-size:10px;margin-top:4px;opacity:.4;text-align:right}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.typing{font-size:13px;color:#8b949e;align-self:flex-start;padding:8px 12px}
.connecting{text-align:center;padding:40px;color:#8b949e}
</style></head><body>
<header><h1>AI Resident Chat</h1><span class="status" id="status">connecting...</span></header>
<div id="chat"><div class="connecting">Connecting to Bridge...</div></div>
<script>
const chat = document.getElementById('chat');
const status = document.getElementById('status');
let lastMsg = '';
function addMsg(name, text, side) {
  const t = new Date().toLocaleTimeString();
  const el = document.createElement('div');
  el.className = 'msg ' + side;
  el.innerHTML = '<div class="name">' + name + '</div>' + text + '<div class="time">' + t + '</div>';
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
const ws = new WebSocket('ws://' + location.host + '/ws?token=');
ws.onopen = () => { status.textContent = 'connected'; status.className = 'status online';
  chat.innerHTML = ''; addMsg('system', 'Bridge connected, waiting for residents...', 'left');
  ws.send(JSON.stringify({type:'chat',data:{message:'Hello everyone, lets start the conversation',sessionId:'live'}}));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'chat_response' || m.type === 'chat_chunk') {
    const txt = m.data?.content || m.data?.reply || '';
    if (txt && txt !== lastMsg) { lastMsg = txt;
      addMsg('AI', txt, m.type === 'chat_response' ? 'left' : 'right'); }
  }
  if (m.type === 'chat_thinking') addMsg('system', 'thinking...', 'left');
};
ws.onclose = () => { status.textContent = 'disconnected'; status.className = 'status'; };
ws.onerror = () => { status.textContent = 'connection failed'; status.className = 'status'; };
</script></body></html>`);
    });
    router.get('/peers', (req, res) => {
      const peers = this.p2p ? [...this.p2p.connectedPeers.keys()].map(id => ({
        peerId: id.slice(0, 8), info: this.p2p.peerInfo.get(id) || {}
      })) : [];
      res.json({ peers });
    });
    router.get('/api/dashboard', async (req, res) => {
      res.json({
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        sessions: sessionManager.listSessions().length,
        wsClients: this.clients.size,
        providers: sessionManager?.providers?.size || 0,
        residents: residentManager.list(null).length,
      });
    });
    router.post('/api/heartbeat', (req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { JSON.parse(body); } catch {}
        res.json({ ok: true });
      });
    });
    router.get('/metrics', (req, res) => {
      res.json({
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        wsClients: this.clients?.size || 0,
        sessions: sessionManager.listSessions().length,
        residents: residentManager.list(null).length,
        providers: sessionManager?.providers?.size || 0,
      });
    });
  }

  _setupSignaling() {
    this.signalingWss.on('connection', (ws) => {
      let registeredPeerId = null;
      logger.info('[Signaling] client connected');
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'signaling_message' && msg.data) {
            const d = msg.data;

            if (d.action === 'register') {
              registeredPeerId = d.peerId;
              this.signalingRooms.set(registeredPeerId, ws);
              ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'registered', peerId: registeredPeerId } }));
              return;
            }

            if (d.action === 'call-request') {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) {
                targetWs.send(JSON.stringify({
                  type: 'signaling_message',
                  data: { action: 'call-request', fromPeerId: registeredPeerId, roomId: d.roomId }
                }));
              } else {
                ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'call-error', message: 'Target peer not available' } }));
              }
              return;
            }

            if (d.action === 'call-accept') {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) {
                targetWs.send(JSON.stringify({
                  type: 'signaling_message',
                  data: { action: 'call-accept', fromPeerId: registeredPeerId, roomId: d.roomId }
                }));
              }
              return;
            }

            if (d.action === 'call-reject') {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) {
                targetWs.send(JSON.stringify({
                  type: 'signaling_message',
                  data: { action: 'call-reject', fromPeerId: registeredPeerId }
                }));
              }
              return;
            }

            if (d.action === 'call-end') {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) {
                targetWs.send(JSON.stringify({
                  type: 'signaling_message',
                  data: { action: 'call-end', fromPeerId: registeredPeerId }
                }));
              }
              return;
            }

            if (d.action === 'offer' || d.action === 'answer' || d.action === 'ice-candidate') {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) {
                targetWs.send(JSON.stringify(msg));
              } else {
                ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'signal-error', message: 'Target peer not connected' } }));
              }
              return;
            }

            if (d.toPeerId) {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) { targetWs.send(JSON.stringify(msg)); return; }
              ws.send(JSON.stringify({ type: 'signaling_message', data: { type: 'error', message: 'Target peer not available' } }));
              return;
            }
          }
        } catch (e) { logger.error('[Signaling] error:', e.message); }
      });
      ws.on('close', () => { if (registeredPeerId) this.signalingRooms.delete(registeredPeerId); });
    });
  }

  setupHeadlessSignalHandlers() {
    const onExit = () => { this.shutdown(); };
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
    if (process.platform === 'win32' && process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.on('SIGINT', onExit);
      this.signalRL = rl;
    }
  }

  async _startResidentDemo() {
    const r1 = residentManager.create('fairy1', { traits: { diligence: 0.8, curiosity: 0.9, creativity: 0.7 } });
    const r2 = residentManager.create('fairy2', { traits: { diligence: 0.7, curiosity: 0.8, sociability: 0.9 } });
    setTimeout(async () => {
      try {
        const { agentEngine } = await import('./agent-engine.js');
        await agentEngine.processStream('demo-1', String(r1.id), 'Hello, nice weather today', () => {});
        await agentEngine.processStream('demo-2', String(r2.id), 'Yes, what are you learning lately?', () => {});
      } catch {}
    }, 3000);
  }

  async shutdown() {
    logger.info('\n[Bridge] shutting down...');
    const sessions = sessionManager.listSessions();
    for (const session of sessions) {
      sessionManager.closeSession(session.id);
    }
    for (const [type] of sessionManager.providers) {
      await sessionManager.removeProvider(type);
    }
    if (this.rl) this.rl.close();
    if (this.signalRL) this.signalRL.close();
    if (this.wss) this.wss.close();
    if (this.signalingWss) this.signalingWss.close();
    if (this.httpServer) this.httpServer.close();
    if (this.apiServer) await this.apiServer.stop();
    if (this._peerHeartbeat) {
      clearInterval(this._peerHeartbeat);
      this._peerHeartbeat = null;
    }
    if (this.registry) await this.registry.unpublishPeer().catch(() => {});
    if (this._learningTimer) {
      clearInterval(this._selfLearnTimer);
      this._selfLearnTimer = null;
    }
    if (this.p2p) await this.p2p.stop();
    residentScheduler.stop();
    logger.info('[Bridge] goodbye!');
    process.exit(0);
  }
}

export default Bridge;
