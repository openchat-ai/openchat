import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { sessionManager } from './session/session-manager.js';
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
// 默认 headless 模式，--cli 或 -i 进入交互模式
const args = process.argv.slice(2);
const isInteractive = args.includes('--cli') || args.includes('-i');
const isHeadless = !isInteractive;
const isPublic = args.includes('--public') || args.includes('-p');
const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1]) || 3000;

const CONFIG = {
  port,  // 统一端口 3000
  host: isPublic ? '0.0.0.0' : 'localhost',  // 默认 localhost，--public 绑定 0.0.0.0
  headless: isHeadless,
  enableWebSocket: true  // 无头模式默认启用 WebSocket
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

    // 无头模式：启动统一服务 (HTTP + WebSocket)
    if (CONFIG.headless) {
      this.startServer();
      const host = CONFIG.host === '0.0.0.0' ? '0.0.0.0' : 'localhost';
      console.log('');
      console.log(`[HTTP] API: http://${host}:${CONFIG.port}`);
      console.log(`[WS]   Chat: ws://${host}:${CONFIG.port}/ws`);
      console.log(`[WS]   Voice: ws://${host}:${CONFIG.port}/signaling (预留)`);
      if (CONFIG.host === 'localhost') {
        console.log('[提示] 仅监听本地连接，使用 --public 开放外部访问');
      }
      console.log('');
      console.log('Bridge 运行中... (Ctrl+C 停止)');
      console.log('提示: 使用 --cli 参数进入交互模式');

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
        } else if (pathname === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - this.startTime }));
        } else if (pathname === '/' && req.method === 'GET') {
          // 根路径返回服务信息
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            name: 'OpenChat Bridge',
            version: '2.0',
            endpoints: {
              api: '/api/*',
              ws: '/ws',
              signaling: '/signaling (reserved)',
              health: '/health'
            }
          }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
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
      console.log('[WS] Client connected');
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
        console.log('[WS] Client disconnected');
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

    // 预留语音信令 WebSocket (未来实现)
    this.signalingWss = new WebSocketServer({
      server: this.httpServer,
      path: '/signaling'
    });

    this.signalingWss.on('connection', (ws) => {
      console.log('[Signaling] Voice client connected');
      ws.send(JSON.stringify({ type: 'connected', message: 'Voice signaling ready' }));

      ws.on('message', (data) => {
        // TODO: 实现 WebRTC 信令
        console.log('[Signaling] Received:', data.toString().substring(0, 100));
      });

      ws.on('close', () => {
        console.log('[Signaling] Voice client disconnected');
      });
    });

    // 启动 HTTP 服务器
    this.httpServer.listen(CONFIG.port, CONFIG.host);
    console.log(`[Server] Listening on ${CONFIG.host}:${CONFIG.port}`);
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
        const { message, sessionId, provider, model } = JSON.parse(body);

        // 如果没有 session，创建一个
        let sid = sessionId;
        if (!sid) {
          const p = provider || persistentConfig.getPreference('currentProvider');
          const m = model || persistentConfig.getPreference('currentModel');
          sid = await sessionManager.createSession(p, m);
        }

        // 发送消息并获取响应
        const response = await sessionManager.sendMessage(sid, message);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sessionId: sid,
          response: response.content || response
        }));
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
    console.log('  Type ? for help, or just chat\n');

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
      console.log('\nGoodbye!');
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
      console.error('Failed to load history:', e);
    }
    return [];
  }

  saveHistory() {
    try {
      const historyPath = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'history.json');
      fs.writeFileSync(historyPath, JSON.stringify(this.history), 'utf8');
    } catch (e) {
      console.error('Failed to save history:', e);
    }
  }

  async shutdown() {
    console.log('\nShutting down...');

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

    console.log('Goodbye!');
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