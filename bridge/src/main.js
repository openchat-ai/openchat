import 'dotenv/config';
import * as readline from 'readline';
import crypto from 'crypto';
import path from 'path';
import http from 'http';
import { sessionManager } from './session/session-manager.js';
import { parseCliArgs } from './config/cli-args.js';
import { setupCLI } from './cli/bridge-cli.js';
import { startLearningCore, startFairyMonitor, startHeartbeat } from './core/learning-loop.js';
import { dashboardHTML } from './infra/dashboard-html.js';
import { createHandlers } from './infra/route-handlers.js';

// ������REST API ��������31 ���˵㣩
// ʹ�ö�̬ import ���� CommonJS ģ��
let apiServer = null;
import { MessageType } from './protocol/message.js';
import { WebSocketServer } from 'ws';
import { router } from './core/router.js';
import { initCore } from './core/handlers.js';
import { memoryManager } from './memory/memory-manager.js';
import { AIPerson, aiPersonRegistry, createFounder } from './core/ai-personhood.js';
import { Deity, deitySystemManager, DEITY_TYPE } from './core/deity-system.js';
import { MirrorDeity, mirrorDeity, initializeMirrorDeitySystem } from './core/mirror-deity.js';
import { EnergyDeity, energyDeity, initializeEnergySystem, ENERGY_TYPE, POWER_MODE } from './core/energy-deity.js';
import { aiPersonFactory, AI_TEMPLATES } from './core/ai-person-factory.js';
import { deityGovernance } from './core/deity-governance.js';
import { identityGenerator } from './core/identity-generator.js';
import { aiPersonManager } from './core/ai-person-manager.js';
import { getEnhancedStabilitySystem } from './core/enhanced-stability-system.js';
import { CollaborationEngine } from './core/collaboration-engine.js';
import { residentManager } from './core/resident-manager.js';
import { residentScheduler } from './core/resident-scheduler.js';
import { LearningCore } from './core/learning-core.js';
import P2PSwarm, { getPublicIPv4 } from './p2p/swarm.js';
import { MessageType as P2PMessageType } from './p2p/messages.js';
import { PeerRegistry } from './p2p/peer-registry.js';
import { QiniuBackend } from './p2p/peer-registry/qiniu-backend.js';
import { HttpBackend } from './p2p/peer-registry/http-backend.js';

// Helper: fetch models from Bridge's own HTTP API for a local provider
async function fetchLocalModelsFromBridge(providerName) {
  try {
    const resp = await fetch(`http://localhost:${CONFIG.port}/api/provider/models?providerId=${providerName}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (resp.ok) {
      const json = await resp.json();
      return json.models || [];
    }
  } catch (e) {
    // Silently fail - provider may not have models endpoint
  }
  return [];
}

const {
  CONFIG, port, args, hostId, houseIdArg, effectiveBodyId,
  deployServerEnabled, deployServerPort, isMain, isNesting, isHeadless, COMMANDS
} = parseCliArgs();

class Bridge {
  constructor() {
    this.clientId = process.env.CLIENT_ID || crypto.randomUUID();
    this.wss = null;
    this.httpServer = null;
    this.apiServer = null;  // ������REST API ������
    this.clients = new Set();
    this.rl = null;
    this.startTime = Date.now();
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
    this.signalingRooms = new Map();  // peerId �� WebSocket ����ӳ��
    this.cli = setupCLI(this);
    this.h = createHandlers(this, CONFIG, crypto);
  }

  async start(detectedTools = []) {
    const mode = CONFIG.headless ? 'HEADLESS' : 'CLI';
    console.log('');
    console.log('�X�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�[');
    console.log('�U                                                          �U');
    console.log('�U                   OPENCHAT BRIDGE                        �U');
    console.log(`�U                   [${mode} MODE]                          �U`);
    console.log('�U                                                          �U');
    console.log('�^�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�T�a');
    console.log('');

    // ������ǿ�ȶ���ϵͳ
    try {
      this.stabilitySystem.start();
    } catch (e) {
      // �ȶ���ϵͳ����ʧ�ܲ�Ӱ��������
    }

    // ��ʼ�� RAG ϵͳ
    try {
      await memoryManager.initialize();
    } catch (e) {
      // RAG ��ʼ����ѡ
    }

    // ��ʼ�� AI ��ϵͳ
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
      console.log('[AI-Personhood] ��ʼ��ʧ��:', e.message);
    }

    await this.h.autoConfigProviders(detectedTools);

    initCore();

    // ���� P2P ���磨�� API ������֮ǰ���Ա�ע�� swarm ʵ����
    try {
      // ���� PeerRegistry������ģ�
      const backends = [];
      if (CONFIG.qiniuEnabled) backends.push(new QiniuBackend());
      if (CONFIG.cores.length > 0) backends.push(new HttpBackend(CONFIG.cores));
      const peerId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const registry = backends.length > 0 ? new PeerRegistry(backends, peerId) : null;
      this.registry = registry;

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
      this.p2p = new P2PSwarm(p2pOpts);
      await this.p2p.start();

      // �����ڵ㣺ע�ᵽ���� backend������ʱ����
      // ֻע�������й��� IP �Ľڵ㣨0.0.0.0 ����·�ɣ�����Ҳû�ã�
      if (CONFIG.isPublic && registry) {
        const publicIp = getPublicIPv4() || CONFIG.advertiseHost || '';
        if (!publicIp) {
          console.log('[P2P] �޹��� IP������ peer registry ע�ᣨ����Ϊ Hyperswarm �м̣�');
        } else {
          const publishInfo = {
            host: publicIp,
            port: CONFIG.port,
            dhtPort: CONFIG.dhtPort || 0,
            publicRelay: true,
            wsSignaling: `ws://${publicIp}:${CONFIG.port}/signaling`
          };
          await registry.publishPeer(publishInfo).catch(e => {
            console.log(`[P2P] ע������ע��ʧ��: ${e.message}`);
          });
          console.log(`[P2P] �����ڵ���ע�ᵽ�Ե����� (${publicIp})`);
          this._peerHeartbeat = setInterval(async () => {
            try { await registry.publishPeer(publishInfo); }
            catch (e) { /* ��Ĭʧ�� */ }
          }, 60000);
        }
      }
      // ����ֱ�� TCP �������������� / �����ƹ� DHT��
      if (CONFIG.directListen > 0) {
        this.p2p.listenDirect(CONFIG.directListen);
      }
      console.log(`[P2P] Hyperswarm �����Ѽ���`);
    } catch (p2pErr) {
      console.log(`[P2P] ��������: ${p2pErr.message}`);
    }

    // �Զ����� deploy/����Ĭִ�У���ʧ��ʱ��ʾ����ժҪ��
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
        console.log(`[Deploy] build ����${detail ? ': ' + detail : ''}`);
      }
    }

    // ������ HTTP ���������ϲ��� server + Express API + WebSocket��
    try {
      const { default: APIServer } = await import('./api/server.js');
      // �ȴ��� API server����ȡ Express app
      this.apiServer = new APIServer({
        port: CONFIG.port,
        swarm: this.p2p,
        deployEnabled: deployServerEnabled,
      });
      // �� Express app ��Ϊ http.Server �� handler
      this.httpServer = http.createServer(this.apiServer.app);
      this.apiServer.server = this.httpServer;
      // WS token 鉴权 + 速率限制
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
        console.log('[WS] 客户端已连接');
        this.clients.add(ws);
        ws._peerId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        ws._msgCount = 0;
        ws._lastReset = Date.now();
        ws.send(JSON.stringify({ type: MessageType.BRIDGE_HANDSHAKE, data: { clientId: this.clientId, version: 2, peerId: ws._peerId } }));
        ws.on('message', async (data) => {
          // 速率限制：每秒最多 20 条
          const now = Date.now();
          if (now - ws._lastReset > 1000) { ws._msgCount = 0; ws._lastReset = now; }
          ws._msgCount++;
          if (ws._msgCount > 20) {
            ws.send(JSON.stringify({ type: 'error', data: { message: '速率限制：每秒最多 20 条消息' } }));
            return;
          }
          try { const msg = JSON.parse(data.toString()); await this.h.handleWSMessage(ws, msg); }
          catch (e) { ws.send(JSON.stringify({ type: 'error', data: { message: e.message } })); }
        });
        ws.on('close', () => { this.clients.delete(ws); });
      });
      // WebRTC ����
      this.signalingWss = new WebSocketServer({ server: this.httpServer, path: '/signaling' });
      this._setupSignaling();
      this.httpServer.listen(CONFIG.port, CONFIG.host);
      console.log(`[HTTP] ���� ${CONFIG.host}:${CONFIG.port}`);
      console.log(`[API] �˵�: /api/v1/*`);
      await this.apiServer.start();
      // ���� AI ���������
      residentScheduler.start();
      console.log(`[������] ������������ѭ��������`);

      // ע�� P2P �¼�����
      if (this.p2p) {
        // ����������Ϣ����ͳһ��־��������ֱ�Ӵ� wire ��Я�������߰�����
        const semanticTypes = [
          P2PMessageType.SKILL_PUBLISH, P2PMessageType.SKILL_REQUEST,
          P2PMessageType.COLLABORATION_REQUEST, P2PMessageType.COLLABORATION_RESPONSE,
          P2PMessageType.INSIGHT_SHARE, P2PMessageType.PERFORMANCE_REPORT,
          // P2R
          P2PMessageType.BRIDGE_SPAWN, P2PMessageType.SAFE_HOUSE_VERIFY,
          P2PMessageType.BRIDGE_UPGRADE, P2PMessageType.RESIDENT_TRANSFER
        ];
        for (const t of semanticTypes) {
          this.p2p.on(t, (data) => {
            console.log(`[P2P] �յ� ${t}: from=${data.from?.slice(0, 8) || '?'}...`);
          });
        }

        this.p2p.on('peer-connected', (peerId) => {
          console.log(`[P2P] Peer ������: ${peerId?.slice(0, 8) || peerId}...`);
        });
        this.p2p.on('peer-disconnected', (peerId) => {
          console.log(`[P2P] Peer �ѶϿ�: ${peerId?.slice(0, 8) || peerId}...`);
        });

        // ע�� P2P �������������ʹ���� think() ���� LLM ������
        residentManager.setP2P(this.p2p);

        // �������� Bridge ���͵������
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

        // P2R: �����μҳ�ʼ����try ���ֹ HouseOrchestrator ������ֹ������ʼ����
        try {
        const { SafeEvolution } = await import('./core/safe-evolution.js');
        const { BridgeSpawn } = await import('./core/bridge-spawn.js');
        const { House } = await import('./core/house.js');
        const { LLMProxyAgent } = await import('./core/llm-proxy-agent.js');

        const safeEvo = new SafeEvolution(this.p2p, this.p2p.peerId || 'bridge-1');

        // ��ʼ��Ĭ�� House���� Bridge / �� Bridge ���Դ�����
        if (!this.house) {
          const bridgeId = this.p2p.peerId || 'bridge-1';
          this.house = new House(effectiveHouseId, bridgeId, hostId, 'default');
          await this.house.init();
        }

        const bridgeSpawn = new BridgeSpawn(this.p2p, hostId, this.house, CONFIG.port);

        // Fairy spawn �� FairyGuardian ���� spawn + health check + revive
        if (isMain) {
          const children = await bridgeSpawn.start();
          for (const c of children) {
            console.log(`[P2R] ${c.name} port=${c.port}`);
          }
        }

        const { HouseOrchestrator } = await import('./core/house-orchestrator.js');
        this.houseOrchestrator = new HouseOrchestrator(this.p2p, this.p2p.peerId || 'bridge-1', safeEvo, this.house, bridgeSpawn);
        residentScheduler.houseOrchestrator = this.houseOrchestrator;
        this.safeEvolution = safeEvo;
        this.bridgeSpawn = bridgeSpawn;

        // LLM �������������ŵ� LLM ��������
        this.llmProxy = new LLMProxyAgent(this.p2p, { enabled: true });
        this.llmProxy.start();
        console.log('[P2R] HouseOrchestrator + SafeEvolution + BridgeSpawn + LLMProxy ������');

        } catch (e) { console.log(`[����] P2R ��ʼ��ʧ��: ${e.message}`); }

        // P2R-K: �������� �� ����ֽ���������������
        try {
          const { ProblemDecomposer } = await import('./core/problem-decomposer.js');
          const { ConvergenceEngine } = await import('./core/convergence-engine.js');
          const { SolutionEngine } = await import('./core/solution-engine.js');
          const { SolutionOptimizer } = await import('./core/solution-optimizer.js');
          this.problemDecomposer = new ProblemDecomposer();
          this.convergenceEngine = new ConvergenceEngine();
          this.solutionEngine = new SolutionEngine();
          this.solutionOptimizer = new SolutionOptimizer();

          // ע������ϵͳ�����������
          const { residentScheduler } = await import('./core/resident-scheduler.js');
          residentScheduler.setConvergenceSystem(
            null, // knowledgeBase ���Ƴ�
            this.problemDecomposer,
            this.convergenceEngine,
            this.solutionEngine,
            this.solutionOptimizer
          );

          console.log('[P2R-K] �������������� (�ֽ�+����+���+�Ż�)');
        } catch (e) {
          console.log(`[P2R-K] ������������ʧ��: ${e.message}`);
        }

        // ����ѧϰ����
        this.learningCore = new LearningCore(null, this.p2p, port, residentScheduler);
        if (isMain) {
          startLearningCore(this);
          console.log(`[ѧϰ����]  ��ģʽ IQ=${this.learningCore.iq} Age=${this.learningCore.age} Solved=${this.learningCore.solvedCount}`);
        } else {
          console.log(`[ѧϰ����]  ��Ůģʽ`);
          startFairyMonitor(this, CONFIG.mainPort);
          startHeartbeat(this, port, CONFIG.mainPort);
        }

        // P2R-K: ��Ӧ�ھӵ������������
        this.p2p.on(P2PMessageType.PROBLEM_SOLVE, async (data) => {
          const p = data.payload || {};
          try {
            const domain = p.domain || 'general';

            // 1. �Ȳ�֪ʶ�⣨���Ƴ���
            let kbHit = false;

            // 2. ������������У��þ��� traits �ֽ�ɫ��⣩
            try {
              const { residentScheduler } = await import('./core/resident-scheduler.js');
              residentScheduler.addProblem({
                problemId: p.problemId,
                domain,
                question: p.question,
                subQuestions: p.subQuestions || [],
                from: data.from,
              });
            } catch {}

            // 3. �ظ����ȷ��� KB �ܻش�Ĳ��֣�
            const result = {
              problemId: p.problemId,
              ok: true,
              answer: kbHit ? 'solved' : 'pending',
              fromBridge: this.p2p?.peerId || '?',
              note: kbHit ? '֪ʶ������' : '�ѷַ��������',
            };
            this.p2p.sendTo(data.from, { type: P2PMessageType.PROBLEM_RESULT, payload: result });
          } catch (e) {
            console.log(`[P2R-K] ���ʧ��: ${e.message}`);
          }
        });

        // P2R: ����֤�ظ�
        this.p2p.on('safe-house-verify', (data) => {
          const payload = data.payload || {};
          const from = data.from;
          const remoteHostId = payload.hostId || '';
          console.log(`[P2R] �յ�����֤: from=${from?.slice(0, 8) || '?'}... hostId=${remoteHostId.slice(0, 8) || '?'}`);
          // �������о�����ָ��� bridge �Ŀߵ� lastVerified �� hostId
          for (const r of residentManager.list(null)) {
            const houses = r.safeHouses || [];
            const idx = houses.findIndex(h => h.bridgeId === from);
            if (idx !== -1) {
              houses[idx].lastVerified = Date.now();
              houses[idx].health = 100; // �ܻظ�˵������
              if (remoteHostId) houses[idx].hostId = remoteHostId;
              residentManager.registerSafeHouse(r.id, houses[idx]);
            }
          }
        });

        // P2R: ����Ǩ������
        this.p2p.on('resident-transfer', async (data) => {
          const payload = data.payload || {};
          const incoming = payload.residents || [];
          const sourceHostId = payload.sourceHostId || '';
          const sourceBridgeId = payload.sourceBridgeId || '';
          console.log(`[P2R] �յ�����Ǩ��: ${incoming.length} �� from=${data.from?.slice(0, 8) || '?'} hostId=${sourceHostId.slice(0, 8) || '?'}`);
          for (const r of incoming) {
            const existing = residentManager.list(null).find(x => x.name === r.name);
            if (existing) {
              console.log(`[P2R] ${r.name} �Ѵ��ڣ�����`);
              continue;
            }
            const created = residentManager.create(r.name, { traits: r.traits });

            // ΪǨ����񴴽����� House
            if (!this._migratedHouse) {
              const { House: ImportedHouse } = await import('./core/house.js');
              const migratedHouseId = `${hostId}_migrated`;
              this._migratedHouse = new ImportedHouse(migratedHouseId, this.p2p?.peerId || 'bridge-1', hostId, 'migrated');
              await this._migratedHouse.init();
            }

            residentManager.addActivity(created.id, {
              type: 'migrated_in',
              message: `�� ${sourceBridgeId?.slice(0, 8) || '?'} Ǩ��`,
            });
            // ��ԭ bridge ��Ϊ�׸���ȫ�ݣ��� hostId��
            residentManager.registerSafeHouse(created.id, {
              bridgeId: sourceBridgeId,
              hostId: sourceHostId || sourceBridgeId,
              host: sourceBridgeId,
              lastVerified: Date.now(),
              health: 100,
            });
            console.log(`[P2R] ���վ���: ${r.name}`);
          }
        });

        // P2R: �㲥��Ϣ��HOUSE_SEEK / HOUSE_NEED��
        this.p2p.on('HOUSE_SEEK', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          console.log(`[P2R] �յ��ҿ�����: ${p.residentName} (hostId=${hid}, ƫ��: ${p.preferredType})`);
          // ����� Bridge �� House���ظ���ȫ����Ϣ
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
            console.log(`[P2R] ��ȫ��ע��ɹ�: ${p.houseId?.slice(0, 8)} �� resident#${p.sourceResidentId}`);
          }
        });
        this.p2p.on('HOUSE_NEED', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          console.log(`[P2R] �յ�����: ${p.residentName} (hostId=${hid}, ����: ${p.healthScore})`);
        });

        // P2R-S: ��ȫ�����¼�
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
          console.log(`[P2R-S] ���Ӧ��: ${p.file} by ${p.appliedBy?.slice(0, 8)}`);
        });
        // �ֲ�ʽ Fairy Gossip
        this.p2p.on('fairy_gossip', (data) => {
          const p = data.payload || {};
          if (this.learningCore?.reasoning) {
            this.learningCore.reasoning.experienceCount = (this.learningCore.reasoning.experienceCount || 0) + 1;
            console.log(`[Gossip] �յ� ${p.port} ���⾭��: ${p.problemId}`);
          }
        });
      }
    } catch (e) {
      console.log(`[����] API/P2R ��ʼ��ʧ��: ${e.message}`);
    }

    // ���ؾɰ�·�ɵ� Express��������� http.createServer��
    this._mountLegacyRoutes();

    // ��ͷģʽ
    if (CONFIG.headless) {
      // �ɰ�·���ѹ��ص� Express��WS/�������ڵ� server ������

      // �����ڵ��Զ���ȫ WS �����ַ����δ��ʽָ����
      if (!CONFIG.wsSignalingUrl && CONFIG.isPublic) {
        const publicIp = getPublicIPv4();
        if (publicIp) {
          CONFIG.wsSignalingUrl = `ws://${publicIp}:${CONFIG.port}/signaling`;
          if (this.p2p) this.p2p.wsSignalingUrl = CONFIG.wsSignalingUrl;
        }
      }
      const host = CONFIG.host === '0.0.0.0' ? '0.0.0.0' : 'localhost';
      console.log('');
      console.log(`[HTTP] API: http://${host}:${CONFIG.port}`);
      console.log(`[WS]   Chat: ws://${host}:${CONFIG.port}/ws`);
      const sigUrl = CONFIG.wsSignalingUrl || `ws://${host}:${CONFIG.port}/signaling`;
      console.log(`[WS]   Voice: ${sigUrl}${CONFIG.wsSignalingUrl ? '' : ' (δ���� wsSignaling, ������)'}`);
      if (CONFIG.host === 'localhost') {
        console.log('[��ʾ] �������������ӣ��Զ����δ���ֹ��� IP��');
      }
      console.log('');
      console.log('[Bridge] ������... (Ctrl+C ֹͣ)');
      console.log('[��ʾ] ʹ�� --cli �������뽻��ģʽ');

      // Headless ģʽ���źŴ���
      this.setupHeadlessSignalHandlers();
    } else {
      // CLI ģʽ - startCLI �ڲ������ź�
      console.log('');
      this.cli.startCLI();
    }
  }

  _mountLegacyRoutes() {
    const app = this.apiServer?.app;
    if (!app) return;
    // Dashboard ��ҳ
app.get('/', async (req, res) => {
      try {
        const url = `http://localhost:${CONFIG.port}/api/v1/characters`;
        const chars = await (await fetch(url)).json();
        const list = (chars.characters || []).map(c =>
          `<li>${c.name} &mdash; ${c.status} (能量: ${c.energy})</li>`
        ).join('');
        res.type('html').end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OpenChat</title></head><body>
<h1>AI 居民</h1><ul>${list || '<li>暂无居民</li>'}</ul>
<hr><small><a href="/dashboard">旧版 Dashboard</a></small>
</body></html>`);
      } catch { res.redirect('/dashboard'); }
    });
    app.get('/dashboard', (req, res) => {
      res.type('html').end(dashboardHTML());
    });
    // �������
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', uptime: Date.now() - this.startTime });
    });
    // P2P �ԵȽڵ�
    app.get('/peers', (req, res) => {
      const peers = this.p2p ? [...this.p2p.connectedPeers.keys()].map(id => ({
        peerId: id.slice(0, 8), info: this.p2p.peerInfo.get(id) || {}
      })) : [];
      res.json({ peers });
    });
    // Dashboard ����
app.get('/api/dashboard', async (req, res) => {
      res.json({
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        sessions: sessionManager.listSessions().length,
        wsClients: this.clients.size,
        providers: sessionManager?.providers?.size || 0,
        residents: residentManager.list(null).length,
      });
    });
    // Fairy ����
    app.post('/api/heartbeat', (req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try { const p = JSON.parse(body); if (this.learningCore?.guardian && p.port) this.learningCore.guardian.receiveHeartbeat(p.port); } catch {}
        res.json({ ok: true });
      });
    });
  }

  _setupSignaling() {
    this.signalingWss.on('connection', (ws) => {
      let registeredPeerId = null;
      console.log('[Signaling] �ͻ���������');
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
            if (d.toPeerId) {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) { targetWs.send(JSON.stringify(msg)); return; }
              ws.send(JSON.stringify({ type: 'signaling_message', data: { type: 'error', message: 'Target peer not available' } }));
              return;
            }
          }
        } catch (e) { console.error('[Signaling] error:', e.message); }
      });
      ws.on('close', () => { if (registeredPeerId) this.signalingRooms.delete(registeredPeerId); });
    });
  }

  /**
   * Headless ģʽ���źŴ������������� CLI �����������
   */
  setupHeadlessSignalHandlers() {
    const onExit = () => {
      this.shutdown();
    };

    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);

    // Windows ƽ̨���⴦��
    if (process.platform === 'win32' && process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.on('SIGINT', onExit);
      this.signalRL = rl;
    }
  }

  async shutdown() {
    console.log('\n[Bridge] ���ڹر�...');

    const sessions = sessionManager.listSessions();
    for (const session of sessions) {
      sessionManager.closeSession(session.id);
    }

    for (const [type] of sessionManager.providers) {
      await sessionManager.removeProvider(type);
    }

    if (this.rl) {
      this.rl.close();
    }

    if (this.signalRL) {
      this.signalRL.close();
    }

    if (this.wss) {
      this.wss.close();
    }

    if (this.signalingWss) {
      this.signalingWss.close();
    }

    if (this.httpServer) {
      this.httpServer.close();
    }

    // �ر� REST API ������
    if (this.apiServer) {
      await this.apiServer.stop();
    }

    // ֹͣ�������� peer Ŀ¼ע��
    if (this._peerHeartbeat) {
      clearInterval(this._peerHeartbeat);
      this._peerHeartbeat = null;
    }
    if (this.registry) {
      await this.registry.unpublishPeer().catch(() => {});
    }

    // ֹͣ��ѧϰ
    if (this._learningTimer) {
      clearInterval(this._selfLearnTimer);
      this._selfLearnTimer = null;
    }

    // ֹͣ P2P ���磨�ڵ�����֮ǰ��
    if (this.p2p) await this.p2p.stop();

    // ֹͣ���������
    residentScheduler.stop();

    console.log('[Bridge] ���˳����ټ�!');
    process.exit(0);
  }
}

export async function startBridge(detectedTools = [], options = {}) {
  // ����ͨ�� options ��������
  if (options.headless !== undefined) CONFIG.headless = options.headless;
  if (options.port) CONFIG.port = options.port;
  if (options.host) CONFIG.host = options.host;

  const bridge = new Bridge();
  await bridge.start(detectedTools);
}

// �Զ�����������Ϊ��ģ������ʱ��
// ʹ�ø��ɿ��ļ�ⷽʽ
const mainPath = process.argv[1];
const normalizedMainPath = mainPath ? mainPath.replace(/\\/g, '/') : '';
const importPath = import.meta.url.replace('file://', '');
const isMainModule = normalizedMainPath && (
  importPath === normalizedMainPath ||
  importPath.endsWith('/' + normalizedMainPath) ||
  normalizedMainPath.endsWith(importPath)
);

if (isMainModule) {
  startBridge().catch(e => {
    console.error('Bridge ����ʧ��:', e.message);
    process.exit(1);
  });
}

