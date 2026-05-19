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
        total += irrelevantCount(s) + 1; // one flavor: wm + 1
      }
      // Add all non-target flavors
      for (let f = 0; f < nF; f++) {
        if (f === iA || f === iB) continue;
        for (let s = 0; s < nS; s++) total += C[f][s];
      }
      if (total < bestFormula) { bestFormula = total; bestSeed = `${dim2[keep]}`; }
    }
    function irrelevantCount(s) {
      for (let f = 0; f < nF; f++) {
        if (f !== iA && f !== iB) return C[f][s];
      }
      return 0;
    }

    // Phase 2: branch & bound search to try beating formula
    // Variables: x[f][s] ∈ [0, C[f][s]]
    // Constraint: no (tA,s1) + (tB,s2) for s1≠s2
    // Objective: maximize sum(x)
    // Bound: formula result
    // All items flattened to 1D array: [x[0][0], x[0][1], ..., x[1][0], ...]
    const totalCells = nF * nS;
    const maxVals = C.flat();                        // max per variable
    const varNames = dim1.flatMap(f => dim2.map(s => `${f}.${s}`));
    const assign = new Array(totalCells).fill(0);   // current assignment
    // Which cell index corresponds to (tA,s) and (tB,s)
    const tACells = dim2.map((_, s) => iA * nS + s);
    const tBCells = dim2.map((_, s) => iB * nS + s);

    let bestFound = bestFormula;
    let bestAssign = assign.slice();

    // Precompute: max possible sum from each position (for bound)
    const suffixMax = new Array(totalCells + 1).fill(0);
    for (let i = totalCells - 1; i >= 0; i--) suffixMax[i] = suffixMax[i + 1] + maxVals[i];

    // Check if current assignment violates any constraint
    function valid() {
      for (let s1 = 0; s1 < nS; s1++) {
        const a = assign[tACells[s1]];
        if (a === 0) continue;
        for (let s2 = 0; s2 < nS; s2++) {
          if (s1 === s2) continue;
          if (assign[tBCells[s2]] > 0) return false;
        }
      }
      return true;
    }

    // DFS with bound
    function dfs(idx, currentSum) {
      if (idx === totalCells) {
        if (currentSum > bestFound) {
          bestFound = currentSum;
          bestAssign = assign.slice();
        }
        return;
      }

      // Bound: if even taking max of all remaining can't beat best, stop
      if (currentSum + suffixMax[idx] <= bestFound) return;

      // Try values high to low (greedy for early good solutions)
      for (let val = maxVals[idx]; val >= 0; val--) {
        assign[idx] = val;
        // Quick constraint check (only cells involving this shape)
        const shapeIdx = idx % nS;
        const flavorIdx = Math.floor(idx / nS);
        let ok = true;
        if (flavorIdx === iA && val > 0) {
          // Check no tB in other shapes
          for (let s = 0; s < nS; s++) {
            if (s === shapeIdx) continue;
            if (assign[tBCells[s]] > 0) { ok = false; break; }
          }
        }
        if (flavorIdx === iB && val > 0) {
          for (let s = 0; s < nS; s++) {
            if (s === shapeIdx) continue;
            if (assign[tACells[s]] > 0) { ok = false; break; }
          }
        }
        if (!ok) continue;
        dfs(idx + 1, currentSum + val);
      }
      assign[idx] = 0;
    }

    dfs(0, 0);

    const answer = bestFound + 1;
    return {
      content: [
        `公式初始界：${bestFormula}`,
        `搜索改进：${bestFound > bestFormula ? '✓ 优于公式' : '= 公式（最优已找到）'}`,
        `答案：${answer}（最大不满足 ${bestFound} + 1）`,
      ].join('\n'),
      model: 'generalization-v2',
    };
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
