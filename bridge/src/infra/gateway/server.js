import logger from '../../core/logger.js';
/**
 * OpenChat 多协议聚合中转服务器
 *
 * 提供统一的 OpenAI 兼容 API，自动路由到不同的后端服务商
 *
 * 功能：
 * 1. 统一的 OpenAI 格式接口
 * 2. 虚拟 API Key 管理（映射到真实的后端服务商）
 * 3. 自动协议转换（OpenAI ↔ Anthropic/Gemini/Azure/Cohere 等）
 * 4. 负载均衡和失败重试
 * 5. 请求日志和统计
 *
 * 使用方式：
 *   node gateway-server.js
 *
 *   然后其他软件可以使用：
 *   - Base URL: http://localhost:8787/v1
 *   - API Key: 虚拟 Key（在配置文件中定义）
 *
 * 端口: 8787
 */

import http from 'http';
import { URL } from 'url';
import { providerRegistry } from './bridge/src/providers/provider-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

const PORT = process.env.GATEWAY_PORT || 8787;
const CONFIG_DIR = path.join(homedir(), '.openchat');
const GATEWAY_CONFIG_FILE = path.join(CONFIG_DIR, 'gateway-config.json');

/**
 * 网关配置管理
 */
class GatewayConfig {
  constructor() {
    this.config = this.load();
  }

  load() {
    if (fs.existsSync(GATEWAY_CONFIG_FILE)) {
      try {
        const data = fs.readFileSync(GATEWAY_CONFIG_FILE, 'utf8');
        return JSON.parse(data);
      } catch (e) {
        logger.error('Failed to load gateway config:', e.message);
      }
    }

    // 默认配置
    return {
      virtualKeys: {
        // 虚拟 Key: 后端服务商配置
        'vk-default': {
          provider: 'openai',
          model: 'gpt-4o-mini',
          enabled: true
        },
        'vk-claude': {
          provider: 'anthropic',
          model: 'claude-3-5-haiku-20241022',
          enabled: true
        },
        'vk-gemini': {
          provider: 'gemini',
          model: 'gemini-2.0-flash-exp',
          enabled: true
        }
      },
      settings: {
        enableLogging: true,
        enableStats: true,
        timeout: 120000,
        maxRetries: 2
      }
    };
  }

  save() {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(GATEWAY_CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
      return true;
    } catch (e) {
      logger.error('Failed to save gateway config:', e.message);
      return false;
    }
  }

  getVirtualKeyConfig(virtualKey) {
    return this.config.virtualKeys[virtualKey];
  }

  addVirtualKey(virtualKey, config) {
    this.config.virtualKeys[virtualKey] = config;
    this.save();
  }

  removeVirtualKey(virtualKey) {
    delete this.config.virtualKeys[virtualKey];
    this.save();
  }

  listVirtualKeys() {
    return Object.entries(this.config.virtualKeys);
  }

  getSetting(key) {
    return this.config.settings[key];
  }
}

/**
 * 请求统计
 */
class RequestStats {
  constructor() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      byProvider: {},
      byModel: {},
      totalTokens: 0
    };
  }

  record(provider, model, success, tokens = 0) {
    this.stats.totalRequests++;

    if (success) {
      this.stats.successfulRequests++;
    } else {
      this.stats.failedRequests++;
    }

    if (!this.stats.byProvider[provider]) {
      this.stats.byProvider[provider] = 0;
    }
    this.stats.byProvider[provider]++;

    if (!this.stats.byModel[model]) {
      this.stats.byModel[model] = 0;
    }
    this.stats.byModel[model]++;

    this.stats.totalTokens += tokens;
  }

  getStats() {
    return this.stats;
  }

  reset() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      byProvider: {},
      byModel: {},
      totalTokens: 0
    };
  }
}

/**
 * 网关服务器
 */
class GatewayServer {
  constructor() {
    this.config = new GatewayConfig();
    this.stats = new RequestStats();
  }

  /**
   * 解析请求体
   */
  async parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * 发送 JSON 响应
   */
  sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /**
   * 发送错误响应（OpenAI 格式）
   */
  sendError(res, statusCode, message, type = 'invalid_request_error') {
    this.sendJSON(res, statusCode, {
      error: {
        message,
        type,
        code: statusCode
      }
    });
  }

  /**
   * 发送 SSE 数据
   */
  sendSSE(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * 验证虚拟 API Key
   */
  validateApiKey(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const virtualKey = authHeader.slice(7);
    const config = this.config.getVirtualKeyConfig(virtualKey);

    if (!config || !config.enabled) {
      return null;
    }

    return { virtualKey, ...config };
  }

  /**
   * 处理 /v1/chat/completions 请求
   */
  async handleChatCompletions(req, res, keyConfig) {
    try {
      const requestBody = await this.parseBody(req);
      const { model, messages, stream, ...options } = requestBody;

      // 使用虚拟 Key 配置的后端
      const provider = keyConfig.provider;
      const targetModel = model || keyConfig.model;

      if (this.config.getSetting('enableLogging')) {
        logger.info(`[Gateway] ${keyConfig.virtualKey} -> ${provider}/${targetModel}`);
      }

      // 调用后端
      if (stream) {
        await this.handleStreamingRequest(res, provider, targetModel, messages, options);
      } else {
        await this.handleNormalRequest(res, provider, targetModel, messages, options);
      }

      // 记录统计
      this.stats.record(provider, targetModel, true);
    } catch (e) {
      logger.error('[Gateway] Error:', e.message);
      this.stats.record(keyConfig?.provider || 'unknown', 'unknown', false);
      this.sendError(res, 500, e.message, 'server_error');
    }
  }

  /**
   * 处理非流式请求
   */
  async handleNormalRequest(res, provider, model, messages, options) {
    const response = await providerRegistry.chat(messages, {
      providerId: provider,
      model,
      ...options
    });

    // 转换为 OpenAI 格式
    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content
          },
          finish_reason: 'stop'
        }
      ],
      usage: response.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };

    this.sendJSON(res, 200, openaiResponse);
  }

  /**
   * 处理流式请求
   */
  async handleStreamingRequest(res, provider, model, messages, options) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const providerInstance = providerRegistry.getProvider(provider);
    if (!providerInstance) {
      throw new Error(`Provider ${provider} not found`);
    }

    try {
      for await (const chunk of providerInstance.chatStream(model, messages, options)) {
        if (chunk.type === 'content') {
          // 转换为 OpenAI 流式格式
          const streamChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {
                  content: chunk.content
                },
                finish_reason: null
              }
            ]
          };
          this.sendSSE(res, streamChunk);
        }

        if (chunk.done) {
          // 发送结束标记
          const endChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }
            ]
          };
          this.sendSSE(res, endChunk);
          res.write('data: [DONE]\n\n');
          break;
        }
      }
    } catch (e) {
      logger.error('[Gateway] Streaming error:', e.message);
      const errorChunk = {
        error: {
          message: e.message,
          type: 'server_error'
        }
      };
      this.sendSSE(res, errorChunk);
    }

    res.end();
  }

  /**
   * 处理 /v1/models 请求
   * 支持虚拟 Key：如果提供了虚拟 Key，只返回该 Provider 的模型
   */
  handleModels(req, res, keyConfig = null) {
    const models = [];

    if (keyConfig) {
      // 如果提供了虚拟 Key，只返回该 Provider 的模型
      const provider = keyConfig.provider;
      const providerInstance = providerRegistry.getProvider(provider);

      if (!providerInstance) {
        this.sendError(res, 404, `Provider ${provider} not found`, 'not_found');
        return;
      }

      const providerModels = providerRegistry.getModels(provider);
      const providerInfo = providerRegistry.listConfigured().find(p => p.id === provider);

      for (const model of providerModels) {
        models.push({
          id: model,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: provider,
          permission: [],
          root: model,
          parent: null,
          provider_name: providerInfo?.name || provider,
          is_default: model === keyConfig.model
        });
      }

      if (this.config.getSetting('enableLogging')) {
        logger.info(`[Gateway] ${keyConfig.virtualKey} queried models - returned ${models.length} models from ${provider}`);
      }
    } else {
      // 无虚拟 Key：返回所有 Provider 的所有模型
      const providers = providerRegistry.listConfigured();

      for (const provider of providers) {
        const providerModels = providerRegistry.getModels(provider.id);
        for (const model of providerModels) {
          models.push({
            id: model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: provider.id,
            permission: [],
            root: model,
            parent: null,
            provider_name: provider.name || provider.id
          });
        }
      }

      if (this.config.getSetting('enableLogging')) {
        logger.info(`[Gateway] Anonymous queried models - returned ${models.length} total models`);
      }
    }

    this.sendJSON(res, 200, {
      object: 'list',
      data: models,
      virtual_key: keyConfig?.virtualKey || null,
      provider: keyConfig?.provider || null,
      model_count: models.length
    });
  }

  /**
   * 处理统计请求
   */
  handleStats(req, res) {
    this.sendJSON(res, 200, {
      stats: this.stats.getStats(),
      virtualKeys: this.config.listVirtualKeys().map(([key, config]) => ({
        key,
        provider: config.provider,
        model: config.model,
        enabled: config.enabled
      })),
      providers: providerRegistry.listConfigured()
    });
  }

  /**
   * 处理健康检查
   */
  handleHealth(req, res) {
    this.sendJSON(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      stats: this.stats.getStats()
    });
  }

  /**
   * 主请求处理函数
   */
  async handleRequest(req, res) {
    // CORS 支持
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    // 健康检查（无需认证）
    if (path === '/health' || path === '/v1/health') {
      this.handleHealth(req, res);
      return;
    }

    // 统计信息（无需认证）
    if (path === '/stats' || path === '/v1/stats') {
      this.handleStats(req, res);
      return;
    }

    // 模型列表：支持可选的虚拟 Key
    // 无 Key 时返回所有模型，有 Key 时返回该 Provider 的模型
    if (path === '/v1/models' && req.method === 'GET') {
      const keyConfig = this.validateApiKey(req);
      this.handleModels(req, res, keyConfig);
      return;
    }

    // 验证 API Key（聊天请求需要）
    const keyConfig = this.validateApiKey(req);
    if (!keyConfig) {
      this.sendError(res, 401, 'Invalid API key', 'invalid_api_key');
      return;
    }

    // 路由请求
    if (path === '/v1/chat/completions' && req.method === 'POST') {
      await this.handleChatCompletions(req, res, keyConfig);
    } else {
      this.sendError(res, 404, 'Endpoint not found', 'not_found');
    }
  }

  /**
   * 启动服务器
   */
  start() {
    const server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch(e => {
        logger.error('[Gateway] Unhandled error:', e);
        this.sendError(res, 500, 'Internal server error', 'server_error');
      });
    });

    server.listen(PORT, () => {
      logger.info('');
      logger.info('╔══════════════════════════════════════════════════════════════╗');
      logger.info('║                                                              ║');
      logger.info('║          OpenChat 多协议聚合中转服务器已启动                ║');
      logger.info('║                                                              ║');
      logger.info('╚══════════════════════════════════════════════════════════════╝');
      logger.info('');
      logger.info(`🚀 服务器运行在: http://localhost:${PORT}`);
      logger.info('');
      logger.info('📌 OpenAI 兼容接口:');
      logger.info(`   Base URL: http://localhost:${PORT}/v1`);
      logger.info(`   Endpoint: http://localhost:${PORT}/v1/chat/completions`);
      logger.info('');
      logger.info('🔑 虚拟 API Keys:');
      for (const [key, config] of this.config.listVirtualKeys()) {
        if (config.enabled) {
          logger.info(`   ${key} -> ${config.provider}/${config.model}`);
        }
      }
      logger.info('');
      logger.info('📊 监控接口:');
      logger.info(`   健康检查: http://localhost:${PORT}/health`);
      logger.info(`   统计信息: http://localhost:${PORT}/stats`);
      logger.info('');
      logger.info('📋 模型查询接口:');
      logger.info(`   所有模型: http://localhost:${PORT}/v1/models`);
      logger.info(`   指定 Provider 的模型: http://localhost:${PORT}/v1/models (+ Authorization: Bearer <virtual-key>)`);
      logger.info('');
      logger.info('💡 使用示例:');
      logger.info('   # 查询所有模型');
      logger.info(`   curl http://localhost:${PORT}/v1/models`);
      logger.info('');
      logger.info('   # 查询 Claude 的模型');
      logger.info(`   curl http://localhost:${PORT}/v1/models \\`);
      logger.info('     -H "Authorization: Bearer vk-claude"');
      logger.info('');
      logger.info('   # 发送聊天请求');
      logger.info('   curl http://localhost:8787/v1/chat/completions \\');
      logger.info('     -H "Authorization: Bearer vk-claude" \\');
      logger.info('     -H "Content-Type: application/json" \\');
      logger.info('     -d \'{"model":"claude-3-5-haiku-20241022","messages":[{"role":"user","content":"Hi"}]}\'');
      logger.info('');
      logger.info('⏹️  按 Ctrl+C 停止服务器');
      logger.info('');
    });

    return server;
  }
}

// 启动服务器
const gateway = new GatewayServer();
gateway.start();

export default GatewayServer;
