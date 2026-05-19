/**
 * Forge — unified generalization entry
 * 统一泛化入口：解题→存储→同步 一条线
 */
import { generalizationEngineV2 } from './generalization.js';
import { vectorMemory } from './vector-memory.js';
import { GossipManager } from '../p2p/gossip-manager.js';

class Forge {
  constructor() {
    this._gossip = null;
  }

  /** 解题：先模式匹配，解不了再调 LLM */
  async solve(question, options = {}) {
    const result = await generalizationEngineV2.solve({ question });
    // 无论成功与否，结果都存进记忆
    this.learn(question, result?.content || '');
    return result;
  }

  /** 搜索向量记忆 */
  search(query, opts) {
    return vectorMemory.search(query, opts);
  }

  /** 存知识到向量记忆 */
  learn(question, answer) {
    vectorMemory.store({
      residentId: 'forge',
      text: `Q: ${question.substring(0, 100)}\nA: ${answer.substring(0, 300)}`,
      metadata: { type: 'forge-solved' },
      source: 'forge',
    });
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
}

const forge = new Forge();
export { Forge, forge };
