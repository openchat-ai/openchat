/**
 * Forge — unified entry for solve/verify/store/learn/sync
 * 统一入口：所有泛化能力从这里出去
 */
import { generalizationEngineV2 } from './generalization.js';
import { vectorMemory } from './vector-memory.js';
import { GossipManager } from '../p2p/gossip-manager.js';

class Forge {
  constructor() {
    this._gossip = null;
    this._llmHandler = null; // 外部注入 LLM 调用函数
  }

  /** 注入 LLM 处理器：外部只需注册一次 */
  setLLMHandler(fn) {
    this._llmHandler = fn;
  }

  /** 解：先模式匹配，解不开则调 LLM */
  async solve(question) {
    let answer = null;
    let source = '';

    // 尝试模式匹配求解
    const solverResult = await generalizationEngineV2.solve({ question });
    if (solverResult?.content) {
      answer = solverResult.content;
      source = 'solver';
    }

    // 求解失败，走 LLM
    if (!answer && this._llmHandler) {
      const llmResult = await this._llmHandler(question);
      if (llmResult) {
        answer = llmResult;
        source = 'llm';
      }
    }

    // 验证通过才存库
    if (answer && this._verify(answer)) {
      this._store(question, answer, source);
    }

    return { answer, source };
  }

  /** 搜索向量记忆 */
  search(query, opts) {
    return vectorMemory.search(query, opts);
  }

  /** 语义搜索（embedding，异步） */
  embedSearch(query, opts) {
    return vectorMemory.embedSearch(query, opts);
  }

  /** 外部存知识（带验证） */
  learn(question, answer) {
    if (this._verify(answer)) {
      this._store(question, answer, 'manual');
    }
    return this;
  }

  /** 触发跨 Bridge 同步 */
  sync(p2p) {
    if (!this._gossip) {
      this._gossip = new GossipManager();
      this._gossip.start(p2p);
    }
    return this;
  }

  /** 验证：长度 + 无效内容过滤 */
  _verify(text) {
    return text && text.length > 5 && text.length < 50000
      && !text.includes('无法回答')
      && !text.includes('我不知道');
  }

  /** 存储到向量记忆 */
  _store(question, answer, source) {
    try {
      vectorMemory.store({
        residentId: 'forge',
        text: `Q: ${question.substring(0, 200)}\nA: ${answer.substring(0, 500)}`,
        metadata: { source },
        source: 'forge',
      });
    } catch (e) {
      console.error('[Forge] store failed:', e.message);
    }
  }
}

const forge = new Forge();
export { Forge, forge };
