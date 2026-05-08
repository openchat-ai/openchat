import 'dotenv/config';
import * as readline from 'readline';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import os from 'os';
import { sessionManager } from './session/session-manager.js';

// 新增：REST API 服务器（31 个端点）
// 使用动态 import 加载 CommonJS 模块
let apiServer = null;
import { executeCommand, commands } from './cli/commands.js';
import { MessageBuilder, MessageType } from './protocol/message.js';
import { WebSocketServer } from 'ws';
import { router } from './core/router.js';
import { initCore } from './core/handlers.js';
import { CLIGateway, WSGateway } from './gateway/base.js';
import { persistentConfig } from './core/persistent-config.js';
import { providerManager } from './providers/provider-manager.js';
import { providerRegistry } from './providers/provider-registry.js';
import { memoryManager } from './memory/memory-manager.js';
import { agentMonitor } from './core/agent-monitor.js';
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
import P2PSwarm, { hasPublicAddress, getPublicIPv4 } from './p2p/swarm.js';
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

// 解析命令行参数
// 读取顺序：~/.openchat/config.json bridge.* → CLI 覆盖
// 公网 IP 自动检测（无需 --public 参数）
const args = process.argv.slice(2);
const savedBridge = persistentConfig.getBridgeConfig();
const isInteractive = args.includes('--cli') || args.includes('-i');

const isHeadless = savedBridge.mode === 'cli' && !isInteractive ? false : !isInteractive;
const isPublic = hasPublicAddress() || !!savedBridge.advertiseHost;

// 支持 --port 命令行参数覆盖配置
const portArgIndex = args.findIndex(a => a.startsWith('--port='));
const cliPort = portArgIndex !== -1 ? parseInt(args[portArgIndex].split('=')[1]) : null;
const port = cliPort || savedBridge.port || 3000;
const isMain = port === 3800 || process.argv.includes('--main');

const dhtPort = savedBridge.dhtPort || 0;
const localBootstrap = savedBridge.localBootstrap || [];
let directListen = savedBridge.directListen || 0;
let directConnect = savedBridge.directConnect || [];
// 支持 --directListen CLI 参数
const directListenIdx = args.findIndex(a => a.startsWith('--directListen='));
if (directListenIdx !== -1) {
  directListen = parseInt(args[directListenIdx].split('=')[1]);
}
// 本地开发：无 bootstrap 时自动启用直连 TCP（端口 = HTTP 端口 + 2）
const isNesting = args.includes('--nesting');
if (!directListen && localBootstrap.length === 0 && !args.includes('--no-direct') && !isNesting) {
  directListen = port + 2;
}
const bridgeName = savedBridge.name || `bridge-${Math.random().toString(36).substr(2, 4)}`;
const bridgeRegion = savedBridge.region || process.env.REGION || 'unknown';
const wsSignalingUrl = savedBridge.wsSignaling || '';
const advertiseHost = savedBridge.advertiseHost || '';
const bridgeTopic = savedBridge.topic || 'openchat-community';
const qiniuEnabled = savedBridge.qiniuEnabled !== false;
const cores = savedBridge.cores || [];
const deployServerEnabled = savedBridge.deployServerEnabled === true; // 默认 false（随 bridge 启动构建量太大，按需开启）
const deployServerPort = savedBridge.deployServerPort || 8080;

// hostId：持久标识，子进程可通过 --hostId 覆盖
let hostId = savedBridge.hostId || '';
const hostIdArgIndex = args.findIndex(a => a.startsWith('--hostId='));
if (hostIdArgIndex !== -1) {
  hostId = args[hostIdArgIndex].split('=')[1];
}
// 确保 hostId 已生成（第一次启动自动创建 UUID）
if (!hostId) {
  hostId = persistentConfig.getHostId();
}

// houseId：子进程通过 --houseId 指定，默认 hostId + '_default'
let houseIdArg = '';
const houseIdArgIndex = args.findIndex(a => a.startsWith('--houseId='));
if (houseIdArgIndex !== -1) {
  houseIdArg = args[houseIdArgIndex].split('=')[1];
}
const effectiveHouseId = houseIdArg || `${hostId}_default`;

// --parent：nesting 子进程连接父 Bridge 的直连 TCP 端口
const parentIndex = args.findIndex(a => a.startsWith('--parent='));
if (parentIndex !== -1) {
  const parentPort = port + 2; // 父 Bridge 的 directListen 默认是 port+2
  if (!directConnect.find(d => d.host === 'localhost' && d.port === parentPort)) {
    directConnect.push({ host: 'localhost', port: parentPort });
  }
}

// --save-config 持久化本次设置
if (args.includes('--save-config')) {
  persistentConfig.setBridgeConfig({
    mode: isHeadless ? 'headless' : 'cli',
    port, name: bridgeName, region: bridgeRegion,
    dhtPort, localBootstrap, directListen, directConnect,
    wsSignaling: wsSignalingUrl,
    advertiseHost,
    qiniuEnabled, cores,
    topic: bridgeTopic
  });
  console.log(`[Config] 已保存到 ${path.join(os.homedir(), '.openchat', 'config.json')}`);
}

const CONFIG_HOST = isPublic ? '0.0.0.0' : 'localhost';
const CONFIG = {
  port,
  host: CONFIG_HOST,
  headless: isHeadless,
  isPublic,
  enableWebSocket: true,
  dhtPort,
  localBootstrap,
  directListen,
  directConnect,
  bridgeName,
  bridgeRegion,
  wsSignalingUrl,
  advertiseHost,
  qiniuEnabled,
  cores,
  bridge: {
    port,
    name: bridgeName,
    region: bridgeRegion,
    dhtPort,
    directListen,
    directConnect,
    topic: bridgeTopic
  }
};

const COMMANDS = [
  'help', 'status', 'clear', 'exit', 'quit',
  'provider add', 'provider remove', 'provider list',
  'session create', 'session close', 'session list', 'session history',
  'chat'
];

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
  }

  getPrompt() {
    const provider = persistentConfig.getPreference('currentProvider');
    const model = persistentConfig.getPreference('currentModel');
    if (provider) {
      // 只显示服务商简称，不显示具体模型名，避免界面混乱
      const p = providerManager.getProvider(provider);
      const pname = p?.nameCn || provider;
      // 简化显示，避免显示冗余信息
      return pname;  // 不再显示 /模型名 部分
    }
    return null;
  }

  getPromptString() {
    const current = this.getPrompt();
    // 简化提示符，避免显示过多信息
    return current ? `openchat > ` : 'openchat > ';
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

    await this.autoConfigProviders(detectedTools);

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

        // P2R: 居民治家初始化
        const { SafeEvolution } = await import('./core/safe-evolution.js');
        const { BridgeSpawn } = await import('./core/bridge-spawn.js');
        const { detectBestStrategy } = await import('./core/launch-strategies.js');
        const { House } = await import('./core/house.js');
        const { LLMProxyAgent } = await import('./core/llm-proxy-agent.js');

        const { Body } = await import('./core/body.js');
        const { Subconscious } = await import('./core/subconscious.js');
        const { NeuralMesh } = await import('./core/neural-mesh.js');

        // 初始化仙女身体
        if (!this.body) {
          this.body = new Body(port, isMain ? '大仙女' : `仙女${port}`);
          this.subconscious = new Subconscious(this.body, null);
          this.subconscious.heartbeat();
          console.log(`[Body] ${this.body.name} 诞生`);
        }

        // 神经网格
        this.neuralMesh = new NeuralMesh(this.p2p, port);

        const safeEvo = new SafeEvolution(this.p2p, this.p2p.peerId || 'bridge-1');

        // 兼容旧 House 引用
        if (!this.house) this.house = this.body;

        const detectedStrategy = detectBestStrategy();
        console.log(`[Launch] 启动策略: ${detectedStrategy}`);
        const bridgeSpawn = new BridgeSpawn(this.p2p, hostId, this.house, detectedStrategy);

        const { HouseOrchestrator } = await import('./core/house-orchestrator.js');
        this.houseOrchestrator = new HouseOrchestrator(this.p2p, this.p2p.peerId || 'bridge-1', safeEvo, this.house, bridgeSpawn);
        residentScheduler.houseOrchestrator = this.houseOrchestrator;
        this.safeEvolution = safeEvo;
        this.bridgeSpawn = bridgeSpawn;

        // LLM 代理：接收子桥的 LLM 调用请求
        this.llmProxy = new LLMProxyAgent(this.p2p, { enabled: true });
        this.llmProxy.start();
        console.log('[P2R] Body + SafeEvolution + BridgeSpawn + LLMProxy 已启动');

        // 仙女 spawn（只有主Bridge生成）
        if (isMain) {
          const N = parseInt(process.env.AUTO_CHILDREN || '6');
          console.log(`[P2R] 生成 ${N} 个仙女身体...`);
          for (let i = 0; i < N; i++) {
            const c = bridgeSpawn.spawnNesting({ name: `仙女${i+1}` });
            if (c) console.log(`[P2R] 仙女${i+1} port=${c.port}`);
          }
        }

        // P2R-K: 公共知识库
        try {
          const { KnowledgeBase } = await import('./core/knowledge-base.js');
          this.knowledgeBase = new KnowledgeBase(this.p2p);
          await this.knowledgeBase.init();
          console.log('[P2R-K] 公共知识库已启动');
        } catch (e) {
          console.log(`[P2R-K] 知识库启动失败: ${e.message}`);
        }

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

        // 启动学习核心（整合：自学习+调度+协作+收敛）
        this.learningCore = new LearningCore(this.knowledgeBase, this.p2p, port, residentScheduler);
        this._startLearningCore();
        console.log(`[学习核心] 智商=${this.learningCore.iq} 年龄=${this.learningCore.age} 已解决=${this.learningCore.solvedCount}`);

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
      this.startCLI();
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
          await this.handleStatus(req, res);
        } else if (pathname === '/api/providers' && req.method === 'GET') {
          await this.handleProviders(req, res);
        } else if (pathname === '/api/sessions' && req.method === 'GET') {
          await this.handleSessions(req, res);
        } else if (pathname === '/api/chat' && req.method === 'POST') {
          await this.handleChat(req, res);
        } else if (pathname === '/api/chat/stream' && req.method === 'POST') {
          await this.handleChatStream(req, res);
        } else if (pathname === '/api/config' && req.method === 'GET') {
          await this.handleGetConfig(req, res);
        } else if (pathname === '/api/config' && req.method === 'POST') {
          await this.handleSetConfig(req, res);
        } else if (pathname === '/api/memory' && req.method === 'GET') {
          await this.handleMemoryStats(req, res);
        } else if (pathname === '/api/memory' && req.method === 'POST') {
          await this.handleMemoryOp(req, res);
        } else if (pathname === '/api/provider/connect' && req.method === 'POST') {
          await this.handleProviderConnect(req, res);
        } else if (pathname === '/api/provider/models' && req.method === 'GET') {
          await this.handleProviderModels(req, res);
        } else if (pathname === '/api/provider/set' && req.method === 'POST') {
          await this.handleProviderSet(req, res);
        } else if (pathname === '/api/agents' && req.method === 'GET') {
          await this.handleAgentsList(req, res);
        } else if (pathname === '/api/agents/history' && req.method === 'GET') {
          await this.handleAgentsHistory(req, res);
        } else if (pathname.startsWith('/api/agents/') && req.method === 'GET') {
          await this.handleAgentStatus(req, res, pathname.replace('/api/agents/', ''));
        } else if (pathname.startsWith('/api/agents/') && req.method === 'POST') {
          await this.handleAgentAction(req, res, pathname.replace('/api/agents/', ''));
        } else if (pathname === '/api/learning' && req.method === 'GET') {
          await this.handleLearningStatus(req, res);
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
} else if (pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html lang="zh"><head><meta charset="utf-8"><title>OpenChat</title></head>
<body style="background:#0a0a1a;color:#e0e0e0;font-family:monospace;padding:20px">
<h1 style="color:#7c8aff">OpenChat Bridge</h1>
<pre id="out" style="font-size:13px;line-height:1.6">Loading...</pre>
<script>
async function R(){
  try{const d=await(await fetch('/api/dashboard')).json();
  const L=d.learning||{},R=d.reasoning||{},B=d.brain||{};
  document.getElementById('out').innerHTML=
    'IQ: <b style=color:#7c8aff>'+L.iq+'</b>  Age: <b style=color:#ffa502>'+L.age+'</b>  Solved: <b style=color:#2ed573>'+L.solved+'</b>  Pool: <b style=color:#4fc3f7>'+L.poolSize+'</b> (Pending: '+L.pending+')'+
    '\\nIndependence: <b style=color:#ce93d8>'+(R.independence||'0%')+'</b>  Self: <b style=color:#7c8aff>'+(R.selfSolves||0)+'</b>  API: <b style=color:#ff4757>'+(R.llmCalls||0)+'</b>'+
    '\\nNN: <b style=color:#81c784>'+(B.accuracy||'0%')+'</b>'+
    '\\n---Residents---\\n'+(d.residents||[]).map(r=>r.name+' ['+r.thinkingStyle+']').join('  ');
  }catch(e){document.getElementById('out').textContent='Waiting... '+e.message}
}
R();setInterval(R,5000);
</script></body></html>`);
        } else {
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
          await this.handleWSMessage(ws, msg);
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
  }

  async handleLearningStatus(req, res) {
    const stats = this.learningCore ? this.learningCore.getStats() : { iq: 0, age: 0, solvedCount: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  }

  async handleStatus(req, res) {
    const provider = persistentConfig.getPreference('currentProvider');
    const model = persistentConfig.getPreference('currentModel');
    const memStats = await memoryManager.getStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      currentProvider: provider,
      currentModel: model,
      wsClients: this.clients.size,
      memory: memStats
    }));
  }

  async handleProviders(req, res) {
    // 使用新的统一 Provider 系统
    const providers = providerRegistry.listAll();
    const current = persistentConfig.getPreference('currentProvider');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      current,
      providers
    }));
  }

  async handleSessions(req, res) {
    const sessions = sessionManager.listSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions }));
  }

  async handleChat(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, sessionId } = JSON.parse(body);

        // 走 resident 调度器流程（分布式协作）
        // 1. 先检查知识库
        const kb = residentScheduler?._convergenceSystem?.kb;
        let cachedAnswer = null;
        if (kb) {
          cachedAnswer = kb.answer('general', message);
        }

        if (cachedAnswer) {
          // 知识库有答案，直接返回
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response: cachedAnswer,
            source: 'knowledge_base'
          }));
          return;
        }

        // 2. 没有答案，加入调度器让居民求解
        const problemId = `chat_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        
        if (residentScheduler) {
          // 添加问题到调度器
          residentScheduler.addProblem({
            problemId,
            domain: 'general',
            question: message,
            subQuestions: [],
            from: 'api_chat',
          });

          // 等待一段时间让居民求解（最多 10 秒）
          const maxWait = 10000;
          const checkInterval = 500;
          let waited = 0;
          
          while (waited < maxWait) {
            await new Promise(r => setTimeout(r, checkInterval));
            waited += checkInterval;
            
            // 检查是否已有解
            const pending = residentScheduler._pendingProblems?.find(p => p.problemId === problemId);
            if (pending?.status === 'done' && pending.answer) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                response: pending.answer,
                source: 'residents_convergence'
              }));
              return;
            }
          }

          // 超时，返回处理中
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response: '问题已提交，正在求解中...',
            source: 'residents_processing',
            problemId
          }));
        } else {
          // 没有调度器，回退到直接 LLM
          throw new Error('Resident scheduler not available');
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  /**
   * 流式聊天接口 (Server-Sent Events)
   */
  async handleChatStream(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, sessionId, provider, model } = JSON.parse(body);

        // 设置 SSE 头
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        // 发送 SSE 事件的辅助函数
        const sendEvent = (event, data) => {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // 如果没有 session，创建一个
        let sid = sessionId;
        if (!sid) {
          const p = provider || persistentConfig.getPreference('currentProvider');
          const m = model || persistentConfig.getPreference('currentModel');
          sid = await sessionManager.createSession(p, m);
        }

        sendEvent('session', { sessionId: sid });

        // 导入 agentEngine
        const { agentEngine } = await import('./core/agent-engine.js');

        // 使用流式处理
        let fullContent = '';
        await agentEngine.processStream(sid, 'default-user', message, (event) => {
          switch (event.type) {
            case 'thinking':
              sendEvent('thinking', { iteration: event.iteration });
              break;
            case 'content':
              fullContent += event.content;
              sendEvent('content', { chunk: event.content });
              break;
            case 'tool_call':
              sendEvent('tool_call', { tool: event.tool, args: event.args });
              break;
            case 'tool_result':
              sendEvent('tool_result', { tool: event.tool, result: event.result });
              break;
            case 'complete':
              sendEvent('complete', {
                response: event.response || fullContent,
                iterations: event.iterations
              });
              break;
            case 'error':
              sendEvent('error', { message: event.error || event.message });
              break;
          }
        });

        res.end();
      } catch (e) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
        res.end();
      }
    });
  }

  async handleGetConfig(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      currentProvider: persistentConfig.getPreference('currentProvider'),
      currentModel: persistentConfig.getPreference('currentModel'),
      configuredProviders: persistentConfig.listProviders()
    }));
  }

  async handleSetConfig(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { provider, model, apiKey } = JSON.parse(body);

        if (apiKey) {
          persistentConfig.setApiKey(provider, apiKey);
        }
        if (provider) {
          persistentConfig.setPreference('currentProvider', provider);
        }
        if (model) {
          persistentConfig.setPreference('currentModel', model);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  async handleMemoryStats(req, res) {
    const stats = await memoryManager.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  }

  async handleMemoryOp(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { action, fact, query } = JSON.parse(body);

        if (action === 'remember' && fact) {
          const id = await memoryManager.saveFact('default', fact);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, id }));
        } else if (action === 'recall' && query) {
          const results = await memoryManager.queryFacts('default', query);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ results }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid action' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  /**
   * 配置 Provider（新 API）
   */
  async handleProviderConnect(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { providerId, apiKey, baseUrl } = JSON.parse(body);

        if (!providerId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'providerId required' }));
          return;
        }

        const result = await providerRegistry.configure(providerId, { apiKey, baseUrl });

        if (result.success) {
          const models = providerRegistry.getModels(providerId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            providerId,
            modelCount: models.length,
            models: models.slice(0, 20)  // 返回前 20 个模型
          }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.error }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  /**
   * 获取 Provider 模型列表
   */
  async handleProviderModels(req, res) {
    const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
    const providerId = url.searchParams.get('providerId');

    if (!providerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'providerId required' }));
      return;
    }

    try {
      // 尝试刷新模型列表
      const models = await providerRegistry.refreshModels(providerId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ providerId, models, count: models.length }));
    } catch (e) {
      // 返回缓存的模型
      const models = providerRegistry.getModels(providerId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ providerId, models, count: models.length, cached: true }));
    }
  }
  
  /**
   * 获取系统状态
   */
  getSystemStatus() {
    if (this.stabilitySystem) {
      return this.stabilitySystem.getSystemStatus();
    }
    return {
      status: 'running',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      components: ['basic']
    };
  }

  /**
   * 获取 Agent 列表和监控摘要
   */
  async handleAgentsList(req, res) {
    const summary = agentMonitor.getSummary();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  }

  /**
   * 获取 Agent 执行历史
   */
  async handleAgentsHistory(req, res) {
    const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
    const limit = parseInt(url.searchParams.get('limit')) || 20;

    const history = agentMonitor.getExecutionHistory(limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ history }));
  }

  /**
   * 获取单个 Agent 状态
   */
  async handleAgentStatus(req, res, agentId) {
    const agent = agentMonitor.getAgent(agentId);

    if (!agent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agent));
  }

  /**
   * 执行 Agent 操作 (暂停/恢复/提供输入)
   */
  async handleAgentAction(req, res, agentId) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { action, input } = JSON.parse(body);

        switch (action) {
          case 'pause':
            agentMonitor.pauseAgent(agentId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, agentId, action: 'paused' }));
            break;

          case 'resume':
            agentMonitor.resumeAgent(agentId);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, agentId, action: 'resumed' }));
            break;

          case 'input':
            agentMonitor.provideHumanInput(agentId, input);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, agentId, action: 'input_provided' }));
            break;

          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown action. Use: pause, resume, input' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  async autoConfigProviders(detectedTools) {
    for (const tool of detectedTools) {
      try {
        const { createLocalProvider } = await import('./providers/local-provider.js');
        const provider = createLocalProvider(tool.name, {
          mode: 'command',
          command: tool.command,
          args: []
        });
        await provider.connect({ mode: 'command', command: tool.command, args: [] });
        sessionManager.addProviderDirect(provider);
      } catch (e) {
        // Auto-configuration failed, skip silently
      }
    }
  }

  async handleWSMessage(ws, msg) {
    const { type, data, sessionId } = msg;

    // 确保 RAG 已初始化
    if (!memoryManager.initialized) {
      try {
        await memoryManager.initialize();
      } catch (e) {
        // 忽略初始化错误，继续处理
      }
    }

    // 处理记忆/RAG 相关消息
    if (type === 'memory_save' || type === MessageType.MEMORY_SAVE) {
      try {
        const { fact, userId = 'default' } = data;
        const id = await memoryManager.saveFact(userId, fact);
        ws.send(JSON.stringify({
          type: 'memory_save',
          data: { success: true, id, fact }
        }));
        return;
      } catch (e) {
        ws.send(JSON.stringify({ type: MessageType.ERROR, data: { message: e.message } }));
        return;
      }
    }

    if (type === 'memory_query' || type === MessageType.MEMORY_QUERY) {
      try {
        const { query, userId = 'default', topK = 5 } = data;
        const results = await memoryManager.queryFacts(userId, query, { topK });
        ws.send(JSON.stringify({
          type: 'memory_query',
          data: { results }
        }));
        return;
      } catch (e) {
        ws.send(JSON.stringify({ type: MessageType.ERROR, data: { message: e.message } }));
        return;
      }
    }

    if (type === 'memory_stats' || type === MessageType.MEMORY_STATS) {
      try {
        const stats = await memoryManager.getStats();
        ws.send(JSON.stringify({
          type: 'memory_stats',
          data: stats
        }));
        return;
      } catch (e) {
        ws.send(JSON.stringify({ type: MessageType.ERROR, data: { message: e.message } }));
        return;
      }
    }

    // 处理状态查询
    if (type === 'bridge_status' || type === MessageType.BRIDGE_STATUS) {
      const provider = persistentConfig.getPreference('currentProvider');
      const model = persistentConfig.getPreference('currentModel');
      const memStats = await memoryManager.getStats();

      ws.send(JSON.stringify({
        type: 'bridge_status',
        data: {
          status: 'running',
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          currentProvider: provider,
          currentModel: model,
          wsClients: this.clients.size,
          memory: memStats
        }
      }));
      return;
    }

    // 其他消息通过 Router 处理
    const gatewayId = `ws-${sessionId || crypto.randomUUID()}`;
    const wsGateway = new WSGateway(gatewayId, router, ws);
    router.registerGateway(gatewayId, wsGateway);

    try {
      const result = await router.dispatch(gatewayId, { type, data, sessionId });
    } catch (e) {
      ws.send(JSON.stringify({ type: MessageType.ERROR, data: { message: e.message }, sessionId }));
    }
  }

  getCompletions(line) {
    const trimmed = line.trim();
    if (!trimmed) return [];

    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    const matches = [];

    if (parts.length === 1) {
      if ('session'.startsWith(last)) matches.push('session');
      if ('provider'.startsWith(last)) matches.push('provider');
      if ('help'.startsWith(last)) matches.push('help');
      if ('status'.startsWith(last)) matches.push('status');
      if ('clear'.startsWith(last)) matches.push('clear');
      if ('exit'.startsWith(last)) matches.push('exit');
      if ('quit'.startsWith(last)) matches.push('quit');
      if ('chat'.startsWith(last)) matches.push('chat');
      return matches;
    }

    if (parts.length === 2 && parts[0] === 'session') {
      if ('create'.startsWith(last)) matches.push('create');
      if ('close'.startsWith(last)) matches.push('close');
      if ('list'.startsWith(last)) matches.push('list');
      if ('history'.startsWith(last)) matches.push('history');
      return matches;
    }

    if (parts.length === 2 && parts[0] === 'provider') {
      if ('add'.startsWith(last)) matches.push('add');
      if ('remove'.startsWith(last)) matches.push('remove');
      if ('list'.startsWith(last)) matches.push('list');
      return matches;
    }

    if (parts.length === 3 && parts[0] === 'session' && parts[1] === 'create') {
      if ('claude'.startsWith(last)) matches.push('claude');
      if ('opencode'.startsWith(last)) matches.push('opencode');
      return matches;
    }

    return matches;
  }

  startCLI() {
    this.history = this.loadHistory();
    this.executing = false;

    // Print welcome once
    const pname = this.getPrompt();
    console.log('');
    console.log('  OPENCHAT BRIDGE v2.0');
    if (pname) console.log(`  [${pname}]`);
    console.log('  输入 ? 查看帮助，或直接开始聊天\n');

    // 使用 readline 模块处理交互输入
    // crlfDelay 确保 Windows 换行符正确处理
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      crlfDelay: Infinity,
      prompt: this.getPromptString()
    });

    this.rl.on('line', async (line) => {
      const cmd = line.trim();

      if (cmd) {
        this.history.unshift(cmd);
        if (this.history.length > 100) this.history.pop();
        this.saveHistory();
        this.executing = true;
        try {
          await executeCommand(cmd);
        } finally {
          this.executing = false;
        }
      }

      // 更新提示符（可能在执行命令后改变了 provider）
      this.rl.setPrompt(this.getPromptString());
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log('\n[CLI] 再见!');
      process.exit(0);
    });

    // Ctrl+C 退出 - Windows 兼容
    this.rl.on('SIGINT', () => {
      this.rl.close();
    });

    // 初始提示
    this.rl.prompt();
  }

  loadHistory() {
    try {
      const historyPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'history.json');
      if (fs.existsSync(historyPath)) {
        const data = fs.readFileSync(historyPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('[历史] 加载失败:', e);
    }
    return [];
  }

  saveHistory() {
    try {
      const historyPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'history.json');
      fs.writeFileSync(historyPath, JSON.stringify(this.history), 'utf8');
    } catch (e) {
      console.error('[历史] 保存失败:', e);
    }
  }

  _startLearningCore() {
    if (!this.learningCore) return;

    let cycle = 0;
    const runCycle = async () => {
      cycle++;
      try {
        const result = await this.learningCore.runCycle();
        if (result.status === 'solved') {
          console.log(`[学习核心] 第${cycle}轮: 解决 ${result.problem} → IQ: ${result.iq}`);
        } else if (cycle % 10 === 0) {
          console.log(`[学习核心] 第${cycle}轮: ${result.status} | IQ: ${result.iq} 年龄: ${result.age}`);
        }
      } catch (e) {
        console.log(`[学习核心] 第${cycle}轮异常: ${e.message}`);
      }
    };

    runCycle();
    this._learningTimer = setInterval(runCycle, 60000);
  }

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