/**
 * 泛化求解器 / Generalization Solver
 *
 * 当前求解：两维度保证问题（鸽巢原理类）
 * 解法：CSP 分支定界搜索 + 结构指纹缓存
 * 能力：自提取数字、触觉策略感知、跨形状数自动适配
 * 规划：扩展至更多问题类型
 */
import { vectorMemory } from './vector-memory.js';

class GeneralizationEngineV2 {
  async solve({ question }) {
    // Parse (with input length guard)
    if (question.length > 10000) return { content: '输入过长', model: 'error' };
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

    // Identify target flavors (first two) and irrelevant (third)
    const tA = dim1[0], tB = dim1[1];
    const iA = idx1[tA], iB = idx1[tB];
    const iI = dim1[2] !== undefined ? idx1[dim1[2]] : -1;

    const hasTouch = /手感|分辨|触觉/.test(question);

    // Fingerprint: problem structure, not the answer
    const fp = `${nF}f${nS}s_${items.map(i => i.n).join(',')}_touch${hasTouch ? 1 : 0}`;

    // Cache check
    const cached = vectorMemory._entries.filter(e => e.source === 'solved' && e.metadata?.fp === fp);
    if (cached.length > 0 && cached[0].metadata?.answer != null) {
      return { content: `[缓存] ${cached[0].metadata.answer}`, model: 'solver' };
    }

    // ── Touch-aware formula path ──
    // When user can feel shapes: one shape guarantees both target flavors,
    // other shapes only need to guarantee one target flavor each.
    if (hasTouch) {
      const irr = s => { for (let f = 0; f < nF; f++) { if (f !== iA && f !== iB) return C[f][s]; } return 0; };
      let best = Infinity, choice = '';
      for (let keep = 0; keep < nS; keep++) {
        const two = irr(keep) + Math.max(C[iA][keep], C[iB][keep]) + 1;
        let total = two;
        for (let s = 0; s < nS; s++) { if (s !== keep) total += irr(s) + 1; }
        if (total < best) { best = total; choice = dim2[keep]; }
      }
      const answer = best;
      // Cache
      try {
        vectorMemory.store({
          residentId: 'solver',
          text: `[求解缓存] ${fp} → ${answer}`,
          metadata: { fp, answer, ts: Date.now() },
          source: 'solved',
        });
      } catch (e) { console.error('[Generalization] cache write failed:', e.message); }
      const parts = dim2.map((s, i) => {
        if (i === dim2.indexOf(choice)) return `${s}双全(${irr(i)}+${Math.max(C[iA][i],C[iB][i])}+1)`;
        return `${s}一类(${irr(i)}+1)`;
      });
      return {
        content: [`触觉模式：${parts.join('+')}`, `答案：${answer}`].join('\n'),
        model: 'solver-touch',
      };
    }

    // ── CSP: search for optimal avoiding set ──
    // We need: max items such that no (tA,s1) + (tB,s2) for s1≠s2
    // Then answer = max + 1

    // Decision variables: x[f][s] ∈ [0, C[f][s]]
    // Flattened
    const N = nF * nS;
    const maxV = C.flat();
    let best = -1;

    // Precompute suffix sums for bound
    const suffix = new Array(N + 1).fill(0);
    for (let i = N - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + maxV[i];

    const x = new Array(N).fill(0);

    function check(idx) {
      const s = idx % nS;
      const f = Math.floor(idx / nS);
      if (f === iA && x[idx] > 0) {
        for (let s2 = 0; s2 < nS; s2++) {
          if (s2 === s) continue;
          if (x[iB * nS + s2] > 0) return false;
        }
      }
      if (f === iB && x[idx] > 0) {
        for (let s1 = 0; s1 < nS; s1++) {
          if (s1 === s) continue;
          if (x[iA * nS + s1] > 0) return false;
        }
      }
      return true;
    }

    function dfs(pos, sum) {
      if (pos === N) {
        if (sum > best) best = sum;
        return;
      }
      if (sum + suffix[pos] <= best) return;
      for (let v = maxV[pos]; v >= 0; v--) {
        x[pos] = v;
        if (!check(pos)) continue;
        dfs(pos + 1, sum + v);
      }
      x[pos] = 0;
    }

    dfs(0, 0);
    const answer = best + 1;

    // Cache
    try {
      vectorMemory.store({
        residentId: 'solver',
        text: `[求解缓存] ${fp} → ${answer}`,
        metadata: { fp, answer, ts: Date.now() },
        source: 'solved',
      });
    } catch (e) {
      console.error('[Generalization] cache write failed:', e.message);
    }

    return {
      content: [
        `Forge 求解（${nF}口味 × ${nS}形状）`,
        `搜索空间：${N} 个变量`,
        `最大不满足：${best} → 保证：${answer}`,
      ].join('\n'),
      model: 'forge',
    };
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
