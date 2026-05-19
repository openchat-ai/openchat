/**
 * Generalization Engine — N-shape general solver
 * N 种形状通用保证问题求解器
 *
 * For each shape: compute two/free → pair all shapes → min
 */
import { vectorMemory } from './vector-memory.js';

class GeneralizationEngineV2 {
  async solve({ question, emitLLMRequest }) {
    const nums = (question.match(/\d+/g) || []).map(Number);
    const nShapes = nums.length / 3; // 6→2 shapes, 9→3 shapes, etc
    if (nShapes < 2 || nShapes !== Math.floor(nShapes)) return { content: '无法解析形状数量', model: 'error' };

    const names = ['圆形', '星形', '方形', '三角形', '心形', '菱形']; // extendable
    const shapes = [];
    for (let s = 0; s < nShapes; s++) {
      shapes.push({
        name: names[s],
        apple: nums[s],
        peach: nums[s + nShapes],
        wm: nums[s + nShapes * 2],
      });
    }

    // Compute: pick ONE shape for "two flavors", rest get "one flavor"
    // Must cover ALL shapes, can't skip any
    const results = shapes.map(s => ({
      ...s,
      two: s.wm + Math.max(s.apple, s.peach) + 1,
      one: s.wm + 1,
    }));

    let best = Infinity, bestIdx = -1;
    for (let i = 0; i < results.length; i++) {
      let total = results[i].two;
      for (let j = 0; j < results.length; j++) {
        if (j !== i) total += results[j].one;
      }
      if (total < best) { best = total; bestIdx = i; }
    }

    const lines = results.map((s, i) => {
      const isBest = i === bestIdx;
      const label = isBest ? '★ 两种' : '   一种';
      return `  ${s.name}: 苹果${s.apple} 桃${s.peach} 西瓜${s.wm} → ${label}=${isBest ? s.two : s.one}`;
    });

    return {
      content: [
        '=== 各形状 ===',
        ...lines,
        '',
        `最优：先保${results[bestIdx].name}两种(=${results[bestIdx].two})，`,
        ...results.filter((_, i) => i !== bestIdx).map(s => `  再保${s.name}一种(=${s.one})`),
        `合计：${best}颗`,
      ].join('\n'),
      model: 'generalization-v2',
    };
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
