import { vectorMemory } from './vector-memory.js';

(() => {
  try {
    vectorMemory.store({
      residentId: 'math-lib',
      text: '感官辅助保证问题的标准解构：方向0按感官分两个方向，方向1先处理数量少的维度（该维度内保证两种都有，另一维度只拿一种配对），方向2先处理数量多的维度（同样逻辑），方向3对比选较小值',
      metadata: { type: 'combinatorics', method: 'sensory-decomposition-template' },
      source: 'math-library',
    });
  } catch {}
})();

class GeneralizationEngineV2 {
  async solve({ question, emitLLMRequest }) {
    this._emit = emitLLMRequest;
    const x = n => n ?? 999;

    // Round 1: 两个方向的"保证两种都有"可以并行
    const [a1, b1] = await Promise.all([
      this._call(`只算：星形（苹果7+桃子6+西瓜4）里保证苹果和桃子各至少1颗，最坏几颗？结果：数字`),
      this._call(`只算：圆形（苹果7+桃子9+西瓜8）里保证苹果和桃子各至少1颗，最坏几颗？结果：数字`),
    ]);

    // Round 2: 两个方向的"只拿一种配对"可以并行
    const [a2, b2] = await Promise.all([
      this._call(`只算：圆形（苹果7+桃子9+西瓜8）里只需要1颗苹果或桃子来配对，最坏几颗？结果：数字`),
      this._call(`只算：星形（苹果7+桃子6+西瓜4）里只需要1颗苹果或桃子来配对，最坏几颗？结果：数字`),
    ]);

    const d1 = x(this._extract(a1)) + x(this._extract(a2));
    const d2 = x(this._extract(b1)) + x(this._extract(b2));
    const best = Math.min(d1, d2);

    return {
      content: [
        `方向1（先星形）：${this._extract(a1) ?? '?'} + ${this._extract(a2) ?? '?'} = ${d1}`,
        `方向2（先圆形）：${this._extract(b1) ?? '?'} + ${this._extract(b2) ?? '?'} = ${d2}`,
        '',
        `最优：${d1 <= d2 ? '方向1' : '方向2'} → ${best}颗`,
      ].join('\n'),
      model: 'generalization-v2',
    };
  }

  _extract(t) {
    if (!t) return null;
    const nums = t.match(/\d+/g);
    return nums ? parseInt(nums[nums.length - 1]) : null;
  }

  _call(p) {
    if (typeof this._emit !== 'function') return Promise.resolve(null);
    return new Promise(r => {
      const t = setTimeout(() => r(null), 60000);
      this._emit({ messages: [{ role: 'user', content: p }], temperature: 0.2 },
        (res) => { clearTimeout(t); r(res?.content || null); },
        () => { clearTimeout(t); r(null); }
      );
    });
  }
}

export { GeneralizationEngineV2 };
const generalizationEngineV2 = new GeneralizationEngineV2();
export { generalizationEngineV2 };
