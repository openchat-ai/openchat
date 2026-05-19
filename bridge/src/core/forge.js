/**
 * Forge — unified entry for solve/verify/store/learn/sync
 * 统一入口：所有泛化能力从这里出去
 */
import * as fs from 'fs';
import * as os from 'os';
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

  /** 解：先召回记忆 → 模式匹配 → LLM */
  async solve(question) {
    const traceId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    let answer = null;
    let source = '';

    // ① 记忆召回：搜向量记忆，置信度达标直接返回
    const recall = await vectorMemory.embedSearch(question, { limit: 1, minScore: 0.3 });
    const memoryHit = recall?.[0];
    if (memoryHit && memoryHit.score > 0.6) {
      const parsed = memoryHit.text.match(/A:\s*(.+)/s);
      if (parsed) return { answer: parsed[1].substring(0, 500), source: 'memory' };
    }

    // ② 模式匹配求解
    try {
      const solverResult = await generalizationEngineV2.solve({ question });
      if (solverResult?.content) {
        answer = solverResult.content;
        source = 'solver';
      }
    } catch (e) {
      this._log(traceId, 'solver_error', e.message);
    }

    // ③ LLM 兜底（熔断保护）
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
        this._log(traceId, 'llm_error', e.message);
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

  /** 触发跨 Bridge 同步（单例，可换 p2p 实例） */
  sync(p2p) {
    if (!this._gossip) {
      this._gossip = new GossipManager();
    }
    this._gossip.start(p2p);
    return this;
  }

  /** 停止 gossip */
  stopSync() {
    if (this._gossip) {
      this._gossip.stop();
      this._gossip = null;
    }
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

  /** 结构化日志 */
  _log(traceId, event, detail) {
    try {
      const entry = `${Date.now()}|${traceId}|${event}|${(detail || '').substring(0, 100)}\n`;
      fs.appendFileSync(os.tmpdir() + '/forge-trace.log', entry);
    } catch {}
  }

  /** 死信队列 */
  _deadLetter(question, answer) {
    try {
      const entry = `${Date.now()}|deadletter|${(question || '').substring(0, 80)}|${(answer || '').substring(0, 80)}\n`;
      fs.appendFileSync(os.tmpdir() + '/forge-deadletter.log', entry);
    } catch {}
  }
}

const forge = new Forge();
export { Forge, forge };
