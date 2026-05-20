import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { VectorMemory } from '../vector-memory.js';

// Clear any persisted state between runs
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
const DATA_FILE = path.join(os.homedir(), '.openchat', 'vector-memory', 'vectors.json');
try { fs.rmSync(path.dirname(DATA_FILE), { recursive: true, force: true }); } catch {}

describe('VectorMemory', () => {
  const vm = new VectorMemory();

  after(() => {
    // Don't persist test data
    vm._entries = [];
    vm._idf = {};
  });

  describe('store', () => {
    test('stores with Chinese text', () => {
      const id = vm.store({ residentId: 'r1', text: '我喜欢吃辣椒炒肉' });
      assert.ok(id);
      assert.strictEqual(vm._entries.length, 1);
    });

    test('stores with English text', () => {
      vm.store({ residentId: 'r2', text: 'I enjoy cooking spicy food' });
      assert.strictEqual(vm._entries.length, 2);
    });

    test('stores metadata', () => {
      vm.store({ residentId: 'r1', text: 'test', metadata: { type: 'preference' } });
      const entry = vm._entries[vm._entries.length - 1];
      assert.strictEqual(entry.metadata.type, 'preference');
      assert.strictEqual(entry.source, 'conversation');
    });

    test('supports custom source', () => {
      vm.store({ residentId: 'r1', text: 'custom source', source: 'thought' });
      const entry = vm._entries[vm._entries.length - 1];
      assert.strictEqual(entry.source, 'thought');
    });
  });

  describe('search', () => {
    before(() => {
      vm._entries = [];
      vm._idf = {};
      vm.store({ residentId: 'r1', text: '辣椒炒肉需要五花肉和青椒' });
      vm.store({ residentId: 'r1', text: '我喜欢吃辣的食物' });
      vm.store({ residentId: 'r2', text: '编程最好的语言是JavaScript' });
      vm.store({ residentId: 'r2', text: 'Python很适合数据科学' });
    });

    test('finds semantically related Chinese text', () => {
      const results = vm.search('美食 辣');
      assert.ok(results.length >= 1);
      assert.ok(results[0].score > 0);
    });

    test('returns empty for unrelated query', () => {
      const results = vm.search('quantum physics', { minScore: 0.1 });
      assert.strictEqual(results.length, 0);
    });

    test('search by resident filters correctly', () => {
      const results = vm.searchByResident('r2', '语言');
      assert.ok(results.length >= 1);
      results.forEach(r => assert.strictEqual(r.residentId, 'r2'));
    });

    test('search returns scored results', () => {
      const results = vm.search('辣');
      assert.ok(results.every(r => typeof r.score === 'number'));
    });

    test('search with limit', () => {
      const results = vm.search('i', { limit: 1 });
      assert.ok(results.length <= 1);
    });

    test('search empty query returns nothing', () => {
      const results = vm.search('');
      assert.strictEqual(results.length, 0);
    });
  });

  describe('getResidentEntries', () => {
    test('returns entries for specific resident', () => {
      const entries = vm.getResidentEntries('r1');
      assert.ok(entries.length > 0);
      assert.ok(entries.every(e => e.residentId === 'r1'));
    });

    test('returns empty for unknown resident', () => {
      assert.strictEqual(vm.getResidentEntries('ghost').length, 0);
    });
  });

  describe('getStats', () => {
    test('returns correct stats', () => {
      const stats = vm.getStats();
      assert.ok(stats.totalEntries > 0);
      assert.ok(stats.totalResidents > 0);
      assert.ok(stats.uniqueTokens > 0);
    });
  });
});
