import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evomem-test-'));
process.env.USERPROFILE = tmpDir;
process.env.HOME = tmpDir;

const { EvolutionMemory } = await import('../evolution-memory.js');

describe('EvolutionMemory', () => {
  let mem;

  before(() => {
    mem = new EvolutionMemory();
    mem.clear();
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe('remember / recall', () => {
    test('remember stores and recall retrieves by key', () => {
      mem.remember('color', 'blue', { scope: 'prefs' });
      const result = mem.recall('prefs:color');
      assert.ok(result);
      assert.strictEqual(result.value, 'blue');
      assert.strictEqual(result.scope, 'prefs');
    });

    test('recall returns null for non-existent key', () => {
      assert.strictEqual(mem.recall('nonexistent'), null);
    });

    test('remember with no scope uses _default scope', () => {
      mem.remember('greeting', 'hello');
      assert.strictEqual(mem.recall('_default:greeting').value, 'hello');
    });

    test('remember stores metadata', () => {
      mem.remember('user', 'alice', { scope: 'users', role: 'admin' });
      assert.strictEqual(mem.recall('users:user').metadata.role, 'admin');
    });
  });

  describe('forget', () => {
    test('forget removes entry and returns true', () => {
      mem.remember('temp', 'data', { scope: 'test' });
      assert.ok(mem.recall('test:temp'));
      assert.strictEqual(mem.forget('test:temp'), true);
      assert.strictEqual(mem.recall('test:temp'), null);
    });

    test('forget non-existent key returns false', () => {
      assert.strictEqual(mem.forget('ghost-key'), false);
    });
  });

  describe('search', () => {
    before(() => {
      mem.remember('apple', 'fruit', { scope: 'food' });
      mem.remember('banana', 'yellow fruit', { scope: 'food' });
      mem.remember('car', 'vehicle', { scope: 'transport' });
      mem.remember('apple-pie', 'dessert', { scope: 'recipes' });
    });

    test('search by key prefix', () => {
      const results = mem.search('apple');
      assert.ok(results.length >= 2);
    });

    test('search by value content', () => {
      const results = mem.search('fruit');
      assert.ok(results.length >= 2);
    });

    test('search with scope filter', () => {
      const results = mem.search('apple', { scope: 'food' });
      results.forEach(r => assert.ok(r.key.startsWith('food:')));
    });

    test('search with limit', () => {
      const limited = mem.search('a', { limit: 1 });
      assert.strictEqual(limited.length, 1);
    });

    test('search non-matching returns empty', () => {
      assert.strictEqual(mem.search('xyznonexistent').length, 0);
    });
  });

  describe('getAllKeys / getStats', () => {
    test('getAllKeys returns scoped keys', () => {
      const keys = mem.getAllKeys();
      assert.ok(keys.length > 0);
      assert.ok(keys.some(k => k.includes(':')));
    });

    test('getStats returns count and keys', () => {
      const stats = mem.getStats();
      assert.strictEqual(stats.keys.length, stats.totalMemories);
    });
  });

  describe('progress tracking', () => {
    test('rememberProgress stores and getProgress retrieves', () => {
      mem.rememberProgress('task-1', 'in-progress', { step: 1 });
      const result = mem.getProgress('task-1');
      assert.ok(result);
      assert.strictEqual(result.value.status, 'in-progress');
    });

    test('updateProgress merges details', () => {
      mem.updateProgress('task-1', 'halfway', { step: 2, percent: 50 });
      const progress = mem.getProgress('task-1');
      assert.strictEqual(progress.value.status, 'halfway');
      assert.strictEqual(progress.value.details.step, 2);
      assert.strictEqual(progress.value.details.percent, 50);
    });

    test('updateProgress creates entry if not exists', () => {
      mem.updateProgress('new-task', 'started', { initial: true });
      assert.strictEqual(mem.getProgress('new-task').value.status, 'started');
    });
  });

  describe('clear', () => {
    test('clear removes all entries', () => {
      mem.remember('pre-clear', 'data');
      mem.clear();
      assert.strictEqual(mem.getStats().totalMemories, 0);
    });
  });
});
