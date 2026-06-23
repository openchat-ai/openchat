import 'dotenv/config';
import * as readline from 'readline';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DEFAULT_PORT, getMainPort } from './constants.js';
import { sessionManager } from './session/session-manager.js';

// 新增：REST API 服务器（31 个端点）
// 使用动态 import 加载 CommonJS 模块
const apiServer = null;
import { executeCommand, commands } from './cli/commands.js';
import { MessageBuilder, MessageType } from './protocol/message.js';
import { router, initCore } from './core/routing.mjs';
import { createHandlers } from './infra/route-handlers.js';
import { CLIGateway, WSGateway } from './gateway/base.js';
import { persistentConfig } from './core/core-config.mjs';
import * as providerService from './experiments/lib/llm-lib.mjs';
import { memoryManager } from './memory/memory-manager.js';
import P2PSwarm, { hasPublicAddress, getPublicIPv4 } from './experiments/lib/storage-lib.mjs';
import { PeerRegistry } from './p2p/peer-registry.js';
import { QiniuBackend } from './p2p/peer-registry/qiniu-backend.js';
import { HttpBackend } from './p2p/peer-registry/http-backend.js';
import { logger } from './experiments/lib/misc-lib.mjs';

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
    console.debug(`[fetchLocalModels] provider models error: ${e.message}`);
  }
  return [];
}

// 解析命令行参数
// 读取顺序：~/.openchat/config.json bridge.* → CLI 覆盖
// 公网 IP 自动检测（无需 --public 参数）
const args = process.argv.slice(2);
const savedBridge = persistentConfig.getBridgeConfig();
const isInteractive = args.includes('--cli') || args.includes('-i');

// Dev REPL mode: node src/main.js --cli  → start dev REPL, skip server
if (isInteractive) {
  const { startDevRepl } = await import('./core/dev-repl.mjs');
  await startDevRepl();
  process.exit(0);
}

const isSandbox = process.argv.includes('--sandbox');
const isHeadless = savedBridge.mode === 'cli' ? false : !isInteractive;
const isPublic = hasPublicAddress() || !!savedBridge.advertiseHost;

// 支持 --port 命令行参数覆盖配置
const portArgIndex = args.findIndex(a => a.startsWith('--port='));
const cliPort = portArgIndex !== -1 ? parseInt(args[portArgIndex].split('=')[1]) : null;
const port = cliPort || savedBridge.port || DEFAULT_PORT;
const isMain = port === DEFAULT_PORT || process.argv.includes('--main');

// [L1.5] 多 bridge flag: --name / --workdir / --token (手机管理多桥用)
//   --name=X     桥身份 (默认 bridge-<4位随机>)
//   --workdir=X  桥工作目录 (默认当前 cwd; chdir 后所有相对路径走这个)
//   --token=X    桥 token (null = 无鉴权; 写 ~/.openchat/bridges/<name>.token)
const nameArgIndex = args.findIndex(a => a.startsWith('--name='));
const workdirArgIndex = args.findIndex(a => a.startsWith('--workdir='));
const tokenArgIndex = args.findIndex(a => a.startsWith('--token='));
const cliName = nameArgIndex !== -1 ? args[nameArgIndex].slice(7) : null;
const cliWorkdir = workdirArgIndex !== -1 ? args[workdirArgIndex].slice(10) : null;
const cliToken = tokenArgIndex !== -1 ? args[tokenArgIndex].slice(8) : null;
if (cliWorkdir) {
  try { process.chdir(cliWorkdir); }
  catch (e) { console.error(`[Bridge] chdir 失败 (--workdir=${cliWorkdir}): ${e.message}`); process.exit(1); }
}

const dhtPort = savedBridge.dhtPort || 0;
const localBootstrap = savedBridge.localBootstrap || [];
let directListen = savedBridge.directListen || 0;
const directConnect = savedBridge.directConnect || [];
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
const bridgeName = cliName || savedBridge.name || `bridge-${Math.random().toString(36).substr(2, 4)}`;
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
    isSandbox,
    advertiseHost,
    qiniuEnabled, cores,
    topic: bridgeTopic
  });
  console.debug(`[Config] 已保存到 ${path.join(os.homedir(), '.openchat', 'config.json')}`);
}

const CONFIG_HOST = isPublic ? '0.0.0.0' : 'localhost';
const CONFIG = {
  port,
  host: CONFIG_HOST,
  headless: isHeadless,
  isPublic,
  isSandbox,
  enableWebSocket: true,
  dhtPort,
  localBootstrap,
  directListen,
  directConnect,
  bridgeName,
  // [L1.5] 多桥身份
  workdir: process.cwd(),  // chdir 之后的真实 cwd
  token: cliToken,         // null = 无 token
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

export class Bridge {
  constructor() {
    this.clientId = process.env.CLIENT_ID || crypto.randomUUID();
    this.apiServer = null;  // 统一 REST API 服务器
    this.clients = new Set();
    this.rl = null;
    this.startTime = Date.now();
    this.p2p = null;
    this.signalingRooms = new Map();  // peerId → WebSocket 信令映射
  }

  getPrompt() {
    const provider = persistentConfig.getPreference('currentProvider');
    const model = persistentConfig.getPreference('currentModel');
    if (provider) {
      // 只显示服务商简称，不显示具体模型名，避免界面混乱
      const p = providerService.getProvider(provider);
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
    this._printBanner();

    const handlers = createHandlers(this, CONFIG, crypto);
    await handlers.autoConfigProviders(detectedTools);

    // Chat poller：轮询 oc/chat/ 处理文字和语音消息
    if (isMain) {
      import('./core/chat-poller.mjs').then(async (m) => {
        await m.startChatPoll();
      }).catch(e => console.error('[chat-poller] fail:', e.message));
    }

    initCore();

    // 启动 P2P 信令（仅 Qiniu + UDP 打洞，无 DHT）
    try {
      const backends = [];
      if (CONFIG.qiniuEnabled) backends.push(new QiniuBackend());
      if (CONFIG.cores.length > 0) backends.push(new HttpBackend(CONFIG.cores));
      const peerId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const registry = backends.length > 0 ? new PeerRegistry(backends, peerId) : null;
      this.registry = registry;

      const p2pOpts = {
        silent: true,
        topic: CONFIG.bridge?.topic 
          ? Buffer.from(CONFIG.bridge.topic).slice(0, 32) 
          : Buffer.from('openchat-community').subarray(0, 32),
        identity: { name: CONFIG.bridgeName, region: CONFIG.bridgeRegion },
        hostIsPublic: CONFIG.isPublic,
        wsSignalingUrl: CONFIG.wsSignalingUrl,
        registry
      };
      if (CONFIG.dhtPort) p2pOpts.dhtPort = CONFIG.dhtPort;
      if (CONFIG.localBootstrap.length > 0) p2pOpts.localBootstrap = CONFIG.localBootstrap;
      if (CONFIG.directConnect.length > 0) p2pOpts.knownPeers = CONFIG.directConnect;
      this.p2p = new P2PSwarm(p2pOpts);
      this.p2p.start().catch((e) => console.debug('[P2P] start failed:', e.message));
      if (CONFIG.directListen > 0) {
        this.p2p.listenDirect(CONFIG.directListen);
      }
    } catch (p2pErr) {
      console.debug('[P2P] init error:', p2pErr.message);
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
        console.debug(`[Deploy] build 跳过${detail ? ': ' + detail : ''}`);
      }
    }

    // 启动统一 REST API 服务器（合并了原始 HTTP 服务）
    try {
      const { default: APIServer, setBridgeContext } = await import('./api/server.js');
      this.apiServer = new APIServer({
        port: CONFIG.port, swarm: this.p2p, deployEnabled: deployServerEnabled,
        // [L1.5] 多桥身份透传给 API server, /identity 用
        name: CONFIG.bridgeName,
        workdir: CONFIG.workdir,
        token: CONFIG.token,
      });
      setBridgeContext(this);
      await this.apiServer.start();
      if (this.apiServer) {
        this.apiServer.setupWebSocket(this.apiServer.server);
        this.apiServer.setWSMessageHandler((ws, msg) => {
          this.handleWSMessage(ws, msg).catch(e => {
            try { ws.send(JSON.stringify({ type: 'error', data: { message: e.message } })); } catch (e2) { logger.warn({ err: e2 }, 'WS 发送错误消息失败'); }
          });
        });
        // [L3-WS] /lab WebSocket 推 (替代 5s 轮询) — 走中央 upgrade 派发
        const { attachLabWS } = await import('./api/ws-lab.mjs');
        attachLabWS(this.apiServer, this.apiServer.server);
        this.apiServer.startWSDispatch(this.apiServer.server);
        console.debug(`[API] /lab ws:   ws://localhost:${CONFIG.port}/lab/ws`);
        console.debug(`[API] 统一服务器: http://localhost:${CONFIG.port}`);
        console.debug(`[API] 端点: /api/v1/p2p, /api/v1/updates, /api/v1/skills, /api/v1/versions, /api/v1/resources, /api/v1/voice, /api/v1/signaling`);
      }

      // [auto-lab] OPENCHAT_AUTO_LAB=1 时自动启动 lab cron
      if (process.env.OPENCHAT_AUTO_LAB === '1' || process.env.OPENCHAT_AUTO_LAB === 'true') {
        try {
          const { startCron } = await import('./lab/lab-runner.mjs');
          const interval = parseInt(process.env.OPENCHAT_LAB_CRON_INTERVAL || '1800000', 10);
          const r = startCron(interval);
          console.debug(`[auto-lab] cron started (pid=${r?.pid || '?'}, interval=${(interval/1000).toFixed(0)}s)`);
        } catch (e) {
          console.error(`[auto-lab] start failed: ${e.message}`);
        }
      }

      // P2P 事件监听
      if (this.p2p) {
        this.p2p.on('peer-connected', (peerId) => {
          console.debug(`[P2P] Peer 已连接: ${peerId?.slice(0, 8) || peerId}...`);
        });
        this.p2p.on('peer-disconnected', (peerId) => {
          console.debug(`[P2P] Peer 已断开: ${peerId?.slice(0, 8) || peerId}...`);
        });

        // P2P 信令中继：从其他 Bridge 转发来的音频/信令数据
        this.p2p.on('signaling_relay', (data) => {
          const payload = data.payload || {};
          if (payload.raw && this.apiServer) {
            const raw = Buffer.from(payload.raw, 'base64');
            for (const s of this.apiServer._signalingRooms.values()) {
              try { s.write(raw); } catch (e) { console.error('[C0]', e); }
            }
            return;
          }
          const targetPeerId = payload.data?.toPeerId;
          if (!targetPeerId || !this.apiServer) return;
          const target = this.apiServer._signalingRooms?.get(targetPeerId);
          if (target) {
            try { target.write(Buffer.from(JSON.stringify({ type: 'signaling_message', data: payload.data }))); } catch (e) { console.error('[C0]', e); }
          }
        });
      }
    } catch (e) {
      if (e.code === 'EADDRINUSE') {
        console.debug(`[启动] 端口 ${CONFIG.port} 已被占用，切换为无网络模式`);
        CONFIG.headless = true;
        this.apiServer = null;
      } else {
        console.debug(`[启动] API 初始化失败: ${e.message}`);
      }
    }

    // 无头模式：日志输出
    if (CONFIG.headless) {
      if (!this.apiServer) {
        console.debug('[无网络] 仅本地设备模式（无 API 服务）');
      }

      // 公网节点自动补全 WS 信令地址（若未显式指定）
      if (!CONFIG.wsSignalingUrl && CONFIG.isPublic) {
        const publicIp = getPublicIPv4();
        if (publicIp) {
          CONFIG.wsSignalingUrl = `ws://${publicIp}:${CONFIG.port}/signaling`;
          if (this.p2p) this.p2p.wsSignalingUrl = CONFIG.wsSignalingUrl;
        }
      }
      const host = CONFIG.host === '0.0.0.0' ? '0.0.0.0' : 'localhost';
      console.debug('');
      console.debug(`[HTTP] API: http://${host}:${CONFIG.port}`);
      console.debug(`[WS]   Chat: ws://${host}:${CONFIG.port}/ws`);
      const sigUrl = CONFIG.wsSignalingUrl || `ws://${host}:${CONFIG.port}/signaling`;
      console.debug(`[WS]   Voice: ${sigUrl}${CONFIG.wsSignalingUrl ? '' : ' (未配置 wsSignaling, 仅本地)'}`);
      if (CONFIG.host === 'localhost') {
        console.debug('[提示] 仅监听本地连接（自动检测未发现公网 IP）');
      }
      console.debug('');
      console.debug('[Bridge] 运行中... (Ctrl+C 停止)');
      console.debug('[提示] 使用 --cli 参数进入交互模式');

      // Headless 模式的信号处理
      this.setupHeadlessSignalHandlers();
    } else {
      // CLI 模式 - startCLI 内部处理信号
      console.debug('');
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
        console.debug(`[WS] memory init error: ${e.message}`);
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

        // Agent 内部 debug 流
    if (type === 'chat_debug') {
      try {
        await this.handleWSChatDebug(ws, msg);
      } catch (e) {
        try { ws.send(JSON.stringify({ type: 'error', data: { message: e.message }, sessionId })); } catch (e) { console.error('[C0]', e); }
      }
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

  async handleWSChatDebug(ws, msg) {
    const { data, sessionId } = msg;
    const message = data?.message;
    if (!message) {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'MESSAGE_REQUIRED' }, sessionId }));
      return;
    }

    const providerName = persistentConfig.getCurrentProvider();
    const apiKey = persistentConfig.getApiKey(providerName);
    const model = persistentConfig.getPreference('currentModel');
    if (!providerName || !apiKey) {
      ws.send(JSON.stringify({ type: 'error', data: { message: 'NO_API_KEY' }, sessionId }));
      return;
    }

    if (!sessionManager.getProvider(providerName)) {
      await sessionManager.addProvider(providerName, apiKey);
    }

    let sid = sessionId;
    if (!sid || !sessionManager.getSession(sid)) {
      const created = await sessionManager.createSession(providerName, model);
      sid = created.id;
    }

    ws.send(JSON.stringify({ type: 'session', data: { sessionId: sid }, sessionId }));

    const { orchestrator, AgentEvents } = await import('./core/agent/orchestrator.mjs');
    let responseHash = '';
    await orchestrator.processStream(sid, 'mobile-user', message, (event) => {
      try {
        if (event.type === 'complete' && event.hash) responseHash = event.hash;
        ws.send(JSON.stringify({ type: 'agent_event', data: { ...event, ts: Date.now() }, sessionId }));
      } catch (e) {
        // WS closed
      }
    }, sessionManager);

    ws.send(JSON.stringify({ type: 'done', data: { hash: responseHash }, sessionId }));
  }

  getCompletions(line) {
    const trimmed = line.trim();
    if (!trimmed) return [];

    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    const matches = [];

    const CMD_1 = ['chat', 'c', 'session', 'provider', 'connect', 'model', 'm',
      'agent', 'a', 'mem', 'memory', 'status', 's', 'help', '?',
      'config', 'cfg', 'upgrade', 'vector', 'vec',
      'evolution', 'evolve', 'security', 'secure',
      'social', 'socialize', 'new', 'clear', 'cls',
      'exit', 'quit', 'q', 'health', 'remember', 'recall'];

    if (parts.length === 1) {
      for (const cmd of CMD_1) {
        if (cmd.startsWith(last)) matches.push(cmd);
      }
      return matches;
    }

    if (parts.length === 2) {
      const sub = {
        session: ['create', 'close', 'list', 'history'],
        provider: ['add', 'remove', 'list', 'presets', 'search'],
        model: ['list', 'set'],
        mem: ['save', 'recall', 'search', 'list', 'stats'],
        memory: ['save', 'recall', 'search', 'list', 'stats'],
        agent: ['spawn', 'parallel', 'iterate', 'evolve'],
        config: ['get', 'set', 'list'],
        cfg: ['get', 'set', 'list'],
        evolution: ['status', 'evolve', 'history'],
        vector: ['search', 'stats'],
        security: ['check', 'status'],
        social: ['status', 'connect'],
      }[parts[0]];
      if (sub) {
        for (const s of sub) {
          if (s.startsWith(last)) matches.push(s);
        }
      }
      return matches;
    }

    return matches;
  }

  startCLI() {
    this.history = this.loadHistory();
    this.executing = false;

    // Print welcome once
    const pname = this.getPrompt();
    console.debug('');
    console.debug('  OPENCHAT BRIDGE v0.1.0');
    if (pname) console.debug(`  [${pname}]`);
    console.debug('  输入 /help 查看命令列表，或直接开始聊天\n');

    // 使用 readline 模块处理交互输入
    // crlfDelay 确保 Windows 换行符正确处理
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      crlfDelay: Infinity,
      prompt: this.getPromptString(),
      completer: (line) => {
        const hits = this.getCompletions(line);
        const partial = line.split(/\s+/).pop() || '';
        return [hits, partial];
      }
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
      console.debug('\n[CLI] 再见!');
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

  async shutdown() {
    console.debug('\n[Bridge] 正在关闭...');

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

    // 停止 P2P 网络
    if (this.p2p) await this.p2p.stop();

    console.debug('[Bridge] 已退出，再见!');
    process.exit(0);
  }

  _printBanner() {
    const mode = CONFIG.isSandbox ? 'SANDBOX' : CONFIG.headless ? 'HEADLESS' : 'CLI';
    let moduleCount = '';
    try {
      const projectRoot = path.resolve(path.dirname(import.meta.url.replace('file://', '')), '..', '..');
      const dnaPath = path.join(projectRoot, '.dna', 'project-dna.json');
      if (fs.existsSync(dnaPath)) {
        const dna = JSON.parse(fs.readFileSync(dnaPath, 'utf8'));
        moduleCount = ` │ modules: ${dna.totalModules} │ deps: ${dna.totalDepFiles}`;
      }
    } catch (e) { console.debug('[DNA] read error:', e.message); }
    console.debug('');
    console.debug('╔═══════════════════════════════════════════════════════════╗');
    console.debug('║                                                          ║');
    console.debug('║                   OPENCHAT BRIDGE                        ║');
    console.debug(`║                   [${mode} MODE]${moduleCount.padEnd(28, ' ')}║`);
    console.debug('║                                                          ║');
    console.debug('╚═══════════════════════════════════════════════════════════╝');
    console.debug('');
  }
}

export async function startBridge(detectedTools = [], options = {}) {
  // 允许通过 options 覆盖配置
  if (options.headless !== undefined) CONFIG.headless = options.headless;
  if (options.port) CONFIG.port = options.port;
  if (options.host) CONFIG.host = options.host;

  const bridge = new Bridge();
  await bridge.start(detectedTools);
  return bridge;
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