/**
 * LLMProxyAgent — LLM 代理服务（Provider 侧）
 *
 * 提供方组件：监听 P2P 上的 LLM_PROXY_REQUEST，调用本地 LLM provider，
 * 将结果通过 LLM_PROXY_RESPONSE 返回。
 *
 * 消费方（不持有 API key）通过 P2P 走提供方的 provider 调用 LLM。
 * 提供方启动时广播 LLM_AVAILABLE，并响应 LLM_PROVIDER_QUERY。
 */

import { sessionManager } from '../session/session-manager.js';
import { persistentConfig } from './persistent-config.js';
import { MessageType, createLLMProxyResponse, createLLMAvailableMessage, createLLMProviderQueryMessage } from '../p2p/messages.js';

class LLMProxyAgent {
  /**
   * @param {object} p2p  P2PSwarm 实例
   * @param {object} options
   * @param {boolean} options.enabled  默认 true
   * @param {number}  options.timeout  单次 LLM 调用超时，默认 30s
   */
  constructor(p2p, options = {}) {
    this.p2p = p2p;
    this.enabled = options.enabled !== false;
    this.timeout = options.timeout || 30000;
    this._stats = { total: 0, ok: 0, fail: 0 };
    this._broadcastTimer = null;
  }

  /** 启动监听 */
  start() {
    if (!this.p2p || !this.enabled) return;

    // 检查主人开关：llmProxyEnabled=false 则只自用，不帮邻居
    const bridgeCfg = persistentConfig.getBridgeConfig();
    const proxyEnabled = bridgeCfg?.llmProxyEnabled === true;

    if (proxyEnabled) {
      // 处理 LLM 代理请求
      this.p2p.on(MessageType.LLM_PROXY_REQUEST, (data) => {
        this._handleRequest(data.from, data.payload || {});
      });

      // 响应 LLM 提供方查询
      this.p2p.on(MessageType.LLM_PROVIDER_QUERY, (data) => {
        this._broadcastAvailability(data.from);
      });

      // 立即广播本机 LLM 可用（带延迟确保 P2P 就绪）
      setTimeout(() => this._broadcastAvailability(), 2000);

      // 每 60s 重广播一次，让新加入的节点发现
      this._broadcastTimer = setInterval(() => this._broadcastAvailability(), 60000);

      console.log('[LLMProxy] 提供方已启动，监听 llm_proxy_request / llm_provider_query');
    } else {
      console.log('[LLMProxy] 提供方已关闭（llmProxyEnabled=false），不服务邻居');
    }
  }

  /** 广播 LLM 可用性 */
  _broadcastAvailability(targetPeerId) {
    try {
      const providerName = persistentConfig.getCurrentProvider();
      const model = persistentConfig.getCurrentModel();
      if (!providerName) return;

      const msg = createLLMAvailableMessage({
        bridgeId: this.p2p.peerId || 'bridge-1',
        hostId: persistentConfig.getHostId ? persistentConfig.getHostId() : '',
        models: [model].filter(Boolean),
        provider: providerName,
      });

      if (targetPeerId) {
        this.p2p.sendTo(targetPeerId, msg);
      } else {
        // 广播给所有已连接 peer
        this.p2p.broadcast(msg.payload, msg.type, 'NORMAL');
      }
    } catch (e) {
      // 静默忽略广播错误（P2P 未完全就绪时）
    }
  }

  /** 处理代理请求 */
  async _handleRequest(from, payload) {
    const startTime = Date.now();
    const requestId = payload.requestId || '?';
    const model = payload.model || persistentConfig.getCurrentModel() || '';
    const messages = payload.messages || [];
    const residentName = payload.residentName || '?';

    console.log(`[LLMProxy] ${residentName} 请求代理 LLM model=${model} messages=${messages.length}`);
    this._stats.total++;

    try {
      // 获取当前 provider
      const providerName = persistentConfig.getCurrentProvider();
      if (!providerName) {
        throw new Error('LLM provider 未配置');
      }

      const provider = sessionManager.getProvider(providerName);
      if (!provider) {
        throw new Error(`provider ${providerName} 未连接`);
      }

      // 调用 LLM（带超时）
      const result = await Promise.race([
        provider.chat(model, messages),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LLM 调用超时')), this.timeout)
        ),
      ]);

      const duration = Date.now() - startTime;
      const response = createLLMProxyResponse({
        requestId,
        ok: true,
        content: result.content || result.message?.content || JSON.stringify(result),
        model: result.model || model,
        tokens: result.usage || result.tokens || { prompt: 0, completion: 0, total: 0 },
        duration,
      });

      this.p2p.sendTo(from, response);
      this._stats.ok++;
      console.log(`[LLMProxy] ${residentName} 完成 (${duration}ms)`);

    } catch (e) {
      const duration = Date.now() - startTime;
      const response = createLLMProxyResponse({
        requestId,
        ok: false,
        error: e.message,
        duration,
      });

      // 即使失败也发回响应，让消费方能处理
      if (this.p2p) {
        this.p2p.sendTo(from, response);
      }
      this._stats.fail++;
      console.log(`[LLMProxy] ${residentName} 失败: ${e.message}`);
    }
  }

  /** 获取统计 */
  getStats() {
    return { ...this._stats };
  }

  /** 停止监听 */
  stop() {
    if (this._broadcastTimer) {
      clearInterval(this._broadcastTimer);
      this._broadcastTimer = null;
    }
    if (this.p2p) {
      this.p2p.removeAllListeners(MessageType.LLM_PROXY_REQUEST);
      this.p2p.removeAllListeners(MessageType.LLM_PROVIDER_QUERY);
    }
  }
}

export { LLMProxyAgent };
export default LLMProxyAgent;
