import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { GeneralizationEngine } from '../generalization.js';

// Clean up persistence
const DATA_DIR = path.join(os.homedir(), '.openchat', 'vector-memory');
try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}

describe('GeneralizationEngine', () => {
  const engine = new GeneralizationEngine();

  describe('_buildExperienceContext', () => {
    test('returns fallback when no experiences', () => {
      const ctx = engine._buildExperienceContext([], 'test');
      assert.ok(ctx.includes('没有找到相关经验'));
    });

    test('formats single experience', () => {
      const exps = [{ text: '测试经验', residentId: 'r1', score: 0.8 }];
      const ctx = engine._buildExperienceContext(exps, 'current');
      assert.ok(ctx.includes('测试经验'));
      assert.ok(ctx.includes('80%'));
    });

    test('formats multiple experiences', () => {
      const exps = [
        { text: '经验A', residentId: 'r1', score: 0.9 },
        { text: '经验B', residentId: 'r2', score: 0.7 },
      ];
      const ctx = engine._buildExperienceContext(exps, 'current');
      assert.ok(ctx.includes('[经验 1]'));
      assert.ok(ctx.includes('[经验 2]'));
      assert.ok(ctx.includes('经验A'));
      assert.ok(ctx.includes('经验B'));
    });
  });

  describe('_parseGeneralizationResult', () => {
    test('handles null content gracefully', () => {
      const result = engine._parseGeneralizationResult({ content: null }, '居民A', '问题');
      assert.ok(result.content.includes('居民A'));
      assert.strictEqual(result.model, 'generalization-empty');
    });

    test('extracts learned pattern when present', () => {
      const llmResult = {
        content: `=== 经验分析 ===\n模式：通用方法\n\n=== 思路 1 ===\n分析：...\n方案：...\n\n=== 选择结果 ===\n最佳思路：1\n理由：最简单\n学到的经验：举一反三很重要`,
      };
      const result = engine._parseGeneralizationResult(llmResult, '居民B', '问题');
      assert.ok(result.learnedPattern.includes('举一反三'));
      assert.strictEqual(result.model, 'generalization');
    });

    test('handles missing learned pattern', () => {
      const llmResult = { content: '简短的直接回答' };
      const result = engine._parseGeneralizationResult(llmResult, '居民C', '问题');
      assert.strictEqual(result.learnedPattern, '');
    });

    test('extracts chosen approach index', () => {
      const llmResult = {
        content: `=== 思路 1 ===分析：方法A\n\n=== 思路 2 ===分析：方法B\n\n=== 选择结果 ===\n最佳思路：2\n理由：更全面`,
      };
      const result = engine._parseGeneralizationResult(llmResult, '居民D', '问题');
      assert.ok(result.content.includes('方法A'));
      assert.ok(result.content.includes('方法B'));
    });
  });

  describe('generalize with mock LLM', () => {
    test('generates solution when LLM responds', async () => {
      const result = await engine.generalize({
        userMessage: '如何学习编程？',
        residentName: '小明',
        residentId: 'r1',
        relatedExperiences: [{ text: 'Python入门', residentId: 'r2', score: 0.8 }],
        emitLLMRequest: (opts, resolve) => {
          resolve({ content: '=== 经验分析 ===\n模式：实践出真知\n\n=== 思路 1 ===\n分析：从基础开始\n方案：看文档\n\n=== 选择结果 ===\n最佳思路：1\n理由：简单\n学到的经验：从实践中学习最有效', model: 'test' });
        },
      });
      assert.ok(result);
      assert.ok(result.content);
      assert.ok(result.learnedPattern);
      assert.strictEqual(result.model, 'generalization');
    });

    test('falls back gracefully when LLM errors', async () => {
      const result = await engine.generalize({
        userMessage: 'test',
        residentName: '居民',
        residentId: 'r1',
        relatedExperiences: [],
        emitLLMRequest: (opts, resolve, reject) => {
          reject(new Error('LLM unavailable'));
        },
      });
      assert.ok(result);
      assert.ok(result.content);
    });

    test('handles empty experiences', async () => {
      const result = await engine.generalize({
        userMessage: 'test',
        residentName: '居民',
        residentId: 'r1',
        relatedExperiences: [],
        emitLLMRequest: (opts, resolve) => {
          resolve({ content: '直接回答', model: 'test' });
        },
      });
      assert.ok(result);
    });
  });
});
