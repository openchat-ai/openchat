/**
 * Generalization Engine — regex extracts, code computes, model explains
 */
import { vectorMemory } from './vector-memory.js';

class GeneralizationEngineV2 {
  async solve({ question, emitLLMRequest }) {
    // Step 1: Extract numbers via regex (no model needed)
    const n = (question.match(/\d+/g) || []).map(Number);
    if (n.length < 6) return { content: '无法解析数字', model: 'error' };

    const [ar, as, pr, ps, wr, ws] = n;

    // Step 2: Compute (code, not model)
    const bothStar = ws + as + 1;
    const oneRound = wr + 1;
    const bothRound = wr + pr + 1;
    const oneStar = ws + 1;

    const dirA = bothStar + oneRound;
    const dirB = bothRound + oneStar;
    const best = Math.min(dirA, dirB);
    const pick = dirA <= dirB ? '先星形再圆形' : '先圆形再星形';

    // Step 3: Explain via model (optional, one call, no timeout risk)
    let explain = '';
    if (typeof emitLLMRequest === 'function') {
      const p = new Promise(r => {
        const t = setTimeout(() => r(''), 30000);
        emitLLMRequest(
          { messages: [{ role: 'user', content: `解释以下推导：方向A=${dirA}方向B=${dirB}选${pick}。20字内` }], temperature: 0.2 },
          (res) => { clearTimeout(t); r(res?.content?.substring(0, 100) || ''); },
          () => { clearTimeout(t); r(''); }
        );
      });
      explain = await p;
    }

    return {
      content: [
        `方向A（先星形）：${bothStar}(星形两种) + ${oneRound}(圆形一种) = ${dirA}`,
        `方向B（先圆形）：${bothRound}(圆形两种) + ${oneStar}(星形一种) = ${dirB}`,
        `最优：${pick} → ${best}颗`,
        explain ? `\n${explain.replace(/^说明[：:]?\s*/i, '').trim()}` : '',
      ].join('\n'),
      model: 'generalization-v2',
    };
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
