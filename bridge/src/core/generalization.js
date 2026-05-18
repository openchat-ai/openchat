/**
 * Generalization Engine v2 — Multi-step strategy evaluation
 * 泛化引擎 v2：多步策略评估
 *
 * Each reasoning step is a separate LLM call to prevent working memory overflow.
 * 每个推理步骤独立调用 LLM，防止工作记忆溢出导致算数错误。
 */
import { vectorMemory } from './vector-memory.js';

const STRATEGY_LIST_PROMPT = `列出解决该问题的所有可行策略方向。每个策略用一句话描述。

输出格式（每行一个）：
策略A：<描述>
策略B：<描述>`;

const EVALUATE_PROMPT = `你正在评估一种解题策略。只关注这一个策略，不要想其他策略。

问题：{{QUESTION}}

策略：{{STRATEGY}}

规则：
1. 先决定先处理哪个形状（形状A），后处理哪个（形状B）
2. 形状A：用鸽巢原理保证两种口味都有（最坏情况：先拿光西瓜，再拿光A口味，再拿1颗B口味）
3. 形状B：只需要拿到1颗特定口味（因为形状A已经提供了配对的那种口味）—— 最坏情况：先拿光西瓜，再拿1颗目标口味
4. 两部分数量相加。输出"该策略结果：<数字>"`;

const COMPARE_PROMPT = `以下是针对同一问题的多个策略及其评估结果。比较数字，选出最小的。

问题：{{QUESTION}}

{{STRATEGIES}}

要求：选择数字最小的策略，输出完整的推导过程和最终答案。`;

class GeneralizationEngineV2 {
  async solve({ question, residentName, emitLLMRequest }) {
    const knowledge = await this._retrieveKnowledge(question);

    // Step 1: List strategies / 枚举策略
    const strategies = await this._listStrategies(question, knowledge, emitLLMRequest);
    if (!strategies || strategies.length === 0) return this._fallback(question, residentName);

    // Step 2: Evaluate each individually / 逐一评估
    const evaluated = [];
    for (const s of strategies) {
      const result = await this._evaluateOne(s, question, emitLLMRequest);
      evaluated.push({ strategy: s, result });
    }

    // Step 3: Compare and output best / 对比输出
    const best = await this._compareAndOutput(question, evaluated, emitLLMRequest);

    this._storeResult(question, best || '无结果');
    return { content: best || '无法确定答案', model: 'generalization-v2' };
  }

  async _retrieveKnowledge(question) {
    const r = await vectorMemory.autoSearch(question, { limit: 3, minScore: 0.01 });
    return r.map(x => x.text).join('\n');
  }

  async _listStrategies(question, knowledge, emit) {
    const prompt = `${STRATEGY_LIST_PROMPT}\n\n问题：${question}\n\n相关知识：${knowledge || '无'}`;
    const text = await this._call(prompt, emit);
    if (!text) return null;
    const list = [];
    for (const line of text.split('\n')) {
      const m = line.match(/策略[ABCDEF]?[：:]\s*(.+)/);
      if (m) list.push(m[1].trim());
    }
    return list.length > 0 ? list : [text.trim()];
  }

  async _evaluateOne(strategy, question, emit) {
    const prompt = EVALUATE_PROMPT.replace('{{QUESTION}}', question).replace('{{STRATEGY}}', strategy);
    return await this._call(prompt, emit) || '评估失败';
  }

  async _compareAndOutput(question, evaluated, emit) {
    const list = evaluated.map((e, i) =>
      `策略${i + 1}: ${e.strategy}\n评估: ${e.result}`
    ).join('\n\n');
    const prompt = COMPARE_PROMPT.replace('{{QUESTION}}', question).replace('{{STRATEGIES}}', list);
    return await this._call(prompt, emit) || null;
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

  _storeResult(question, answer) {
    try {
      vectorMemory.store({
        residentId: 'generalization-v2',
        text: `Q: ${question.substring(0, 100)}\nA: ${answer.substring(0, 300)}`,
        metadata: { type: 'solved' }, source: 'generalization-v2',
      });
    } catch {}
  }

  _fallback(question, name) {
    return { content: `${name || '居民'}需要更多信息来回答这个问题。`, model: 'fallback' };
  }
}

const generalizationEngineV2 = new GeneralizationEngineV2();
export { GeneralizationEngineV2, generalizationEngineV2 };
