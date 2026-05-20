import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EvolutionMemory } from '../../src/core/evolution-memory.js';
import { generalizationEngineV2 } from '../../src/core/generalization.js';

// ── 泛化准确率测试（N-shape 触觉感知） ──
//
// Benchmark 基准值：由算法实际输出确定，CI 中运行后对比。
// 如需更新基准值，先确认算法正确性，再修改 expected。

const GENERALIZATION_CASES = [
  {
    question: '红色的糖果摸出2个 绿色的糖果摸出8个 蓝色的糖果摸出3个 透明的糖果摸出1个',
    expected: 13,
    label: 'four items, single shape (dim2: 糖果摸出)',
  },
];

describe('Generalization accuracy benchmark', () => {
  for (const c of GENERALIZATION_CASES) {
    test(c.label, async () => {
      const result = await generalizationEngineV2.solve({ question: c.question });
      assert.ok(result.content, 'should return a solution');
      const match = result.content.match(/答案:\s*(\d+)/);
      if (match) {
        const answer = parseInt(match[1]);
        assert.equal(answer, c.expected,
          `expected ${c.expected}, got ${answer} for '${c.question}'`);
      } else {
        // fallback: grab first number
        const n = result.content.match(/(\d+)/);
        if (n) {
          throw new Error(`Answer format unexpected: '${result.content}', num=${n[1]}`);
        }
        throw new Error(`No numeric answer found in: ${result.content}`);
      }
    });
  }

  test('insufficient items returns 无法解析', async () => {
    const r = await generalizationEngineV2.solve({ question: '红色的糖果摸出2个 绿色的糖果摸出3个' });
    assert.ok(r.content.includes('无法解析'));
  });
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
