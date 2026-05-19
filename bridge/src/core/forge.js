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
    this._llmHandler = null;
    this._llmFailures = 0;
    this._llmCircuitOpen = false;
    this._validators = [
      // default validators
      (text) => text && text.length > 5 ? null : 'too_short',
      (text) => text.length < 50000 ? null : 'too_long',
      (text) => !text.includes('无法回答') ? null : 'refusal',
      (text) => !text.includes('我不知道') ? null : 'refusal',
    ];
  }

  /** 注册自定义验证器 */
  addValidator(fn) {
    this._validators.push(fn);
  }

  /** 注入 LLM 处理器 */
  setLLMHandler(fn) {
    this._llmHandler = fn;
    this._llmFailures = 0;
    this._llmCircuitOpen = false;
  }

  /** 解：先模式匹配（5s超时），解不开走 LLM（30s超时，熔断保护） */
  async solve(question) {
    const traceId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    let answer = null;
    let source = '';

    // 模式匹配求解（5s 超时）
    try {
      const timeout = AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined;
      const solverResult = await generalizationEngineV2.solve({ question }, timeout);
      if (solverResult?.content) {
        answer = solverResult.content;
        source = 'solver';
      }
    } catch (e) {
      // solver error — fall through to LLM
    }

    // LLM 兜底（熔断保护）
    if (!answer && this._llmHandler && !this._llmCircuitOpen) {
      try {
        const llmResult = await Promise.race([
          this._llmHandler(question),
          new Promise((_, reject) => setTimeout(() => reject(new Error('LLM timeout')), 30000)),
        ]);
        if (llmResult) {
          answer = llmResult;
          source = 'llm';
          this._llmFailures = 0;
        }
      } catch (e) {
        this._llmFailures++;
        if (this._llmFailures >= 3) this._llmCircuitOpen = true;
        console.error('[Forge] LLM failed:', e.message);
      }
    }

    // 验证通过才存库
    if (answer && this._verify(answer)) {
      this._store(question, answer, source);
    } else {
      this._deadLetter(question, answer);
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

  /** 验证链：遍历所有验证器 */
  _verify(text) {
    for (const v of this._validators) {
      const reason = v(text);
      if (reason) return false;
    }
    return true;
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

  /** 死信队列：记录验证失败的答案 */
  _deadLetter(question, answer) {
    try {
      import('fs').then(fs => {
        import('os').then(os => {
          const logDir = os.tmpdir() + '/forge-deadletter.log';
          fs.appendFileSync(logDir,
            `${Date.now()}|verify_fail|${(question || '').substring(0, 80)}|${(answer || '').substring(0, 80)}\n`);
        });
      });
    } catch {}
  }
}

const forge = new Forge();
export { Forge, forge };
