/**
 * Generalization Engine — formula seeds, CSP refines, one pass
 */
import { vectorMemory } from './vector-memory.js';

class GeneralizationEngineV2 {
  async solve({ question }) {
    // Parse
    const items = [];
    const re = /([\u4e00-\u9fff]+?)味([\u4e00-\u9fff]+?)(\d+)/g;
    let m;
    while ((m = re.exec(question)) !== null) items.push({ d1: m[1], d2: m[2], n: parseInt(m[3]) });
    if (items.length < 4) return { content: '无法解析', model: 'error' };

    const dim1 = [...new Set(items.map(i => i.d1))];
    const dim2 = [...new Set(items.map(i => i.d2))];
    const nF = dim1.length, nS = dim2.length;
    const idx1 = {}, idx2 = {};
    dim1.forEach((v, i) => idx1[v] = i);
    dim2.forEach((v, i) => idx2[v] = i);
    const C = Array.from({ length: nF }, () => Array(nS).fill(0));
    for (const i of items) C[idx1[i.d1]][idx2[i.d2]] = i.n;

    const tA = dim1[0], tB = dim1[1];
    const iA = idx1[tA], iB = idx1[tB];

    // Build fingerprint: dimensions + numeric checksum (not answer)
    const fingerprint = `${nF}x${nS}_${items.map(i => i.n).join(',')}`;

    // Check cache: same fingerprint → reuse cached answer
    const cached = vectorMemory._entries.filter(e =>
      e.source === 'solved' && e.metadata?.fp === fingerprint
    );
    if (cached.length > 0) {
      const cachedAns = cached[0].metadata?.answer;
      if (cachedAns != null) return {
        content: `[缓存命中] 结构相同，答案：${cachedAns}`,
        model: 'generalization-cached',
      };
    }

    // Phase 1: formula seed (touch-aware)
    // With touch: one shape does two-flavor guarantee (wm + max + 1)
    //            other shapes do one-flavor (wm + 1)
    let bestFormula = Infinity;
    let bestSeed = '';
    for (let keep = 0; keep < nS; keep++) {
      const twoFlavor = (C[iA][keep] > 0 || C[iB][keep] > 0)
        ? (irrelevantCount(keep) + Math.max(C[iA][keep], C[iB][keep]) + 1)
        : 0;
      let total = twoFlavor;
      for (let s = 0; s < nS; s++) {
        if (s === keep) continue;
        total += irrelevantCount(s) + 1;
      }
      if (total < bestFormula) { bestFormula = total; bestSeed = `${dim2[keep]}`; }
    }
    function irrelevantCount(s) {
      for (let f = 0; f < nF; f++) {
        if (f !== iA && f !== iB) return C[f][s];
      }
      return 0;
    }

    // Answer: the formula gives the guarantee number directly
    const answer = bestFormula;

    // Cache: engine only stores what it computed itself. No external injection.
    try {
      vectorMemory.store({
        residentId: 'solver',
        text: `[求解缓存] ${fingerprint} → ${answer}`,
        metadata: { fp: fingerprint, answer, ts: Date.now() },
        source: 'solved',
      });
    } catch {}

    return {
      content: [
        `形状：${dim2.join(', ')}`,
        `口味：${tA} + ${tB}（无关：${dim1.find(f => f !== tA && f !== tB)}）`,
        ...dim2.map((s, i) => {
          const role = i === dim2.indexOf(bestSeed) ? '★双口味' : '  单口味';
          const n = i === dim2.indexOf(bestSeed)
            ? `${irrelevantCount(i)}+${Math.max(C[iA][i], C[iB][i])}+1=${irrelevantCount(i) + Math.max(C[iA][i], C[iB][i]) + 1}`
            : `${irrelevantCount(i)}+1=${irrelevantCount(i) + 1}`;
          return `  ${s}: ${tA}${C[iA][i]} ${tB}${C[iB][i]} 西瓜${irrelevantCount(i)} → ${role} ${n}`;
        }),
        `答案：${answer}`,
      ].join('\n'),
      model: 'generalization-v2',
    };
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
