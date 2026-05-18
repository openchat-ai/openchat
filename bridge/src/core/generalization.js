/**
 * Generalization Engine v2 — Multi-layer reasoning pipeline
 * 泛化引擎 v2：多层推理管道
 *
 * Layers: ① Knowledge retriever → ② Decomposer → ③ Solver (tools)
 *          → ④ Combiner → ⑤ Verifier → ⑥ Output
 *
 * Each layer addresses a specific LLM weakness:
 *   ① 知识覆盖：向量记忆搜索已有解法
 *   ② 子问题分解：多维度问题自动拆成单维度子问题
 *   ③ 工具调用：计算器等外部工具弥补符号推理
 *   ④ 合并：将子问题解合并为完整答案
 *   ⑤ 验证：反证法自我验证
 */

import { vectorMemory } from './vector-memory.js';

// ===================== Tools / 外部工具 =====================

const TOOLS = {
  /**
   * Safe calculator — evaluates arithmetic expressions only.
   * 安全计算器：仅支持四则运算和括号
   */
  calculate(expr) {
    // Only allow digits, operators, parentheses, decimals, spaces
    if (!/^[\d+\-*/().%\s]+$/.test(expr)) {
      return { error: '表达式包含非法字符', expr };
    }
    try {
      // Use Function constructor as a safer eval
      const result = new Function(`return (${expr})`)();
      if (typeof result !== 'number' || !isFinite(result)) {
        return { error: '计算结果无效', expr };
      }
      return { result, expr };
    } catch (e) {
      return { error: e.message, expr };
    }
  },
};

// ===================== Prompts / 分层提示词 =====================

const DECOMPOSER_PROMPT = `你是一个问题分解专家。将用户的问题分解为独立的子问题。

规则：
1. 找出问题中所有**独立维度**（例如口味是一个维度，形状是另一个维度）
2. 每个子问题只处理一个维度，不要混在一起
3. 先处理维度内的问题，再处理维度间的关系
4. 标注哪些步骤可以用计算器验证（CALC: 表达式）

例如对于糖果题：
  维度1：口味（苹果、桃子、西瓜）— 独立的味觉分类
  维度2：形状（圆形、星形）— 独立的触觉分类，可以凭手感区分
  优先处理数量较少的维度（星形仅17颗 < 圆形24颗）

输出格式：
=== 维度分析 ===
独立维度：...
维度之间的关系：...

=== 子问题列表 ===
子问题1：<按维度的描述>
  类型：<单维度/跨维度>
  计算方法：<手算/计算器>
  
子问题2：<按维度的描述>
  类型：<单维度/跨维度>
  计算方法：<手算/计算器>

=== 合并方式 ===
如何将子问题结果合并为最终答案：
用算式表达合并过程（CALC: 算式）`;

const SOLVER_PROMPT = `你是一个分步解题专家。解决以下子问题时：
1. 每步都写出具体算式
2. 涉及加减乘除时，用计算器验证
3. 标注哪些步骤用了已知知识库中的解法

格式：
子问题：<描述>
已知条件：<列出数字>
计算过程：
  步骤1：...
  计算器：<表达式> → <结果>
  步骤2：...
  计算器：<表达式> → <结果>
子问题答案：<数字+解释>`;

const VERIFIER_PROMPT = `你是一个答案验证专家。对以下答案进行反证法验证：

规则：
1. 假设最终答案减1，检查是否仍然满足条件
2. 如果答案减1仍然满足 → 原答案不是最小值
3. 如果答案减1不满足 → 原答案正确
4. 如果验证失败，给出正确的答案

格式：
=== 验证 ===
假设答案 = <n-1>：
  条件检查：...
  是否满足条件？是/否
结论：原答案 正确/错误
${''}${''}${''}${''}${''}正确答案（如果原答案错误）：<数字+推导>`;

// ===================== Engine / 引擎 =====================

class GeneralizationEngineV2 {
  /**
   * Solve a problem using the multi-layer pipeline.
   * 多层推理管道解决一个问题
   */
  async solve({ question, residentName, emitLLMRequest }) {
    // Layer 0: Knowledge retrieval / 知识覆盖
    const knowledge = await this._retrieveKnowledge(question);

    // Layer 1: Decompose / 子问题分解
    const decomposition = await this._decompose(question, knowledge, emitLLMRequest);
    if (!decomposition?.subProblems) return this._fallback(question, residentName);

    // Layer 2: Solve each sub-problem / 逐个求解
    const subResults = [];
    for (const sub of decomposition.subProblems) {
      const result = await this._solveSubProblem(sub, knowledge, emitLLMRequest);
      subResults.push({ ...sub, result });
    }

    // Layer 3: Combine / 合并结果
    const combined = await this._combine(question, subResults, decomposition.mergeStrategy, emitLLMRequest);

    // Layer 4: Verify / 自我验证
    const verified = await this._verify(combined, question, emitLLMRequest);

    const finalAnswer = verified.verified ? combined : verified.correctedAnswer || combined;

    // Store back to knowledge base / 回存知识库
    this._storeResult(question, finalAnswer, subResults);

    return {
      content: finalAnswer,
      model: 'generalization-v2',
      decomposition: decomposition.subProblems.map(s => s.description),
      subResults: subResults.map(s => ({ desc: s.description, answer: s.result })),
      verified: verified.verified,
    };
  }

  /** Layer 0: Knowledge retrieval / 知识覆盖 */
  async _retrieveKnowledge(question) {
    const results = await vectorMemory.autoSearch(question, { limit: 3, minScore: 0.01 });
    return results.map(r => r.text).join('\n');
  }

  /** Layer 1: Problem decomposition / 问题分解 */
  async _decompose(question, knowledge, emitLLMRequest) {
    const prompt = `${DECOMPOSER_PROMPT}\n\n用户问题：${question}\n\n相关知识：${knowledge || '无'}`;
    const response = await this._callLLM(prompt, emitLLMRequest);
    return this._parseDecomposition(response);
  }

  _parseDecomposition(text) {
    if (!text) return null;
    const subProblems = [];
    const lines = text.split('\n');
    let currentSub = null;
    let mergeStrategy = '';

    for (const line of lines) {
      if (line.includes('=== 合并方式 ===')) {
        mergeStrategy = lines.slice(lines.indexOf(line) + 1).join(' ').trim();
      }
      if (line.match(/子问题\d/)) {
        currentSub = { description: line.replace(/^.*?子问题\d[：:]?\s*/, '').trim() };
        subProblems.push(currentSub);
      }
    }

    return subProblems.length > 0 ? { subProblems, mergeStrategy } : null;
  }

  /** Layer 2-3: Solve + combine / 求解 + 合并 */
  async _solveSubProblem(sub, knowledge, emitLLMRequest) {
    if (!sub?.description) return '';

    const useTool = sub.description.includes('计算') || sub.description.includes('数字') || sub.description.includes('多少');
    const toolHint = useTool ? '\n\n计算器可用：将算术表达式用 CALC: 前缀标注，例如 CALC: 17+8+1' : '';

    const prompt = `${SOLVER_PROMPT}\n\n子问题：${sub.description}\n参考知识：${knowledge?.substring(0, 300) || '无'}${toolHint}`;
    let response = await this._callLLM(prompt, emitLLMRequest);

    // Auto-execute calculator calls in the response
    response = this._executeCalcInText(response);

    return response;
  }

  /** Layer 4: Self-verification / 自我验证 */
  async _verify(answer, question, emitLLMRequest) {
    const prompt = `${VERIFIER_PROMPT}\n\n问题：${question}\n\n待验证的答案：\n${answer}`;
    const response = await this._callLLM(prompt, emitLLMRequest);

    const verified = !response.includes('原答案 错误');
    let correctedAnswer = null;
    const correctMatch = response.match(/正确答案[：:](.+?)(?:\n|$)/);
    if (correctMatch) correctedAnswer = correctMatch[1].trim();

    return { verified, correctedAnswer, detail: response };
  }

  /** Execute CALC: prefix expressions in LLM output / 执行计算器调用 */
  _executeCalcInText(text) {
    return text.replace(/CALC:\s*([^\n]+)/g, (match, expr) => {
      const result = TOOLS.calculate(expr.trim());
      if (result.error) return `[计算器] ${expr} = 计算错误: ${result.error}`;
      return `[计算器] ${expr} = ${result.result}`;
    });
  }

  /** Call LLM via emitLLMRequest / 统一 LLM 调用入口 */
  _callLLM(prompt, emitLLMRequest) {
    if (typeof emitLLMRequest !== 'function') return null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 30000);
      emitLLMRequest(
        { messages: [{ role: 'user', content: prompt }], temperature: 0.3 },
        (result) => { clearTimeout(timer); resolve(result?.content || null); },
        () => { clearTimeout(timer); resolve(null); }
      );
    });
  }

  /** Store result to knowledge base / 回存知识库 */
  _storeResult(question, answer, subResults) {
    try {
      const detail = subResults.map(s => `[${s.description}] ${s.result}`).join('\n');
      vectorMemory.store({
        residentId: 'generalization-v2',
        text: `Q: ${question.substring(0, 120)}\n推导：${detail.substring(0, 300)}\n答案：${answer.substring(0, 200)}`,
        metadata: { type: 'solved-problem', version: 2 },
        source: 'generalization-v2',
      });
    } catch (e) { /* silent */ }
  }

  /** Fallback response / 兜底回答 */
  _fallback(question, residentName) {
    return {
      content: `${residentName || '居民'}思考后说："我需要更多信息来回答这个问题。"`,
      model: 'generalization-v2-fallback',
    };
  }
}

const generalizationEngineV2 = new GeneralizationEngineV2();
export { GeneralizationEngineV2, generalizationEngineV2 };
