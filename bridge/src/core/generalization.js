/**
 * Generalization Engine v2 — Multi-step strategy evaluation
 * 泛化引擎 v2：多步策略评估，带中间状态传递
 */
import { vectorMemory } from './vector-memory.js';

class GeneralizationEngineV2 {
  async solve({ question, residentName, emitLLMRequest }) {
    const knowledge = await this._retrieve(question);

    // Step 1: List strategies
    const strategies = await this._list(question, knowledge, emitLLMRequest);
    if (!strategies || strategies.length === 0) return this._fallback(question, residentName);

    // Step 2-3: Evaluate each strategy, passing previous results forward
    const results = [];
    let context = '';

    for (const s of strategies) {
      const result = await this._evaluate(s, question, context, emitLLMRequest);
      const number = this._extractNumber(result);
      results.push({ strategy: s, result, number });
      context += `\n策略「${s}」的结果是 ${number !== null ? number + '颗' : '未知'}。`;
    }

    // Step 4: Compare
    const best = results.reduce((a, b) => (a.number ?? 999) < (b.number ?? 999) ? a : b);
    return {
      content: `经过比较各策略：\n${results.map(r => `- ${r.strategy}: ${r.number !== null ? r.number + '颗' : '评估失败'}`).join('\n')}\n\n最优策略：${best.strategy}\n结果：${best.number}颗\n\n推导：${best.result}`,
      model: 'generalization-v2',
    };
  }

  async _retrieve(q) {
    const r = await vectorMemory.autoSearch(q, { limit: 3, minScore: 0.01 }) || vectorMemory.search(q, { limit: 3, minScore: 0.01 });
    return r.map(x => x.text).join('\n');
  }

  async _list(question, knowledge, emit) {
    const p = `列出解决该问题的所有可行策略方向。每行一个"策略X：<描述>"。\n\n问题：${question}\n\n相关知识：\n${knowledge}`;
    const text = await this._call(p, emit);
    const list = [];
    for (const line of (text || '').split('\n')) {
      const m = line.match(/策略\w[：:]\s*(.+)/);
      if (m) list.push(m[1].trim());
    }
    return list.length > 0 ? list : null;
  }

  async _evaluate(strategy, question, previousContext, emit) {
    const p = `评估一种策略。只算这一个。\n\n问题：${question}\n\n策略：${strategy}\n\n之前策略的评估结果：${previousContext || '无'}\n\n要求：\n1. 这个策略分几步？\n2. 每步多少颗？\n3. 最后输出"结果：<数字>"`;
    return await this._call(p, emit) || '评估失败';
  }

  _extractNumber(text) {
    if (!text) return null;
    const m = text.match(/结果[：:]\s*(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  _call(prompt, emit) {
    if (typeof emit !== 'function') return null;
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 30000);
      emit({ messages: [{ role: 'user', content: prompt }], temperature: 0.3 },
        (r) => { clearTimeout(timer); resolve(r?.content || null); },
        () => { clearTimeout(timer); resolve(null); }
      );
    });
  }

  _fallback(question, name) {
    return { content: `${name || '居民'}需要更多信息。`, model: 'fallback' };
  }
}

const generalizationEngineV2 = new GeneralizationEngineV2();
export { GeneralizationEngineV2, generalizationEngineV2 };
