/**
 * Generalization Engine — zero hardcoded names
 * 完全通用：口味名、形状名全部从题目自动提取
 */
import { vectorMemory } from './vector-memory.js';

class GeneralizationEngineV2 {
  async solve({ question, emitLLMRequest }) {
    // Extract all (flavor, shape, count) triples
    // Pattern: "苹果味圆形7" → flavor=苹果, shape=圆形, count=7
    const triples = [];
    const re = /([\u4e00-\u9fff]+?)味([\u4e00-\u9fff]+?)(\d+)/g;
    let m;
    while ((m = re.exec(question)) !== null) {
      triples.push({ flavor: m[1], shape: m[2], count: parseInt(m[3]) });
    }
    if (triples.length < 6) return { content: '无法解析', model: 'error' };

    // Dynamically identify flavors and shapes
    const flavors = [...new Set(triples.map(t => t.flavor))];
    const shapes = [...new Set(triples.map(t => t.shape))];
    const nFlavors = flavors.length;
    const nShapes = shapes.length;

    // Identify target pair: flavors mentioned near "保证...和..."
    const targetRe = new RegExp(`保证[^。]*?(${flavors.join('|')})[^。]*?和[^。]*?(${flavors.join('|')})`);
    const targetMatch = question.match(targetRe);
    let targets = [flavors[0], flavors[1]];
    if (targetMatch) targets = [targetMatch[1], targetMatch[2]];
    const irrelevant = flavors.find(f => !targets.includes(f));

    // Build flavor×shape matrix
    const matrix = {};
    for (const f of flavors) matrix[f] = {};
    for (const s of shapes) for (const f of flavors) matrix[f][s] = 0;
    for (const t of triples) matrix[t.flavor][t.shape] = t.count;

    // For each shape: compute two-flavor and one-flavor costs
    const shapeData = shapes.map(name => {
      const irCount = matrix[irrelevant][name];
      const maxTarget = Math.max(...targets.map(t => matrix[t][name]));
      return { name, irCount, maxTarget };
    });

    // Try each shape for "two flavors", rest get "one flavor"
    let best = Infinity, bestI = -1;
    for (let i = 0; i < nShapes; i++) {
      const two = shapeData[i].irCount + shapeData[i].maxTarget + 1;
      let total = two;
      for (let j = 0; j < nShapes; j++) {
        if (j !== i) total += shapeData[j].irCount + 1;
      }
      if (total < best) { best = total; bestI = i; }
    }

    // Format output
    const header = `${targets.join('+')}（无关：${irrelevant}）`;
    const lines = shapeData.map((s, i) => {
      const counts = targets.map(t => `${t}${matrix[t][s.name]}`).concat(`${irrelevant}${matrix[irrelevant][s.name]}`).join(' ');
      const cost = i === bestI ? `★两类=${s.irCount}+${s.maxTarget}+1=${s.irCount + s.maxTarget + 1}` : `一类=${s.irCount}+1=${s.irCount + 1}`;
      return `  ${s.name}: ${counts} → ${cost}`;
    });

    return {
      content: [header, ...lines, '', `最优：${best}`].join('\n'),
      model: 'generalization-v2',
    };
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
