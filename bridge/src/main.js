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

// 新增：REST API 服务器（31 个端点）
// 使用动态 import 加载 CommonJS 模块
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
    this.apiServer = null;  // 新增：REST API 服务器
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
    this.signalingRooms = new Map();  // peerId → WebSocket 信令映射
    this.cli = setupCLI(this);
    this.h = createHandlers(this, CONFIG, crypto);
  }

  async start(detectedTools = []) {
    const mode = CONFIG.headless ? 'HEADLESS' : 'CLI';
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                                                          ║');
    console.log('║                   OPENCHAT BRIDGE                        ║');
    console.log(`║                   [${mode} MODE]                          ║`);
    console.log('║                                                          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    // 启动增强稳定性系统
    try {
      this.stabilitySystem.start();
    } catch (e) {
      // 稳定性系统启动失败不影响主流程
    }

    // 初始化 RAG 系统
    try {
      await memoryManager.initialize();
    } catch (e) {
      // RAG 初始化可选
    }

    // 初始化 AI 人系统
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
      console.log('[AI-Personhood] 初始化失败:', e.message);
    }

    await this.h.autoConfigProviders(detectedTools);

    initCore();

    // 启动 P2P 网络（在 API 服务器之前，以便注入 swarm 实例）
    try {
      // 构造 PeerRegistry（多核心）
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

      // 公网节点：注册到所有 backend，并定时心跳
      // 只注册真正有公网 IP 的节点（0.0.0.0 不可路由，存了也没用）
      if (CONFIG.isPublic && registry) {
        const publicIp = getPublicIPv4() || CONFIG.advertiseHost || '';
        if (!publicIp) {
          console.log('[P2P] 无公网 IP，跳过 peer registry 注册（仍作为 Hyperswarm 中继）');
        } else {
          const publishInfo = {
            host: publicIp,
            port: CONFIG.port,
            dhtPort: CONFIG.dhtPort || 0,
            publicRelay: true,
            wsSignaling: `ws://${publicIp}:${CONFIG.port}/signaling`
          };
          await registry.publishPeer(publishInfo).catch(e => {
            console.log(`[P2P] 注册中心注册失败: ${e.message}`);
          });
          console.log(`[P2P] 公网节点已注册到对等网络 (${publicIp})`);
          this._peerHeartbeat = setInterval(async () => {
            try { await registry.publishPeer(publishInfo); }
            catch (e) { /* 静默失败 */ }
          }, 60000);
        }
      }
      // 启动直连 TCP 服务器（局域网 / 本地绕过 DHT）
      if (CONFIG.directListen > 0) {
        this.p2p.listenDirect(CONFIG.directListen);
      }
      console.log(`[P2P] Hyperswarm 网络已加入`);
    } catch (p2pErr) {
      console.log(`[P2P] 启动跳过: ${p2pErr.message}`);
    }

    // 自动构建 deploy/（静默执行，仅失败时显示错误摘要）
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
        console.log(`[Deploy] build 跳过${detail ? ': ' + detail : ''}`);
      }
    }

    // 启动新增的 REST API 服务器（31 个端点）
    try {
      const { default: APIServer } = await import('./api/server.js');
      this.apiServer = new APIServer({ port: CONFIG.port + 1, swarm: this.p2p, deployEnabled: deployServerEnabled });
      await this.apiServer.start();
      console.log(`[API] REST 服务器: http://localhost:${CONFIG.port + 1}`);
      console.log(`[API] 端点: /api/v1/agents, /api/v1/p2p, /api/v1/updates, /api/v1/skills, /api/v1/versions, /api/v1/resources`);
      // 启动 AI 居民调度器
      residentScheduler.start();
      console.log(`[调度器] 居民自主生活循环已启动`);

      // 注册 P2P 事件监听
      if (this.p2p) {
        // 所有语义消息类型统一日志（类型名直接从 wire 上携带，不走包裹）
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
            console.log(`[P2P] 收到 ${t}: from=${data.from?.slice(0, 8) || '?'}...`);
          });
        }

        this.p2p.on('peer-connected', (peerId) => {
          console.log(`[P2P] Peer 已连接: ${peerId?.slice(0, 8) || peerId}...`);
        });
        this.p2p.on('peer-disconnected', (peerId) => {
          console.log(`[P2P] Peer 已断开: ${peerId?.slice(0, 8) || peerId}...`);
        });

        // 注入 P2P 到居民管理器（使居民 think() 可走 LLM 代理）
        residentManager.setP2P(this.p2p);

        // 接收其他 Bridge 推送的社区活动
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

        // P2R: 居民治家初始化（try 块防止 HouseOrchestrator 报错阻止后续初始化）
        try {
        const { SafeEvolution } = await import('./core/safe-evolution.js');
        const { BridgeSpawn } = await import('./core/bridge-spawn.js');
        const { detectBestStrategy } = await import('./core/launch-strategies.js');
        const { House } = await import('./core/house.js');
        const { LLMProxyAgent } = await import('./core/llm-proxy-agent.js');

        const safeEvo = new SafeEvolution(this.p2p, this.p2p.peerId || 'bridge-1');

        // 初始化默认 House（主 Bridge / 子 Bridge 各自创建）
        if (!this.house) {
          const bridgeId = this.p2p.peerId || 'bridge-1';
          this.house = new House(effectiveHouseId, bridgeId, hostId, 'default');
          await this.house.init();
        }

        const detectedStrategy = detectBestStrategy();
        console.log(`[Launch] 启动策略: ${detectedStrategy}`);
        const bridgeSpawn = new BridgeSpawn(this.p2p, hostId, this.house, detectedStrategy);

        // Fairy spawn：必须在 HouseOrchestrator 前（避免其报错阻止）
        if (isMain) {
          for (let i = 0; i < 6; i++) {
            const c = bridgeSpawn.spawnNesting({ name: `仙女${i+1}` });
            if (c) console.log(`[P2R] 仙女${i+1} port=${c.port}`);
          }
        }

        const { HouseOrchestrator } = await import('./core/house-orchestrator.js');
        this.houseOrchestrator = new HouseOrchestrator(this.p2p, this.p2p.peerId || 'bridge-1', safeEvo, this.house, bridgeSpawn);
        residentScheduler.houseOrchestrator = this.houseOrchestrator;
        this.safeEvolution = safeEvo;
        this.bridgeSpawn = bridgeSpawn;

        // LLM 代理：接收子桥的 LLM 调用请求
        this.llmProxy = new LLMProxyAgent(this.p2p, { enabled: true });
        this.llmProxy.start();
        console.log('[P2R] HouseOrchestrator + SafeEvolution + BridgeSpawn + LLMProxy 已启动');

        // Fairy spawn：端口 3002-3007
        if (isMain) {
          for (let i = 0; i < 6; i++) {
            const c = bridgeSpawn.spawnNesting({ name: `仙女${i+1}` });
            if (c) console.log(`[P2R] 仙女${i+1} port=${c.port}`);
          }
        }
        } catch (e) { console.log(`[启动] P2R 初始化失败: ${e.message}`); }

        // P2R-K: 收敛引擎 — 问题分解→竞标→求解→择优
        try {
          const { ProblemDecomposer } = await import('./core/problem-decomposer.js');
          const { ConvergenceEngine } = await import('./core/convergence-engine.js');
          const { SolutionEngine } = await import('./core/solution-engine.js');
          const { SolutionOptimizer } = await import('./core/solution-optimizer.js');
          this.problemDecomposer = new ProblemDecomposer();
          this.convergenceEngine = new ConvergenceEngine();
          this.solutionEngine = new SolutionEngine();
          this.solutionOptimizer = new SolutionOptimizer();

          // 注入收敛系统到居民调度器
          const { residentScheduler } = await import('./core/resident-scheduler.js');
          residentScheduler.setConvergenceSystem(
            this.knowledgeBase,
            this.problemDecomposer,
            this.convergenceEngine,
            this.solutionEngine,
            this.solutionOptimizer
          );

          console.log('[P2R-K] 收敛引擎已启动 (分解+竞标+求解+优化)');
        } catch (e) {
          console.log(`[P2R-K] 收敛引擎启动失败: ${e.message}`);
        }

        // 启动学习核心
        this.learningCore = new LearningCore(this.knowledgeBase, this.p2p, port, residentScheduler);
        if (isMain) {
          startLearningCore(this);
          console.log(`[学习核心]  主模式 IQ=${this.learningCore.iq} Age=${this.learningCore.age} Solved=${this.learningCore.solvedCount}`);
        } else {
          console.log(`[学习核心]  仙女模式`);
          startFairyMonitor(this, CONFIG.mainPort);
          startHeartbeat(this, port, CONFIG.mainPort);
        }

        // P2R-K: 响应邻居的问题求解请求
        this.p2p.on(P2PMessageType.PROBLEM_SOLVE, async (data) => {
          const p = data.payload || {};
          try {
            const domain = p.domain || 'general';

            // 1. 先查知识库
            let kbHit = false;
            if (this.knowledgeBase && p.question) {
              const kbAns = this.knowledgeBase.answer(domain, p.question);
              if (kbAns && kbAns.verified) {
                kbHit = true;
              }
            }

            // 2. 加入调度器队列（让居民按 traits 分角色求解）
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

            // 3. 回复（先返回 KB 能回答的部分）
            const result = {
              problemId: p.problemId,
              ok: true,
              answer: kbHit ? 'solved' : 'pending',
              fromBridge: this.p2p?.peerId || '?',
              note: kbHit ? '知识库命中' : '已分发居民求解',
            };
            this.p2p.sendTo(data.from, { type: P2PMessageType.PROBLEM_RESULT, payload: result });
          } catch (e) {
            console.log(`[P2R-K] 求解失败: ${e.message}`);
          }
        });

        // P2R: 窟验证回复
        this.p2p.on('safe-house-verify', (data) => {
          const payload = data.payload || {};
          const from = data.from;
          const remoteHostId = payload.hostId || '';
          console.log(`[P2R] 收到窟验证: from=${from?.slice(0, 8) || '?'}... hostId=${remoteHostId.slice(0, 8) || '?'}`);
          // 更新所有居民中指向该 bridge 的窟的 lastVerified 和 hostId
          for (const r of residentManager.list(null)) {
            const houses = r.safeHouses || [];
            const idx = houses.findIndex(h => h.bridgeId === from);
            if (idx !== -1) {
              houses[idx].lastVerified = Date.now();
              houses[idx].health = 100; // 能回复说明活着
              if (remoteHostId) houses[idx].hostId = remoteHostId;
              residentManager.registerSafeHouse(r.id, houses[idx]);
            }
          }
        });

        // P2R: 居民迁移请求
        this.p2p.on('resident-transfer', async (data) => {
          const payload = data.payload || {};
          const incoming = payload.residents || [];
          const sourceHostId = payload.sourceHostId || '';
          const sourceBridgeId = payload.sourceBridgeId || '';
          console.log(`[P2R] 收到居民迁移: ${incoming.length} 人 from=${data.from?.slice(0, 8) || '?'} hostId=${sourceHostId.slice(0, 8) || '?'}`);
          for (const r of incoming) {
            const existing = residentManager.list(null).find(x => x.name === r.name);
            if (existing) {
              console.log(`[P2R] ${r.name} 已存在，跳过`);
              continue;
            }
            const created = residentManager.create(r.name, { traits: r.traits });

            // 为迁入居民创建独立 House
            if (!this._migratedHouse) {
              const { House: ImportedHouse } = await import('./core/house.js');
              const migratedHouseId = `${hostId}_migrated`;
              this._migratedHouse = new ImportedHouse(migratedHouseId, this.p2p?.peerId || 'bridge-1', hostId, 'migrated');
              await this._migratedHouse.init();
            }

            residentManager.addActivity(created.id, {
              type: 'migrated_in',
              message: `从 ${sourceBridgeId?.slice(0, 8) || '?'} 迁入`,
            });
            // 把原 bridge 记为首个安全屋（带 hostId）
            residentManager.registerSafeHouse(created.id, {
              bridgeId: sourceBridgeId,
              hostId: sourceHostId || sourceBridgeId,
              host: sourceBridgeId,
              lastVerified: Date.now(),
              health: 100,
            });
            console.log(`[P2R] 接收居民: ${r.name}`);
          }
        });

        // P2R: 广播消息（HOUSE_SEEK / HOUSE_NEED）
        this.p2p.on('HOUSE_SEEK', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          console.log(`[P2R] 收到找窟请求: ${p.residentName} (hostId=${hid}, 偏好: ${p.preferredType})`);
          // 如果本 Bridge 有 House，回复安全屋信息
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
            console.log(`[P2R] 安全屋注册成功: ${p.houseId?.slice(0, 8)} → resident#${p.sourceResidentId}`);
          }
        });
        this.p2p.on('HOUSE_NEED', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          console.log(`[P2R] 收到求助: ${p.residentName} (hostId=${hid}, 健康: ${p.healthScore})`);
        });

        // P2R-S: 安全自治事件
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
          console.log(`[P2R-S] 变更应用: ${p.file} by ${p.appliedBy?.slice(0, 8)}`);
        });
        // 分布式 Fairy Gossip
        this.p2p.on('fairy_gossip', (data) => {
          const p = data.payload || {};
          if (this.learningCore?.reasoning) {
            this.learningCore.reasoning.experienceCount = (this.learningCore.reasoning.experienceCount || 0) + 1;
            console.log(`[Gossip] 收到 ${p.port} 解题经验: ${p.problemId}`);
          }
        });
      }
    } catch (e) {
      console.log(`[启动] API/P2R 初始化失败: ${e.message}`);
    }

    // 无头模式：启动统一服务 (HTTP + WebSocket)
    if (CONFIG.headless) {
      this.startServer();

      // 公网节点自动补全 WS 信令地址（若未显式指定）
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
      console.log(`[WS]   Voice: ${sigUrl}${CONFIG.wsSignalingUrl ? '' : ' (未配置 wsSignaling, 仅本地)'}`);
      if (CONFIG.host === 'localhost') {
        console.log('[提示] 仅监听本地连接（自动检测未发现公网 IP）');
      }
      console.log('');
      console.log('[Bridge] 运行中... (Ctrl+C 停止)');
      console.log('[提示] 使用 --cli 参数进入交互模式');

      // Headless 模式的信号处理
      this.setupHeadlessSignalHandlers();
    } else {
      // CLI 模式 - startCLI 内部处理信号
      console.log('');
      this.cli.startCLI();
    }
  }

  /**
   * Headless 模式的信号处理（仅用于无 CLI 交互的情况）
   */
  setupHeadlessSignalHandlers() {
    const onExit = () => {
      this.shutdown();
    };

    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);

    // Windows 平台额外处理
    if (process.platform === 'win32' && process.stdin.isTTY) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.on('SIGINT', onExit);
      this.signalRL = rl;
    }
  }

  /**
   * 统一服务（HTTP + WebSocket）
   * HTTP API: 根路径
   * WebSocket: /ws (聊天)
   * WebSocket: /signaling (语音，预留)
   */
  startServer() {
    // 创建 HTTP 服务器
    this.httpServer = http.createServer(async (req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
      const pathname = url.pathname;

      try {
        // 路由处理
        if (pathname === '/api/status' && req.method === 'GET') {
          await this.h.handleStatus(req, res);
        } else if (pathname === '/api/providers' && req.method === 'GET') {
          await this.h.handleProviders(req, res);
        } else if (pathname === '/api/sessions' && req.method === 'GET') {
          await this.h.handleSessions(req, res);
        } else if (pathname === '/api/chat' && req.method === 'POST') {
          await this.h.handleChat(req, res);
        } else if (pathname === '/api/chat/stream' && req.method === 'POST') {
          await this.h.handleChatStream(req, res);
        } else if (pathname === '/api/config' && req.method === 'GET') {
          await this.h.handleGetConfig(req, res);
        } else if (pathname === '/api/config' && req.method === 'POST') {
          await this.h.handleSetConfig(req, res);
        } else if (pathname === '/api/memory' && req.method === 'GET') {
          await this.h.handleMemoryStats(req, res);
        } else if (pathname === '/api/memory' && req.method === 'POST') {
          await this.h.handleMemoryOp(req, res);
        } else if (pathname === '/api/provider/connect' && req.method === 'POST') {
          await this.h.handleProviderConnect(req, res);
        } else if (pathname === '/api/provider/models' && req.method === 'GET') {
          await this.h.handleProviderModels(req, res);
        } else if (pathname === '/api/provider/set' && req.method === 'POST') {
          await this.h.handleProviderSet(req, res);
        } else if (pathname === '/api/agents' && req.method === 'GET') {
          await this.h.handleAgentsList(req, res);
        } else if (pathname === '/api/agents/history' && req.method === 'GET') {
          await this.h.handleAgentsHistory(req, res);
        } else if (pathname.startsWith('/api/agents/') && req.method === 'GET') {
          await this.h.handleAgentStatus(req, res, pathname.replace('/api/agents/', ''));
        } else if (pathname.startsWith('/api/agents/') && req.method === 'POST') {
          await this.h.handleAgentAction(req, res, pathname.replace('/api/agents/', ''));
        } else if (pathname === '/api/learning' && req.method === 'GET') {
          await this.h.handleLearningStatus(req, res);
        } else if (pathname === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - this.startTime }));
        } else if (pathname === '/peers' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const peers = this.p2p ? [...this.p2p.connectedPeers.keys()].map(id => ({
            peerId: id.slice(0, 8),
            info: this.p2p.peerInfo.get(id) || {}
          })) : [];
          res.end(JSON.stringify({ peers }));
        } else if (pathname === '/api/heartbeat' && req.method === 'POST') {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', () => {
            try {
              const p = JSON.parse(body);
              if (this.learningCore?.guardian && p.port) {
                this.learningCore.guardian.receiveHeartbeat(p.port);
              }
            } catch {}
            res.writeHead(200);
            res.end('ok');
          });
        } else if (pathname === '/api/dashboard' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const lc = this.learningCore;
          let pool=0, s=0, p=0, iq=0, age=0;
          if (lc) {
            try {
              pool = lc.problemPool?.length || 0;
              s = lc.solvedCount || 0;
              p = pool - s;
              iq = lc.iq || 0;
              age = lc.age || 0;
            } catch (e) { console.log('[Dash] load fail:', e.message); }
          }
          // 后备：直接从文件读取问题池和经验
          if (pool === 0) {
            try {
              const { homedir } = await import('os');
              const { join } = await import('path');
              const { readFileSync, readdirSync, existsSync } = await import('fs');
              const poolDir = join(homedir(), '.openchat', 'problem-pool');
              if (existsSync(poolDir)) {
                const files = readdirSync(poolDir).filter(f => f.endsWith('.json'));
                for (const f of files) {
                  const p = JSON.parse(readFileSync(join(poolDir, f), 'utf8'));
                  pool += Array.isArray(p) ? p.length : 1;
                }
              }
              const expDir = join(homedir(), '.openchat', 'experience');
              if (existsSync(expDir)) {
                s = readdirSync(expDir).filter(f => f.endsWith('.json')).length;
              }
            } catch (e) {}
          }
          iq = iq || 100;
          let fairies = { 3002:0,3003:0,3004:0,3005:0,3006:0,3007:0 };
          for (const port of [3002,3003,3004,3005,3006,3007]) {
            try { 
              const r = await fetch(`http://localhost:${port}/api/status`, { signal: AbortSignal.timeout(1000) });
              fairies[port] = r.ok ? 1 : 0;
            } catch { fairies[port] = 0; }
          }
          const data = { iq: iq || 100, age: age || pool, solved: s, poolSize: pool, pending: Math.max(0, pool - s), fairies };
          res.end(JSON.stringify(data));
        } else if (pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(dashboardHTML());
          }
        } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });

    // 挂载 WebSocket 服务器 (聊天)
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/ws'
    });

    this.wss.on('connection', (ws) => {
      console.log('[WS] 客户端已连接');
      this.clients.add(ws);

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.h.handleWSMessage(ws, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', data: { message: e.message } }));
        }
      });

      ws.on('close', () => {
        console.log('[WS] 客户端已断开');
        this.clients.delete(ws);
      });

      ws.send(JSON.stringify({
        type: MessageType.BRIDGE_HANDSHAKE,
        data: {
          clientId: this.clientId,
          version: 2
        }
      }));
    });

    // WebRTC 信令 WebSocket（手机↔Bridge 的 SDP/ICE 交换路径）
    this.signalingWss = new WebSocketServer({
      server: this.httpServer,
      path: '/signaling'
    });

    this.signalingWss.on('connection', (ws) => {
      let registeredPeerId = null;
      console.log('[Signaling] 客户端已连接');

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // 信令消息格式: { type: 'signaling_message', data: { ... } }
          if (msg.type === 'signaling_message' && msg.data) {
            const d = msg.data;

            // 注册：手机告知自己的 peerId
            if (d.action === 'register') {
              registeredPeerId = d.peerId;
              this.signalingRooms.set(registeredPeerId, ws);
              console.log(`[Signaling] 节点已注册: ${registeredPeerId?.slice(0, 8) || registeredPeerId}...`);
              ws.send(JSON.stringify({
                type: 'signaling_message',
                data: { action: 'registered', peerId: registeredPeerId }
              }));
              return;
            }

            // offer / answer / ice_candidate → 转发给目标 peer
            if (d.toPeerId) {
              const targetWs = this.signalingRooms.get(d.toPeerId);
              if (targetWs && targetWs.readyState === 1) { // WebSocket.OPEN
                targetWs.send(JSON.stringify(msg));
              } else {
                console.log(`[Signaling] 目标节点未连接: ${d.toPeerId?.slice(0, 8)}...`);
                ws.send(JSON.stringify({
                  type: 'signaling_message',
                  data: { type: 'error', message: 'Target peer not available' }
                }));
              }
              return;
            }

            console.log(`[Signaling] 未处理的消息类型: ${d.type || 'unknown'}`);
          }
        } catch (e) {
          console.error('[Signaling] 解析错误:', e.message);
        }
      });

      ws.on('close', () => {
        console.log(`[Signaling] 客户端已断开: ${registeredPeerId?.slice(0, 8) || 'unknown'}...`);
        if (registeredPeerId) {
          this.signalingRooms.delete(registeredPeerId);
        }
      });

      ws.on('error', (err) => {
        console.error(`[Signaling] 错误: ${err.message}`);
        if (registeredPeerId) {
          this.signalingRooms.delete(registeredPeerId);
        }
      });
    });

    // 启动 HTTP 服务器
    this.httpServer.listen(CONFIG.port, CONFIG.host);
    console.log(`[HTTP] 正在监听 ${CONFIG.host}:${CONFIG.port}`);

  async shutdown() {
    console.log('\n[Bridge] 正在关闭...');

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

    // 关闭 REST API 服务器
    if (this.apiServer) {
      await this.apiServer.stop();
    }

    // 停止心跳并从 peer 目录注销
    if (this._peerHeartbeat) {
      clearInterval(this._peerHeartbeat);
      this._peerHeartbeat = null;
    }
    if (this.registry) {
      await this.registry.unpublishPeer().catch(() => {});
    }

    // 停止自学习
    if (this._learningTimer) {
      clearInterval(this._selfLearnTimer);
      this._selfLearnTimer = null;
    }

    // 停止 P2P 网络（在调度器之前）
    if (this.p2p) await this.p2p.stop();

    // 停止居民调度器
    residentScheduler.stop();

    console.log('[Bridge] 已退出，再见!');
    process.exit(0);
  }
}

export async function startBridge(detectedTools = [], options = {}) {
  // 允许通过 options 覆盖配置
  if (options.headless !== undefined) CONFIG.headless = options.headless;
  if (options.port) CONFIG.port = options.port;
  if (options.host) CONFIG.host = options.host;

  const bridge = new Bridge();
  await bridge.start(detectedTools);
}

// 自动启动（当作为主模块运行时）
// 使用更可靠的检测方式
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
    console.error('Bridge 启动失败:', e.message);
    process.exit(1);
  });
}
