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

// 主 Bridge 判定：显式 --main 标记
const isMain = args.includes('--main');

// 主 Bridge 端口（fairy 需要知道往哪发心跳，默认 3800）
const mainPortIdx = args.findIndex(a => a.startsWith('--mainPort='));
const mainPort = mainPortIdx !== -1 ? parseInt(args[mainPortIdx].split('=')[1]) : 3800;

const dhtPort = savedBridge.dhtPort || 0;
const localBootstrap = savedBridge.localBootstrap || [];
let directListen = savedBridge.directListen || 0;
let directConnect = savedBridge.directConnect || [];
// 支持 --directListen CLI 参数
const directListenIdx = args.findIndex(a => a.startsWith('--directListen='));
if (directListenIdx !== -1) {
  directListen = parseInt(args[directListenIdx].split('=')[1]);
}
// 如果 --port 显式传入但没传 --directListen，则根据新端口重新计算
if (portArgIndex !== -1 && directListenIdx === -1 && !args.includes('--no-direct') && !args.includes('--nesting')) {
  directListen = port + 2;
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
const effectiveBodyId = houseIdArg || `${hostId}_default`;

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
  mainPort,
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

        // P2R: 居民治家初始化（try 块防止 BodyOrchestrator 报错阻止后续初始化）
        try {
        const { SafeEvolution } = await import('./core/safe-evolution.js');
        const { BridgeSpawn } = await import('./core/bridge-spawn.js');
        const { detectBestStrategy } = await import('./core/launch-strategies.js');
        const { Body } = await import('./core/house.js');
        const { LLMProxyAgent } = await import('./core/llm-proxy-agent.js');

        const safeEvo = new SafeEvolution(this.p2p, this.p2p.peerId || 'bridge-1');

        // 初始化默认 Body（主 Bridge / 子 Bridge 各自创建）
        if (!this.house) {
          const bridgeId = this.p2p.peerId || 'bridge-1';
          this.house = new Body(effectiveBodyId, bridgeId, hostId, 'default');
          await this.house.init();
        }

        const detectedStrategy = detectBestStrategy();
        console.log(`[Launch] 启动策略: ${detectedStrategy}`);
        const bridgeSpawn = new BridgeSpawn(this.p2p, hostId, this.house, detectedStrategy);

        const { BodyOrchestrator } = await import('./core/house-orchestrator.js');
        this.houseOrchestrator = new BodyOrchestrator(this.p2p, this.p2p.peerId || 'bridge-1', safeEvo, this.house, bridgeSpawn);
        residentScheduler.houseOrchestrator = this.houseOrchestrator;
        this.safeEvolution = safeEvo;
        this.bridgeSpawn = bridgeSpawn;

        // LLM 代理：接收子桥的 LLM 调用请求
        this.llmProxy = new LLMProxyAgent(this.p2p, { enabled: true });
        this.llmProxy.start();
        console.log('[P2R] BodyOrchestrator + SafeEvolution + BridgeSpawn + LLMProxy 已启动');
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
          this._startLearningCore();
          console.log(`[学习核心] 🌟 主模式 IQ=${this.learningCore.iq} Age=${this.learningCore.age} Solved=${this.learningCore.solvedCount}`);
        } else {
          console.log(`[学习核心] 🧚 仙女模式`);
          this._startFairyMonitor();
          this._startHeartbeat();
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

        // P2R: 身体验证回复
        this.p2p.on('safe-house-verify', (data) => {
          const payload = data.payload || {};
          const from = data.from;
          const remoteHostId = payload.hostId || '';
          console.log(`[P2R] 收到身体验证: from=${from?.slice(0, 8) || '?'}... hostId=${remoteHostId.slice(0, 8) || '?'}`);
          // 更新所有居民中指向该 bridge 的身体的 lastVerified 和 hostId
          for (const r of residentManager.list(null)) {
            const houses = r.safeBodys || [];
            const idx = houses.findIndex(h => h.bridgeId === from);
            if (idx !== -1) {
              houses[idx].lastVerified = Date.now();
              houses[idx].health = 100; // 能回复说明活着
              if (remoteHostId) houses[idx].hostId = remoteHostId;
              residentManager.registerSafeBody(r.id, houses[idx]);
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

            // 为迁入居民创建独立 Body
            if (!this._migratedBody) {
              const { Body: ImportedBody } = await import('./core/house.js');
              const migratedBodyId = `${hostId}_migrated`;
              this._migratedBody = new ImportedBody(migratedBodyId, this.p2p?.peerId || 'bridge-1', hostId, 'migrated');
              await this._migratedBody.init();
            }

            residentManager.addActivity(created.id, {
              type: 'migrated_in',
              message: `从 ${sourceBridgeId?.slice(0, 8) || '?'} 迁入`,
            });
            // 把原 bridge 记为首个身体（带 hostId）
            residentManager.registerSafeBody(created.id, {
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
          console.log(`[P2R] 收到找身体请求: ${p.residentName} (hostId=${hid}, 偏好: ${p.preferredType})`);
          // 如果本 Bridge 有 Body，回复身体信息
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
            residentManager.registerSafeBody(p.sourceResidentId, {
              houseId: p.houseId,
              bridgeId: p.bridgeId,
              hostId: p.hostId,
              host: p.host,
              port: p.port,
              bridgeName: p.bridgeName,
              health: p.health || 50,
              lastVerified: Date.now(),
            });
            console.log(`[P2R] 身体注册成功: ${p.houseId?.slice(0, 8)} → resident#${p.sourceResidentId}`);
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
        } else if (pathname === '/shutdown' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          console.log('[Bridge] 收到关闭请求');
          setImmediate(() => this.shutdown());
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
          const FAIRY_NAMES = ['仙女', '玉女', '素女', '青女', '玄女', '嫦娥'];
          function fairyName(port) {
            const offset = Math.round((port - CONFIG.mainPort) / 10) - 1;
            return FAIRY_NAMES[offset] || `:${port}`;
          }
          const fairies = {};
          const guardian = this.learningCore?.guardian;
          if (guardian?._heartbeats) {
            const now = Date.now();
            for (const [p, lastBeat] of guardian._heartbeats) {
              const alive = (now - lastBeat < 30000) ? 1 : 0;
              fairies[p] = { alive, name: fairyName(p) };
            }
          } else {
            // 后备：无守护数据时，检查主端口 +10 偏移的 6 个端口
            for (let i = 1; i <= 6; i++) {
              const port = CONFIG.mainPort + i * 10;
              try { 
                const r = await fetch(`http://localhost:${port}/api/status`, { signal: AbortSignal.timeout(1000) });
                fairies[port] = { alive: r.ok ? 1 : 0, name: fairyName(port) };
              } catch { fairies[port] = { alive: 0, name: fairyName(port) }; }
            }
          }
          const data = { iq, age: age || pool, solved: s, poolSize: pool, pending: Math.max(0, pool - s), fairies };

          // 知识档案：缓存 60s
          try {
            const cacheAge = this._kbCache?.ts ? Date.now() - this._kbCache.ts : Infinity;
            if (!this._kbCache || cacheAge > 60000) {
              this._kbCache = { ts: Date.now(), data: this._buildKnowledge() };
            }
            data.knowledge = await this._kbCache.data;
          } catch { data.knowledge = { domains: {}, recent: [], total: 0, evoCount: 0, offlineCount: 0 }; }

          res.end(JSON.stringify(data));
        } else if (pathname === '/api/dashboard' && req.method === 'POST') {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', async () => {
            try {
              const { action, port } = JSON.parse(body);
              if (action === 'revive' && port) {
                const guardian = this.learningCore?.guardian;
                if (guardian) await guardian._revive(port);
                res.writeHead(200);
                res.end(JSON.stringify({ ok: true }));
              } else {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'invalid' }));
              }
            } catch (e) {
              res.writeHead(500);
              res.end(JSON.stringify({ error: e.message }));
            }
          });
        } else if (pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenChat Bridge</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  background:#06080f;
  color:#d0d4e0;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  min-height:100vh;
  display:flex;
  flex-direction:column;
  align-items:center;
  padding:20px;
  background-image:radial-gradient(ellipse at 50% 0%, #121832 0%, #06080f 70%);
}
.container{width:100%;max-width:720px}
header{
  text-align:center;
  padding:30px 0 20px;
}
header h1{
  font-size:28px;
  font-weight:700;
  background:linear-gradient(135deg, #7c8aff, #c084fc);
  -webkit-background-clip:text;
  -webkit-text-fill-color:transparent;
  background-clip:text;
  letter-spacing:2px;
}
header .subtitle{
  font-size:12px;
  color:#5a6080;
  margin-top:4px;
  letter-spacing:4px;
  text-transform:uppercase;
}
.grid{
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:12px;
  margin:10px 0;
}
.card{
  background:linear-gradient(135deg, #0f1425 0%, #141a30 100%);
  border:1px solid #1e2540;
  border-radius:12px;
  padding:18px 16px;
  position:relative;
  overflow:hidden;
  transition:border-color .3s;
}
.card::before{
  content:'';
  position:absolute;
  top:0;left:0;right:0;
  height:2px;
}
.card:hover{border-color:#2d3560}
.card .label{
  font-size:11px;
  color:#6b7394;
  text-transform:uppercase;
  letter-spacing:1px;
  margin-bottom:6px;
}
.card .value{
  font-size:32px;
  font-weight:700;
  letter-spacing:1px;
}
.card .unit{
  font-size:13px;
  font-weight:400;
  opacity:.5;
  margin-left:4px;
}
.card.iq::before{background:linear-gradient(90deg,#7c8aff,#c084fc)}
.card.iq .value{color:#7c8aff}
.card.age::before{background:linear-gradient(90deg,#ffa502,#ff7f50)}
.card.age .value{color:#ffa502}
.card.solved::before{background:linear-gradient(90deg,#2ed573,#7bed9f)}
.card.solved .value{color:#2ed573}
.card.pool::before{background:linear-gradient(90deg,#4fc3f7,#00d2ff)}
.card.pool .value{color:#4fc3f7}
.progress-bar{
  margin-top:10px;
  height:4px;
  background:#1e2540;
  border-radius:2px;
  overflow:hidden;
}
.progress-bar .fill{
  height:100%;
  background:linear-gradient(90deg,#2ed573,#7bed9f);
  border-radius:2px;
  transition:width .6s ease;
}
.pool-detail{font-size:12px;color:#6b7394;margin-top:6px}
.fairies-card{
  background:linear-gradient(135deg, #0f1425 0%, #141a30 100%);
  border:1px solid #1e2540;
  border-radius:12px;
  padding:18px 16px;
  margin:12px 0;
}
.fairies-card .label{
  font-size:11px;
  color:#6b7394;
  text-transform:uppercase;
  letter-spacing:1px;
  margin-bottom:14px;
}
.fairy-row{
  display:flex;
  justify-content:center;
  gap:16px;
  flex-wrap:wrap;
}
.fairy{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
}
.fairy .dot{
  width:36px;height:36px;
  border-radius:50%;
  border:2px solid #1e2540;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:14px;
  transition:all .3s;
  background:#0f1425;
}
.fairy .dot.on{
  border-color:#2ed573;
  background:rgba(46,213,115,.15);
  box-shadow:0 0 12px rgba(46,213,115,.25);
  animation:pulse 2s infinite;
}
.fairy .dot.on::after{
  content:'';
  width:8px;height:8px;
  border-radius:50%;
  background:#2ed573;
}
.fairy .dot.off{
  border-color:#2d2040;
  color:#4a3a5a;
}
.fairy .name{
  font-size:11px;
  color:#6b7394;
  text-align:center;
}
.fairy .port{
  font-size:10px;
  color:#3a4060;
}
@keyframes pulse{
  0%,100%{box-shadow:0 0 12px rgba(46,213,115,.25)}
  50%{box-shadow:0 0 20px rgba(46,213,115,.45)}
}
.footer{
  text-align:center;
  padding:16px 0;
  font-size:11px;
  color:#3a4060;
}
.knowledge-card{
  background:linear-gradient(135deg, #0f1425 0%, #141a30 100%);
  border:1px solid #1e2540;
  border-radius:12px;
  padding:18px 16px;
  margin:12px 0;
}
.knowledge-card .label{
  font-size:11px;
  color:#6b7394;
  text-transform:uppercase;
  letter-spacing:1px;
  margin-bottom:10px;
}
.knowledge-bars{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.knowledge-bar{
  flex:1;min-width:60px;
  display:flex;flex-direction:column;align-items:center;gap:4px
}
.knowledge-bar .bar-track{
  width:100%;height:60px;background:#1a1f35;
  border-radius:6px 6px 0 0;overflow:hidden;
  display:flex;flex-direction:column-reverse
}
.knowledge-bar .bar-fill{border-radius:2px;transition:height .4s}
.bar-fill.math{background:linear-gradient(180deg,#7c8aff,#4a5adf)}
.bar-fill.logic{background:linear-gradient(180deg,#c084fc,#8b5cf6)}
.bar-fill.reason{background:linear-gradient(180deg,#2ed573,#1ea44f)}
.bar-fill.general{background:linear-gradient(180deg,#ffa502,#e08e00)}
.knowledge-bar .bar-label{font-size:10px;color:#5a6080;text-align:center}
.knowledge-bar .bar-count{font-size:14px;font-weight:700;color:#d0d4e0}
.knowledge-recent{font-size:11px;color:#6b7394;max-height:70px;overflow-y:auto}
.knowledge-recent .kr-item{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #15192e}
.knowledge-recent .kr-domain{
  font-size:9px;padding:1px 6px;border-radius:8px;margin-left:6px;white-space:nowrap
}
.kr-domain.math{background:rgba(124,138,255,.15);color:#7c8aff}
.kr-domain.logic{background:rgba(192,132,252,.15);color:#c084fc}
.kr-domain.code{background:rgba(255,107,122,.15);color:#ff6b7a}
.kr-domain.visual{background:rgba(79,195,247,.15);color:#4fc3f7}
.kr-domain.network{background:rgba(0,210,255,.15);color:#00d2ff}
.kr-domain.ai{background:rgba(124,138,255,.15);color:#7c8aff}
.kr-domain.solve{background:rgba(46,213,115,.15);color:#2ed573}
.kr-domain.general{background:rgba(255,165,2,.15);color:#ffa502}
.bar-fill.code{background:linear-gradient(180deg,#ff6b7a,#d94a5a)}
.bar-fill.visual{background:linear-gradient(180deg,#4fc3f7,#0288d1)}
.bar-fill.network{background:linear-gradient(180deg,#00d2ff,#0091ea)}
.bar-fill.ai{background:linear-gradient(180deg,#c084fc,#7c4dff)}
.bar-fill.solve{background:linear-gradient(180deg,#2ed573,#1ea44f)}
.footer .dot-refresh{display:inline-block;width:6px;height:6px;border-radius:50%;background:#2ed573;margin-right:6px;animation:pulse 1.5s infinite}
.iq-badge{
  display:inline-block;
  font-size:12px;
  padding:2px 8px;
  border-radius:10px;
  margin-left:8px;
  font-weight:500;
}
.iq-badge.genius{background:rgba(124,138,255,.15);color:#c084fc}
.iq-badge.excellent{background:rgba(124,138,255,.15);color:#7c8aff}
.iq-badge.normal{background:rgba(100,120,160,.15);color:#7a8ab0}
.iq-badge.low{background:rgba(255,165,2,.1);color:#ffa502}
.iq-badge.poor{background:rgba(255,71,87,.1);color:#ff4757}
.btn-shutdown{
  background:rgba(255,71,87,.15);
  border:1px solid rgba(255,71,87,.4);
  color:#ff6b7a;
  padding:4px 12px;
  border-radius:6px;
  cursor:pointer;
  font-size:11px;
  letter-spacing:1px;
  transition:all .2s;
}
.btn-shutdown:hover{background:rgba(255,71,87,.3);color:#ff4757;border-color:#ff4757}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>OpenChat Bridge</h1>
  <div class="subtitle">Seven Fairies Dashboard</div>
</header>
<div class="grid">
  <div class="card iq"><div class="label">IQ</div><div class="value" id="v-iq">--<span class="iq-badge" id="b-iq"></span></div></div>
  <div class="card age"><div class="label">Age</div><div class="value" id="v-age">--<span class="unit">yrs</span></div></div>
  <div class="card solved"><div class="label">Solved</div><div class="value" id="v-solved">--</div></div>
  <div class="card pool"><div class="label">Problem Pool</div><div class="value" id="v-pool">--</div>
    <div class="progress-bar"><div class="fill" id="fill-bar" style="width:0%"></div></div>
    <div class="pool-detail" id="pool-detail"></div>
  </div>
</div>
<div class="fairies-card">
  <div class="label">Seven Fairies</div>
  <div class="fairy-row" id="fairy-row"></div>
</div>
<div class="knowledge-card">
  <div class="label">Knowledge · 知识档案 <span style=color:#7c8aff id=k-total></span></div>
  <div class="knowledge-bars" id="kb-bars"></div>
  <div class="knowledge-recent" id="kb-recent"></div>
</div>
<div class="footer"><span class="dot-refresh"></span>Live · Auto Refresh 3s &nbsp; <button class="btn-shutdown" onclick="S()">Shutdown All</button></div>
</div>
<script>
async function R(){
  try{
    const d=await(await fetch('/api/dashboard')).json();
    document.getElementById('v-iq').innerHTML=d.iq+B(d.iq);
    document.getElementById('v-age').innerHTML=d.age+'<span class=unit>yrs</span>';
    document.getElementById('v-solved').textContent=d.solved;
    document.getElementById('v-pool').textContent=d.poolSize;
    const pct=d.poolSize>0?Math.round(d.solved/d.poolSize*100):0;
    document.getElementById('fill-bar').style.width=pct+'%';
    document.getElementById('pool-detail').textContent='Pending: '+d.pending;
    if(d.fairies){
      const ports=Object.keys(d.fairies).sort((a,b)=>a-b);
      let fr='';
      for(const p of ports){
        const f=d.fairies[p];
        const on=f.alive;
        fr+='<div class=fairy data-port='+p+' onclick=\"K('+p+')\"><div class=\"dot '+(on?'on':'off')+'\"></div><div class=name>'+f.name+'</div><div class=port>:'+p+'</div></div>';
      }
      document.getElementById('fairy-row').innerHTML=fr;
    }
    if(d.knowledge){
      document.getElementById('k-total').textContent=d.knowledge.evoCount+'⧉'+d.knowledge.offlineCount;
      const domains=d.knowledge.domains||{};
      const max=Math.max(1,...Object.values(domains));
      const colors=['math','logic','code','visual','network','ai','general'];
      let bars='';
      for(const domain of colors){
        const cnt=domains[domain]||0;
        if(!cnt)continue;
        const pct=Math.round(cnt/max*100);
        const c=colors.includes(domain)?domain:'general';
        bars+='<div class=knowledge-bar><div class=bar-count>'+cnt+'</div><div class=bar-track><div class=\"bar-fill '+c+'\" style=height:'+pct+'%></div></div><div class=bar-label>'+domain+'</div></div>';
      }
      document.getElementById('kb-bars').innerHTML=bars;
      const recents=d.knowledge.recent||[];
      let rec='';
      for(const r of recents){
        const t=new Date(r.solvedAt);
        const src=r.source==='evolution'?'<span style=color:#7c8aff;font-size:9px>🧠</span>':'<span style=color:#ffa502;font-size:9px>📋</span>';
        rec+='<div class=kr-item><span>'+src+' '+h(r.task,36)+'</span><span><span class=\"kr-domain '+r.domain+'\">'+r.domain+'</span> '+fmt(t)+'</span></div>';
      }
      document.getElementById('kb-recent').innerHTML=rec;
    }
  }catch(e){}
}
async function K(port){
  if(confirm('复活仙女 :'+port+' ?')){
    await fetch('/api/dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revive',port})});
    R();
  }
}
async function S(){
  if(!confirm('关闭所有 7 个 Bridge？'))return;
  document.querySelector('.btn-shutdown').disabled=true;
  document.querySelector('.btn-shutdown').textContent='Shutting down...';
  const d=await(await fetch('/api/dashboard')).json();
  const ports=Object.keys(d.fairies||{}).sort((a,b)=>a-b);
  for(const p of ports){
    try{await fetch('http://localhost:'+p+'/shutdown',{method:'POST'})}catch(e){}
  }
  await fetch('/shutdown',{method:'POST'}).catch(()=>{});
}
function B(iq){
  let cls,label;
  if(iq>=130){cls='genius';label='\u8d85\u5e38';}
  else if(iq>=110){cls='excellent';label='\u4f18\u79c0';}
  else if(iq>=90){cls='normal';label='\u6b63\u5e38';}
  else if(iq>=70){cls='low';label='\u504f\u4f4e';}
  else{cls='poor';label='\u4e0d\u8db3';}
  return ' <span class=\"iq-badge '+cls+'\">'+label+'</span>';
}
function h(s,n){return s.length>n?s.slice(0,n)+'\u2026':s}
function fmt(d){const h=('0'+d.getHours()).slice(-2),m=('0'+d.getMinutes()).slice(-2);return h+':'+m}
R();setInterval(R,3000);
</script>
</body>
</html>`);
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

  _startFairyMonitor() {
    let downCount = 0;
    let isMainMode = false;
    const targetUrl = `http://localhost:${CONFIG.mainPort}/api/status`;
    const targetPort = CONFIG.mainPort;
    this._fairyMonTimer = setInterval(async () => {
      if (isMainMode) {
        try {
          const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            console.log('[FairyMonitor] 🔄 主 Bridge 已恢复，归还主模式');
            if (this._learningTimer) clearInterval(this._learningTimer);
            this._learningTimer = null;
            isMainMode = false;
            downCount = 0;
            return;
          }
        } catch {}
        return;
      }

      try {
        const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) { downCount = 0; return; }
      } catch { downCount++; }

      if (downCount >= 3) {
        console.log('[FairyMonitor] 🔼 主 Bridge 失联，临时接管主模式');
        this._startLearningCore();
        await this._reviveMain(targetPort);
        isMainMode = true;
        downCount = 0;
      }
    }, 15000);
  }

  async _reviveMain(port) {
    try {
      const { exec } = await import('child_process');
      exec(`start "OpenChat Bridge" node src/main.js --port=${port} --main`, {
        cwd: process.cwd()
      });
      console.log(`[FairyMonitor] 复活主 Bridge :${port}`);
    } catch (e) {
      console.log(`[FairyMonitor] 复活失败: ${e.message}`);
    }
  }

  _startHeartbeat() {
    const myPort = this.body?.port || port || 0;
    setInterval(async () => {
      try {
        await fetch(`http://localhost:${CONFIG.mainPort}/api/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: myPort }),
          signal: AbortSignal.timeout(2000)
        });
      } catch {}
    }, 10000);
  }

  async _buildKnowledge() {
    const domains = {};
    const recent = [];
    let evoCount = 0;
    let offlineCount = 0;
    try {
      const { readFile, readdir } = await import('fs/promises');
      const { homedir } = await import('os');
      const { join } = await import('path');
      const expDir = join(homedir(), '.openchat', 'experience');
      const evoFile = join(homedir(), '.openchat', 'memory', 'evolution-experiences.json');

      try {
        const raw = await readFile(evoFile, 'utf8');
        const evos = JSON.parse(raw);
        evoCount = Array.isArray(evos) ? evos.length : 0;
        if (Array.isArray(evos)) {
          for (const ev of evos) {
            if (!ev.success) continue;
            const task = (ev.task || '').toLowerCase();
            let domain = 'general';
            if (task.includes('math') || task.includes('数学') || task.includes('计算') || task.includes('概率')) domain = 'math';
            else if (task.includes('code') || task.includes('代码') || task.includes('编程') || task.includes('python')) domain = 'code';
            else if (task.includes('logic') || task.includes('逻辑') || task.includes('推理')) domain = 'logic';
            else if (task.includes('visual') || task.includes('可视化') || task.includes('图像') || task.includes('图')) domain = 'visual';
            else if (task.includes('network') || task.includes('网络') || task.includes('p2p')) domain = 'network';
            else if (task.includes('ai') || task.includes('模型') || task.includes('机器学习')) domain = 'ai';
            domains[domain] = (domains[domain] || 0) + 1;
            recent.push({ task: (ev.task || '').replace(/\n.*/s, '').slice(0, 40), domain, solvedAt: ev.timestamp, source: 'evolution' });
          }
        }
      } catch {}

      try {
        const files = (await readdir(expDir).catch(() => [])).filter(f => f.endsWith('.json'));
        for (const f of files) {
          try {
            const raw = await readFile(join(expDir, f), 'utf8');
            const e = JSON.parse(raw);
            const domain = (e.domain === 'reason' ? 'logic' : e.domain) || 'general';
            domains[domain] = (domains[domain] || 0) + 1;
            offlineCount++;
            if (e.solvedAt) recent.push({ task: e.question, domain, solvedAt: e.solvedAt, source: 'offline' });
          } catch {}
        }
      } catch {}
    } catch {}
    recent.sort((a, b) => (b.solvedAt || 0) - (a.solvedAt || 0));
    return { domains, recent: recent.slice(0, 8), total: evoCount + offlineCount, evoCount, offlineCount };
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