/**
 * AI 居民评估基准
 * 运行: node --test tests/benchmarks/resident-benchmarks.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { generalizationEngineV2 } from '../../src/core/generalization.js';
import { EvolutionMemory } from '../../src/core/evolution-memory.js';

// ── 泛化准确率测试（N-shape 触觉感知） ──
const GENERALIZATION_CASES = [
  { question: '红色的糖果摸出4个 绿色的糖果摸出7个 蓝色的糖果摸出1个', min: null, max: null, label: 'single shape answer exists' },
];

describe('Generalization accuracy benchmark', () => {
  for (const c of GENERALIZATION_CASES) {
    test(c.label, async () => {
      const result = await generalizationEngineV2.solve({ question: c.question });
      assert.ok(result.content, 'should return a solution');
      if (c.min !== null) {
        const match = result.content.match(/(\d+)/);
        if (match) {
          const answer = parseInt(match[1]);
          assert.ok(answer >= c.min, `answer ${answer} >= min ${c.min}`);
          if (c.max) assert.ok(answer <= c.max, `answer ${answer} <= max ${c.max}`);
        }
      }
    });
  }
});

// ── VectorMemory 检索质量 ──
describe('VectorMemory recall/MAP benchmark', () => {
  const mem = new EvolutionMemory();

  test('recall returns stored value', () => {
    mem.remember('test_benchmark', 'benchmark data', { scope: 'bench' });
    const r = mem.recall('bench:test_benchmark');
    assert.ok(r, 'recall should return stored entry');
    assert.strictEqual(r.value, 'benchmark data');
  });

  test('search returns relevant results', () => {
    mem.clear();
    mem.remember('apple', 'a fruit', { scope: 'food' });
    mem.remember('car', 'a vehicle', { scope: 'transport' });
    const results = mem.search('fruit');
    assert.ok(results.length >= 1);
    assert.ok(results.some(r => r.value?.includes('fruit')));
  });

  test('search with scope isolation', () => {
    const results = mem.search('apple', { scope: 'food' });
    results.forEach(r => assert.ok(r.key.startsWith('food:')));
  });
});
