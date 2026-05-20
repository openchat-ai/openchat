import { persistentConfig } from '../core/persistent-config.js';
import { providerRegistry } from '../providers/provider-registry.js';
import { memoryManager } from '../memory/memory-manager.js';
import { sessionManager } from '../core/session-manager.js';
import { agentMonitor } from '../core/agent/agent-monitor.js';
import { residentScheduler } from '../core/agent/resident-scheduler.js';
import { router } from '../core/router.js';
import { WSGateway } from './gateway-base.js';
import { MessageType } from '../core/protocol-message.js';

/**
 * 创建所?HTTP 路由 handler，通过闭包捕获 bridge 实例
 * @param {object} bridge - Bridge 实例
 * @param {object} CONFIG - 全局配置对象
 * @param {object} crypto - crypto 模块 (用于 UUID 生成)
 */
export function createHandlers(bridge, CONFIG, crypto) {

  async function handleLearningStatus(req, res) {
    const stats = bridge.learningCore ? bridge.learningCore.getStats() : { iq: 0, age: 0, solvedCount: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  }

  async function handleStatus(req, res) {
    const provider = persistentConfig.getPreference('currentProvider');
    const model = persistentConfig.getPreference('currentModel');
    const memStats = await memoryManager.getStats();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'running',
      uptime: Math.floor((Date.now() - bridge.startTime) / 1000),
      currentProvider: provider,
      currentModel: model,
      wsClients: bridge.clients.size,
      memory: memStats
    }));
  }

  async function handleProviders(req, res) {
    const providers = providerRegistry.listAll();
    const current = persistentConfig.getPreference('currentProvider');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      current,
      providers
    }));
  }

  async function handleSessions(req, res) {
    const sessions = sessionManager.listSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions }));
  }

  async function handleChat(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, sessionId } = JSON.parse(body);

        const kb = residentScheduler?._convergenceSystem?.kb;
        let cachedAnswer = null;
        if (kb) {
          cachedAnswer = kb.answer('general', message);
        }

        if (cachedAnswer) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response: cachedAnswer,
            source: 'knowledge_base'
          }));
          return;
        }

        const problemId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        if (residentScheduler) {
          residentScheduler.addProblem({
            problemId,
            domain: 'general',
            question: message,
            subQuestions: [],
            from: 'api_chat',
          });

          const maxWait = 10000;
          const checkInterval = 500;
          let waited = 0;

          while (waited < maxWait) {
            await new Promise(r => setTimeout(r, checkInterval));
            waited += checkInterval;

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

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response: '问题已提交，正在求解?..',
            source: 'residents_processing',
            problemId
          }));
        } else {
          throw new Error('Resident scheduler not available');
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  async function handleChatStream(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, sessionId, provider, model } = JSON.parse(body);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        const sendEvent = (event, data) => {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        let sid = sessionId;
        if (!sid) {
          const p = provider || persistentConfig.getPreference('currentProvider');
          const m = model || persistentConfig.getPreference('currentModel');
          sid = await sessionManager.createSession(p, m);
        }

        sendEvent('session', { sessionId: sid });

        const { agentEngine } = await import('../core/agent-engine.js');

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

  async function handleGetConfig(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      currentProvider: persistentConfig.getPreference('currentProvider'),
      currentModel: persistentConfig.getPreference('currentModel'),
      configuredProviders: persistentConfig.listProviders()
    }));
  }

  async function handleSetConfig(req, res) {
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

  async function handleMemoryStats(req, res) {
    const stats = await memoryManager.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  }

  async function handleMemoryOp(req, res) {
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

  async function handleProviderConnect(req, res) {
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
            models: models.slice(0, 20)
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

  async function handleProviderModels(req, res) {
    const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
    const providerId = url.searchParams.get('providerId');

    if (!providerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'providerId required' }));
      return;
    }

    try {
      const models = await providerRegistry.refreshModels(providerId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ providerId, models, count: models.length }));
    } catch (e) {
      const models = providerRegistry.getModels(providerId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ providerId, models, count: models.length, cached: true }));
    }
  }

  function getSystemStatus() {
    if (bridge.stabilitySystem) {
      return bridge.stabilitySystem.getSystemStatus();
    }
    return {
      status: 'running',
      uptime: Math.floor((Date.now() - bridge.startTime) / 1000),
      components: ['basic']
    };
  }

  async function handleAgentsList(req, res) {
    const summary = agentMonitor.getSummary();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));
  }

  async function handleAgentsHistory(req, res) {
    const url = new URL(req.url, `http://localhost:${CONFIG.port}`);
    const limit = parseInt(url.searchParams.get('limit')) || 20;

    const history = agentMonitor.getExecutionHistory(limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ history }));
  }

  async function handleAgentStatus(req, res, agentId) {
    const agent = agentMonitor.getAgent(agentId);

    if (!agent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agent));
  }

  async function handleAgentAction(req, res, agentId) {
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

  async function autoConfigProviders(detectedTools) {
    for (const tool of detectedTools) {
      try {
        const { createLocalProvider } = await import('../providers/local-provider.js');
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

  async function handleWSMessage(ws, msg) {
    const { type, data, sessionId } = msg;

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

    // Handle bridge status query
    if (type === 'bridge_status' || type === MessageType.BRIDGE_STATUS) {
      const provider = persistentConfig.getPreference('currentProvider');
      const model = persistentConfig.getPreference('currentModel');
      const memStats = await memoryManager.getStats();

      ws.send(JSON.stringify({
        type: 'bridge_status',
        data: {
          status: 'running',
          uptime: Math.floor((Date.now() - bridge.startTime) / 1000),
          currentProvider: provider,
          currentModel: model,
          wsClients: bridge.clients.size,
          memory: memStats
        }
      }));
      return;
    }

    // Handle chat messages via agent-engine
    if (type === 'chat' || type === MessageType.CHAT || type === 'message') {
      const { message, sessionId: sid, to } = data || {};

      // P2P message: forward to destination peer
      if (to) {
        let sent = false;
        for (const client of bridge.clients) {
          if (client.readyState === 1 && client._peerId === to) {
            client.send(JSON.stringify({ type: 'message', data: { from: ws._peerId, message, time: Date.now() }, sessionId }));
            sent = true;
            break;
          }
        }
        ws.send(JSON.stringify({ type: 'message_ack', data: { sent, to, message }, sessionId }));
        return;
      }

      if (!message) {
        ws.send(JSON.stringify({ type: 'error', data: { message: '消息不能为空' }, sessionId }));
        return;
      }
      const { agentEngine } = await import('../core/agent-engine.js');
      const session = sessionId || crypto.randomUUID();
      ws.send(JSON.stringify({ type: 'chat_ack', data: { sessionId: session }, sessionId }));

      try {
        let fullContent = '';
        await agentEngine.processStream(session, 'ws-user', message, (event) => {
          switch (event.type) {
            case 'content':
              fullContent += event.content;
              ws.send(JSON.stringify({ type: 'chat_chunk', data: { content: event.content }, sessionId }));
              break;
            case 'thinking':
              ws.send(JSON.stringify({ type: 'chat_thinking', data: { iteration: event.iteration }, sessionId }));
              break;
            case 'complete':
              ws.send(JSON.stringify({ type: 'chat_response', data: { content: fullContent, sessionId }, sessionId }));
              break;
          }
        });
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', data: { message: e.message }, sessionId }));
      }
      return;
    }

    // 其他消息通过 Router 处理
    const gatewayId = `ws-${sessionId || crypto.randomUUID()}`;
    const wsGateway = new WSGateway(gatewayId, router, ws);
    router.registerGateway(gatewayId, wsGateway);

    try {
      await router.dispatch(gatewayId, { type, data, sessionId });
    } catch (e) {
      ws.send(JSON.stringify({ type: MessageType.ERROR, data: { message: e.message }, sessionId }));
    }
  }

  return {
    handleLearningStatus,
    handleStatus,
    handleProviders,
    handleSessions,
    handleChat,
    handleChatStream,
    handleGetConfig,
    handleSetConfig,
    handleMemoryStats,
    handleMemoryOp,
    handleProviderConnect,
    handleProviderModels,
    getSystemStatus,
    handleAgentsList,
    handleAgentsHistory,
    handleAgentStatus,
    handleAgentAction,
    autoConfigProviders,
    handleWSMessage,
  };
}
