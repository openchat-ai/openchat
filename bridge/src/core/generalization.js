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

    const results = shapes.map(s => ({
      ...s,
      two: s.wm + Math.max(s.apple, s.peach) + 1,
      one: s.wm + 1,
    }));

    let best = Infinity, bestA = '', bestB = '';
    const pairs = [];
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const a = results[i], b = results[j];
        const d1 = a.two + b.one;
        const d2 = b.two + a.one;
        const m = Math.min(d1, d2);
        pairs.push({ a: a.name, b: b.name, d1, d2, best: m });
        if (m < best) { best = m; bestA = a.name; bestB = b.name; }
      }
    }

    return {
      content: [
        '=== 各形状 ===',
        ...results.map(s => `  ${s.name}: 苹果${s.apple} 桃${s.peach} 西瓜${s.wm} → 两种=${s.two} 一种=${s.one}`),
        '', '=== 配对对比 ===',
        ...pairs.map(p => `  ${p.a}+${p.b}: ${p.d1}/${p.d2} → ${p.best}`),
        '', `最优：${bestA}+${bestB} → ${best}颗`,
      ].join('\n'),
      model: 'generalization-v2',
    };
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
