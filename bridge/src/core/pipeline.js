/**
 * Pipeline — 解 → 代 → 验 → 存
 */
import { generalizationEngineV2 } from './generalization.js';
import { vectorMemory } from './vector-memory.js';

class Pipeline {
  /** 跑完整流水线：先解，不通过则调LLM，验证通过才存库 */
  async run(question, options = {}) {
    const trace = { question, stages: [], startTime: Date.now() };

    // ① 解：模式匹配
    const solverResult = await this._solve(question, trace);
    if (solverResult?.answer) {
      const verified = await this._verify(question, solverResult.answer, trace);
      if (verified) {
        this._store(question, solverResult.answer, trace);
        return { answer: solverResult.answer, source: 'solver', trace };
      }
    }

    // ② 代：LLM 推理（兜底）
    const agentResult = await this._agent(question, trace);
    if (agentResult?.answer) {
      const verified = await this._verify(question, agentResult.answer, trace);
      if (verified) {
        this._store(question, agentResult.answer, trace);
        return { answer: agentResult.answer, source: 'agent', trace };
      }
    }

    return { answer: null, source: 'failed', trace };
  }

  async _solve(question, trace) {
    try {
      const result = await generalizationEngineV2.solve({ question });
      trace.stages.push({ stage: 'solve', status: result?.content ? 'ok' : 'empty' });
      return result?.content ? { answer: result.content } : null;
    } catch (e) {
      trace.stages.push({ stage: 'solve', status: 'error', error: e.message });
      return null;
    }
  }

  async _agent(question, trace) {
    trace.stages.push({ stage: 'agent', status: 'skipped_no_provider' });
    return null;
  }

  async _verify(question, answer, trace) {
    const passed = answer && answer.length > 5 && answer.length < 50000;
    trace.stages.push({ stage: 'verify', status: passed ? 'passed' : 'failed' });
    return passed;
  }

  _store(question, answer, trace) {
    try {
      vectorMemory.store({
        residentId: 'pipeline',
        text: `Q: ${question.substring(0, 200)}\nA: ${answer.substring(0, 500)}`,
        metadata: { source: trace.stages.find(s => s.stage !== 'verify')?.stage || 'unknown' },
        source: 'pipeline',
      });
      trace.stages.push({ stage: 'store', status: 'ok' });
    } catch (e) {
      trace.stages.push({ stage: 'store', status: 'error', error: e.message });
    }
  }
}

const pipeline = new Pipeline();
export { Pipeline, pipeline };
