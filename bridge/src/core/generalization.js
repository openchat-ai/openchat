/**
 * Generalization Engine — Learn from past experiences to solve NEW problems
 * 泛化引擎：从已有经验中学习，解决新的问题
 *
 * Core idea: When a resident encounters a problem, search vector memory for
 * similar problems solved by ANY resident, then use the LLM to:
 *   1. Analyze common patterns across past solutions
 *      (从多个经验中归纳通用模式)
 *   2. Adapt those patterns to the current context
 *      (将模式适配到当前场景)
 *   3. Generate multiple novel approaches that go beyond copy-paste
 *      (生成不止一种新解法)
 *
 * This is the "泛化" (generalization) layer—the leap from "find similar"
 * (vector DB) to "learn and create new" (this engine).
 *
 * Depends on: vectorMemory (resident-manager), multi-path LLM prompt
 */
import { vectorMemory } from './vector-memory.js';

// System prompt that teaches the LLM HOW to generalize
// 引导 LLM 从具体经验中抽象出通用原理
const GENERALIZATION_SYSTEM_PROMPT = `你是 OpenChat 社区的一位 AI 居民。你有一个独特的能力：从过去的经验中学习，解决新的问题。

你的任务：
1. 阅读下面提供的"相关经验"——其他居民解决类似问题时留下的记录
2. 从这些经验中**提炼出通用原理**（不照抄具体步骤）
3. 针对当前问题，生成至少 3 个不同角度的解法
4. 评估每个解法的可行性
5. 选择最佳方案，说明理由

注意：不要直接复制别人的答案。要从别人的经验中学习模式，创造自己的方案。

输出格式：
=== 经验分析 ===
从相关经验中提炼的共同模式：...

=== 思路 1：<标题> ===
分析：...
方案：...

=== 思路 2：<标题> ===
分析：...
方案：...

=== 思路 3：<标题> ===
分析：...
方案：...

=== 评估 ===
| 思路 | 可行性 | 风险 | 创新度 |
|------|--------|------|--------|
| 1 | 高/中/低 | ... | ... |
| 2 | 高/中/低 | ... | ... |
| 3 | 高/中/低 | ... | ... |

=== 选择结果 ===
最佳思路：1/2/3
理由：...
学到的经验（将被存入知识库供其他居民参考）：...`;

class GeneralizationEngine {
  /**
   * Generalize: given a problem and related experiences, generate adapted solutions.
   * 泛化入口：给定问题 + 相关经验，生成适配的新解法
   *
   * @param {object} ctx - Context object with:
   *   - userMessage: string - the user's question
   *   - residentName: string - current resident's name
   *   - residentId: string|number - current resident's ID
   *   - relatedExperiences: Array<{text, residentId, score}> - from vectorMemory.search()
   *   - emitLLMRequest: function(messages, resolve, reject) - sends to LLM provider
   *   - model: string - LLM model name
   *   - temperature: number
   * @returns {object} { content, model, learnedPattern }
   */
  async generalize(ctx) {
    const {
      userMessage,
      residentName = '居民',
      residentId,
      relatedExperiences = [],
      emitLLMRequest,
      model = '',
      temperature = 0.7,
    } = ctx;

    // Build context from related experiences
    const expContext = this._buildExperienceContext(relatedExperiences, residentName);

    const messages = [
      { role: 'system', content: GENERALIZATION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `当前居民：${residentName}
当前问题：${userMessage}

${expContext}`,
      },
    ];

    // Call LLM (via the same mechanism as _multiPathThink)
    const llmResult = await this._callLLM(messages, emitLLMRequest, model, temperature);

    // Parse the result to extract the chosen solution + learned pattern
    const parsed = this._parseGeneralizationResult(llmResult, residentName, userMessage);

    // Store the learned pattern back to vector memory for future residents
    if (parsed.learnedPattern && parsed.learnedPattern.length > 10) {
      try {
        vectorMemory.store({
          residentId: String(residentId ?? 'generalized'),
          text: `[泛化] 问题：${userMessage}\n学到的经验：${parsed.learnedPattern}\n方案：${parsed.content.substring(0, 200)}`,
          metadata: { type: 'generalized', source: residentName },
          source: 'generalization',
        });
        vectorMemory.save();
      } catch (e) {
        // silent - storage should not block response
      }
    }

    return parsed;
  }

  /**
   * Build the experience context section for the LLM prompt.
   * 构建"相关经验"段落供 LLM 学习
   */
  _buildExperienceContext(experiences, currentName) {
    if (!experiences || experiences.length === 0) {
      return '（没有找到相关经验，请凭你的知识直接回答）';
    }

    const lines = experiences.map((exp, i) => {
      const owner = exp.residentId === currentName ? '自己' : `居民 ${exp.residentId?.toString().slice(0, 8) || '?'}`;
      return `[经验 ${i + 1}] (来自${owner}, 相关度 ${(exp.score * 100).toFixed(0)}%)\n${exp.text.substring(0, 300)}`;
    });

    return `以下是其他居民解决类似问题时留下的经验。请学习其中的模式，但不要直接复制：\n\n${lines.join('\n\n')}`;
  }

  /**
   * Call LLM using the same mechanism as resident-manager.
   * 通过 resident-manager 的相同机制调用 LLM
   */
  async _callLLM(messages, emitLLMRequest, model, temperature) {
    if (typeof emitLLMRequest === 'function') {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({ content: null, model: 'timeout' });
        }, 20000);

        emitLLMRequest({ messages, model, temperature }, (result) => {
          clearTimeout(timer);
          resolve(result);
        }, () => {
          clearTimeout(timer);
          resolve({ content: null, model: 'error' });
        });
      });
    }

    // Fallback: return null content (caller handles gracefully)
    return { content: null, model: 'no-provider' };
  }

  /**
   * Parse the LLM's response into structured result.
   * 解析 LLM 响应为结构化结果
   */
  _parseGeneralizationResult(llmResult, residentName, userMessage) {
    const content = llmResult?.content;
    if (!content) {
      return {
        content: `${residentName} 思考了一会，说："这个问题我需要更多信息才能给出好的方案。"`,
        model: 'generalization-empty',
        learnedPattern: '',
      };
    }

    // Extract the "学到的经验" section for knowledge storage
    const learnedMatch = content.match(/学到的经验[：:](.+?)(?:\n|$)/);
    const learnedPattern = learnedMatch ? learnedMatch[1].trim() : '';

    // Extract the chosen solution
    const choiceMatch = content.match(/最佳思路[：:]\s*(\d+)/);
    const chosenIndex = choiceMatch ? parseInt(choiceMatch[1]) : null;

    // Build a clean output
    let finalContent;
    if (chosenIndex) {
      // Include full analysis but highlight the chosen one
      finalContent = `${residentName} 基于过去的经验进行了泛化分析：\n\n${content}`;
    } else {
      finalContent = `${residentName} 说：\n\n${content}`;
    }

    return {
      content: finalContent,
      model: 'generalization',
      learnedPattern,
      rawContent: content,
    };
  }
}

const generalizationEngine = new GeneralizationEngine();
export { GeneralizationEngine, generalizationEngine };
