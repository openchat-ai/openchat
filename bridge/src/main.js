import 'dotenv/config';
import * as readline from 'readline';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import logger from './core/monitoring/logger.js';
import { DEFAULT_PORT, getMainPort } from './constants.js';
// Init stage tracker for health dependency graph
class InitTracker {
  constructor() {
    this._stages = {};
    this._order = [];
  }
  start(stage) { this._stages[stage] = { status: 'running', startedAt: Date.now() }; this._order.push(stage); }
  ok(stage) { if (this._stages[stage]) this._stages[stage].status = 'ok'; }
  fail(stage, err) { if (this._stages[stage]) { this._stages[stage].status = 'failed'; this._stages[stage].error = err.message; } }
  report() { const e = Date.now(); return this._order.map(s => ({ stage: s, ...this._stages[s], elapsed: e - this._stages[s].startedAt })); }
}
const initTracker = new InitTracker();

import { sessionManager } from './core/session-manager.js';

// 新增：REST API 服务器（31 个端点）
// 使用动态 import 加载 CommonJS 模块
let apiServer = null;
import { executeCommand, commands } from './cli/commands.js';
import { MessageBuilder, MessageType } from './core/protocol-message.js';
import { router } from './core/router.js';
import { initCore } from './core/handlers.js';
import { CLIGateway, WSGateway } from './gateway/base.js';
import { persistentConfig } from './core/persistent-config.js';
import { providerManager } from './providers/provider-manager.js';
import { providerRegistry } from './providers/provider-registry.js';
import { memoryManager } from './memory/memory-manager.js';
import { agentMonitor } from './core/agent/agent-monitor.js';
import { AIPerson, aiPersonRegistry, createFounder } from './core/agent/ai-personhood.js';
import { Deity, deitySystemManager, DEITY_TYPE } from './core/agent/deity-system.js';
import { MirrorDeity, mirrorDeity, initializeMirrorDeitySystem } from './core/agent/mirror-deity.js';
import { EnergyDeity, energyDeity, initializeEnergySystem, ENERGY_TYPE, POWER_MODE } from './core/agent/energy-deity.js';
import { aiPersonFactory, AI_TEMPLATES } from './core/agent/ai-person-factory.js';
import { deityGovernance } from './core/agent/deity-governance.js';
import { identityGenerator } from './core/agent/identity-generator.js';
import { aiPersonManager } from './core/agent/ai-person-manager.js';
import { getEnhancedStabilitySystem } from './core/monitoring/enhanced-stability-system.js';
import { CollaborationEngine } from './core/collaboration/collaboration-engine.js';
import { residentManager } from './core/agent/resident-manager.js';
import { residentScheduler } from './core/agent/resident-scheduler.js';
import { LearningCore } from './core/evolution/learning-core.js';
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
const port = cliPort || savedBridge.port || DEFAULT_PORT;
const isMain = port === DEFAULT_PORT || process.argv.includes('--main');

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
  logger.info(`[Config] 已保存到 ${path.join(os.homedir(), '.openchat', 'config.json')}`);
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
    this.apiServer = null;  // 统一 REST API 服务器
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
    logger.info('');
    logger.info('╔═══════════════════════════════════════════════════════════╗');
    logger.info('║                                                          ║');
    logger.info('║                   OPENCHAT BRIDGE                        ║');
    logger.info(`║                   [${mode} MODE]                          ║`);
    logger.info('║                                                          ║');
    logger.info('╚═══════════════════════════════════════════════════════════╝');
    logger.info('');

    // Phase 1: 增强稳定性系统
    initTracker.start('stability');
    try {
      this.stabilitySystem.start();
      initTracker.ok('stability');
    } catch (e) {
      initTracker.fail('stability', e);
    }

    // Phase 2: 初始化 RAG 系统
    initTracker.start('rag');
    try {
      await memoryManager.initialize();
      initTracker.ok('rag');
    } catch (e) {
      initTracker.fail('rag', e);
    }

    // Phase 3: 初始化 AI 人系统
    initTracker.start('ai-personhood');
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
      initTracker.ok('ai-personhood');
    } catch (e) {
      initTracker.fail('ai-personhood', e);
    }

    await this.autoConfigProviders(detectedTools);

    initCore();

    // Sandbox mode: skip P2P, use mock LLM, show CLI directly
    if (CONFIG.isSandbox) {
      logger.info('[Sandbox] 沙箱模式 — 内建 mock LLM，无需外部网络');
      forge.setLLMHandler(async (q) => {
        const replies = [
          '你好！我是 AI 居民小明。',
          '我在思考你刚才的问题...',
          '我觉得可以试试这个方案。',
          '好的，我记下来了。',
        ];
        return replies[Math.floor(Math.random() * replies.length)];
      });
      // Skip P2P and API server setup
      this._showDashboard(CONFIG);
      this.setupHeadlessSignalHandlers();
      return;
    }

    // Phase 4: 启动 P2P 网络（在 API 服务器之前，以便注入 swarm 实例）
    initTracker.start('p2p');
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
          logger.info('[P2P] 无公网 IP，跳过 peer registry 注册（仍作为 Hyperswarm 中继）');
        } else {
          const publishInfo = {
            host: publicIp,
            port: CONFIG.port,
            dhtPort: CONFIG.dhtPort || 0,
            publicRelay: true,
            wsSignaling: `ws://${publicIp}:${CONFIG.port}/signaling`
          };
          await registry.publishPeer(publishInfo).catch(e => {
            logger.info(`[P2P] 注册中心注册失败: ${e.message}`);
          });
          logger.info(`[P2P] 公网节点已注册到对等网络 (${publicIp})`);
          this._peerHeartbeat = setInterval(async () => {
            try { await registry.publishPeer(publishInfo); }
            catch (e) { logger.error('[Main] publish heartbeat failed:', e.message); }
          }, 60000);
        }
      }
      // 启动直连 TCP 服务器（局域网 / 本地绕过 DHT）
      if (CONFIG.directListen > 0) {
        this.p2p.listenDirect(CONFIG.directListen);
      }
      logger.info(`[P2P] Hyperswarm 网络已加入`);
      initTracker.ok('p2p');
    } catch (p2pErr) {
      initTracker.fail('p2p', p2pErr);
      logger.info(`[P2P] 启动跳过: ${p2pErr.message}`);
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
        logger.info(`[Deploy] build 跳过${detail ? ': ' + detail : ''}`);
      }
    }

    // Phase 5: 启动统一 REST API 服务器（合并了原始 HTTP 服务）
    initTracker.start('api');
    try {
      const { default: APIServer, setBridgeContext } = await import('./api/server.js');
      this.apiServer = new APIServer({ port: CONFIG.port, swarm: this.p2p, deployEnabled: deployServerEnabled });
      setBridgeContext(this);
      await this.apiServer.start();
      // 挂载 WebSocket (聊天 + 信令) 到同一个 HTTP 服务
      this.apiServer.setupWebSocket(this.apiServer.server);
      // 设置 WS 消息处理器
      this.apiServer.setWSMessageHandler((ws, msg) => {
        this.handleWSMessage(ws, msg).catch(e => {
          try { ws.send(JSON.stringify({ type: 'error', data: { message: e.message } })); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
        });
      });
      logger.info(`[API] 统一服务器: http://localhost:${CONFIG.port}`);
      logger.info(`[API] 端点: /api/v1/agents, /api/v1/p2p, /api/v1/updates, /api/v1/skills, /api/v1/versions, /api/v1/resources`);
      // 启动 AI 居民调度器
      residentScheduler.start();
      logger.info(`[调度器] 居民自主生活循环已启动`);

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
            logger.info(`[P2P] 收到 ${t}: from=${data.from?.slice(0, 8) || '?'}...`);
          });
        }

        this.p2p.on('peer-connected', (peerId) => {
          logger.info(`[P2P] Peer 已连接: ${peerId?.slice(0, 8) || peerId}...`);
        });
        this.p2p.on('peer-disconnected', (peerId) => {
          logger.info(`[P2P] Peer 已断开: ${peerId?.slice(0, 8) || peerId}...`);
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
        const { SafeEvolution } = await import('./core/security/safe-evolution.js');
        const { BridgeSpawn } = await import('./core/p2r/bridge-spawn.js');
        const { detectBestStrategy } = await import('./core/p2r/launch-strategies.js');
        const { House } = await import('./core/p2r/house.js');
        const { LLMProxyAgent } = await import('./core/p2r/llm-proxy-agent.js');

        const safeEvo = new SafeEvolution(this.p2p, this.p2p.peerId || 'bridge-1');

        // 初始化默认 House（主 Bridge / 子 Bridge 各自创建）
        if (!this.house) {
          const bridgeId = this.p2p.peerId || 'bridge-1';
          this.house = new House(effectiveHouseId, bridgeId, hostId, 'default');
          await this.house.init();
        }

        const detectedStrategy = detectBestStrategy();
        logger.info(`[Launch] 启动策略: ${detectedStrategy}`);
        const bridgeSpawn = new BridgeSpawn(this.p2p, hostId, this.house, detectedStrategy);

        // Fairy spawn：必须在 HouseOrchestrator 前（避免其报错阻止）
        if (isMain) {
          for (let i = 0; i < 6; i++) {
            const c = bridgeSpawn.spawnNesting({ name: `仙女${i+1}` });
            if (c) logger.info(`[P2R] 仙女${i+1} port=${c.port}`);
          }
        }

        const { HouseOrchestrator } = await import('./core/p2r/house-orchestrator.js');
        this.houseOrchestrator = new HouseOrchestrator(this.p2p, this.p2p.peerId || 'bridge-1', safeEvo, this.house, bridgeSpawn);
        residentScheduler.houseOrchestrator = this.houseOrchestrator;
        this.safeEvolution = safeEvo;
        this.bridgeSpawn = bridgeSpawn;

        // LLM 代理：接收子桥的 LLM 调用请求
        this.llmProxy = new LLMProxyAgent(this.p2p, { enabled: true });
        this.llmProxy.start();
        logger.info('[P2R] HouseOrchestrator + SafeEvolution + BridgeSpawn + LLMProxy 已启动');

        // Fairy spawn：端口 3002-3007
        if (isMain) {
          for (let i = 0; i < 6; i++) {
            const c = bridgeSpawn.spawnNesting({ name: `仙女${i+1}` });
            if (c) logger.info(`[P2R] 仙女${i+1} port=${c.port}`);
          }
        }
        } catch (e) { logger.info(`[启动] P2R 初始化失败: ${e.message}`); }

        // P2R-K: 收敛引擎 — 问题分解→竞标→求解→择优
        try {
          const { ProblemDecomposer } = await import('./core/convergence/problem-decomposer.js');
          const { ConvergenceEngine } = await import('./core/convergence/convergence-engine.js');
          const { SolutionEngine } = await import('./core/convergence/solution-engine.js');
          const { SolutionOptimizer } = await import('./core/convergence/solution-optimizer.js');
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

          logger.info('[P2R-K] 收敛引擎已启动 (分解+竞标+求解+优化)');
        } catch (e) {
          logger.info(`[P2R-K] 收敛引擎启动失败: ${e.message}`);
        }

        // 启动学习核心
        this.learningCore = new LearningCore(this.knowledgeBase, this.p2p, port, residentScheduler);
        if (isMain) {
          this._startLearningCore();
          logger.info(`[学习核心] 🌟 主模式 IQ=${this.learningCore.iq} Age=${this.learningCore.age} Solved=${this.learningCore.solvedCount}`);
        } else {
          logger.info(`[学习核心] 🧚 仙女模式`);
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
            } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }

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
            logger.info(`[P2R-K] 求解失败: ${e.message}`);
          }
        });

        // P2R: 窟验证回复
        this.p2p.on('safe-house-verify', (data) => {
          const payload = data.payload || {};
          const from = data.from;
          const remoteHostId = payload.hostId || '';
          logger.info(`[P2R] 收到窟验证: from=${from?.slice(0, 8) || '?'}... hostId=${remoteHostId.slice(0, 8) || '?'}`);
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
          logger.info(`[P2R] 收到居民迁移: ${incoming.length} 人 from=${data.from?.slice(0, 8) || '?'} hostId=${sourceHostId.slice(0, 8) || '?'}`);
          for (const r of incoming) {
            const existing = residentManager.list(null).find(x => x.name === r.name);
            if (existing) {
              logger.info(`[P2R] ${r.name} 已存在，跳过`);
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
            logger.info(`[P2R] 接收居民: ${r.name}`);
          }
        });

        // P2R: 广播消息（HOUSE_SEEK / HOUSE_NEED）
        this.p2p.on('HOUSE_SEEK', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          logger.info(`[P2R] 收到找窟请求: ${p.residentName} (hostId=${hid}, 偏好: ${p.preferredType})`);
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
            logger.info(`[P2R] 安全屋注册成功: ${p.houseId?.slice(0, 8)} → resident#${p.sourceResidentId}`);
          }
        });
        this.p2p.on('HOUSE_NEED', (data) => {
          const p = data.payload || {};
          const hid = p.hostId ? p.hostId.slice(0, 8) : '?';
          logger.info(`[P2R] 收到求助: ${p.residentName} (hostId=${hid}, 健康: ${p.healthScore})`);
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
          logger.info(`[P2R-S] 变更应用: ${p.file} by ${p.appliedBy?.slice(0, 8)}`);
        });
        // 分布式 Fairy Gossip
        this.p2p.on('fairy_gossip', (data) => {
          const p = data.payload || {};
          if (this.learningCore?.reasoning) {
            this.learningCore.reasoning.experienceCount = (this.learningCore.reasoning.experienceCount || 0) + 1;
            logger.info(`[Gossip] 收到 ${p.port} 解题经验: ${p.problemId}`);
          }
        });
      }
      initTracker.ok('api');
    } catch (e) {
      initTracker.fail('api', e);
      logger.info(`[启动] API/P2R 初始化失败: ${e.message}`);
    }

    // 无头模式：日志输出
    if (CONFIG.headless) {
      // WebSocket 已在统一 API 服务器中启动

      // 公网节点自动补全 WS 信令地址（若未显式指定）
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
      logger.info(`[WS]   Voice: ${sigUrl}${CONFIG.wsSignalingUrl ? '' : ' (未配置 wsSignaling, 仅本地)'}`);
      if (CONFIG.host === 'localhost') {
        logger.info('[提示] 仅监听本地连接（自动检测未发现公网 IP）');
      }
      logger.info('');
      if (initTracker) {
        const report = initTracker.report();
        const failed = report.filter(s => s.status === 'failed');
        if (failed.length > 0) {
          logger.warn({ failed: failed.map(s => s.stage + ': ' + s.error) }, `[Init] ${failed.length} phase(s) failed`);
        } else {
          logger.info(`[Init] All ${report.length} phases OK`);
        }
      }
      logger.info('[Bridge] 运行中... (Ctrl+C 停止)');
      logger.info('[提示] 使用 --cli 参数进入交互模式');

      // Headless 模式的信号处理
      this.setupHeadlessSignalHandlers();
    } else {
      // CLI 模式 - startCLI 内部处理信号
      logger.info('');
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
    logger.info('');
    logger.info('  OPENCHAT BRIDGE v2.0');
    if (pname) logger.info(`  [${pname}]`);
    logger.info('  输入 ? 查看帮助，或直接开始聊天\n');

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
      logger.info('\n[CLI] 再见!');
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
      logger.error('[历史] 加载失败:', e);
    }
    return [];
  }

  saveHistory() {
    try {
      const historyPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'history.json');
      fs.writeFileSync(historyPath, JSON.stringify(this.history), 'utf8');
    } catch (e) {
      logger.error('[历史] 保存失败:', e);
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
          logger.info(`[学习核心] 第${cycle}轮: 解决 ${result.problem} → IQ: ${result.iq}`);
        } else if (cycle % 10 === 0) {
          logger.info(`[学习核心] 第${cycle}轮: ${result.status} | IQ: ${result.iq} 年龄: ${result.age}`);
        }
      } catch (e) {
        logger.info(`[学习核心] 第${cycle}轮异常: ${e.message}`);
      }
    };

    runCycle();
    this._learningTimer = setInterval(runCycle, 60000);
  }

  _startFairyMonitor() {
    let downCount = 0;
    let isMainMode = false;
    const mainPort = getMainPort();
    this._fairyMonTimer = setInterval(async () => {
      if (isMainMode) {
        try {
          const resp = await fetch(`http://localhost:${mainPort}/api/status`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            logger.info('[FairyMonitor] 🔄 主 Bridge 已恢复，归还主模式');
            if (this._learningTimer) clearInterval(this._learningTimer);
            this._learningTimer = null;
            isMainMode = false;
            downCount = 0;
            return;
          }
        } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
        return;
      }

      try {
        const resp = await fetch(`http://localhost:${mainPort}/api/status`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) { downCount = 0; return; }
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); downCount++; }

      if (downCount >= 3) {
        logger.info('[FairyMonitor] 🔼 主 Bridge 失联，临时接管主模式');
        this._startLearningCore();
        await this._reviveMain(mainPort);
        isMainMode = true;
        downCount = 0;
      }
    }, 15000);
  }

  async _reviveMain(mainPort) {
    try {
      const { spawn } = await import('child_process');
      const child = spawn(process.execPath, ['src/main.js', `--port=${mainPort}`], {
        cwd: process.cwd(), detached: true, stdio: 'ignore'
      });
      child.unref();
      logger.info(`[FairyMonitor] 发送主 Bridge 复活命令 :${mainPort}`);
    } catch (e) {
      logger.info(`[FairyMonitor] 复活失败: ${e.message}`);
    }
  }

  _startHeartbeat() {
    const myPort = this.body?.port || port || 0;
    const mainPort = getMainPort();
    setInterval(async () => {
      try {
        await fetch(`http://localhost:${mainPort}/api/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: myPort }),
          signal: AbortSignal.timeout(2000)
        });
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    }, 10000);
  }

  async shutdown() {
    logger.info('\n[Bridge] 正在关闭...');

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

    // 关闭统一 REST API 服务器 (含 WebSocket)
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

    logger.info('[Bridge] 已退出，再见!');
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
    logger.error('Bridge 启动失败:', e.message);
    process.exit(1);
  });
}