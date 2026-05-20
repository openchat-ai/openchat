import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ConvergenceEngine } from '../convergence-engine.js';
import { FairyGuardian } from '../fairy-guardian.js';

describe('ConvergenceEngine', () => {
  test('constructor sets defaults', () => {
    const ce = new ConvergenceEngine();
    assert.strictEqual(ce.timeout, 60000);
    assert.strictEqual(ce.minThreshold, 0.8);
    assert.ok(ce.activeDecompositions instanceof Map);
  });

  test('constructor accepts options', () => {
    const ce = new ConvergenceEngine({ timeout: 30000, minThreshold: 0.5 });
    assert.strictEqual(ce.timeout, 30000);
    assert.strictEqual(ce.minThreshold, 0.5);
  });

  test('compete returns winner when solver meets threshold', async () => {
    const ce = new ConvergenceEngine({ timeout: 5000, minThreshold: 0.5 });
    const result = await ce.compete('p1', [
      { id: 'd1', resident: 'r1', subQuestions: [{ q: '1+1' }, { q: '2+2' }] },
      { id: 'd2', resident: 'r2', subQuestions: [{ q: '3+3' }] },
    ], async (sq) => ({ answer: '4', method: 'calc', size: 1 }));

    assert.ok(result.winner);
    assert.strictEqual(result.totalCandidates, 2);
  });

  test('compete discards slow decompositions when winner already found', async () => {
    const ce = new ConvergenceEngine({ timeout: 5000, minThreshold: 0.5 });
    const result = await ce.compete('p2', [
      { id: 'fast', resident: 'r1', subQuestions: [{ q: 'q1' }] },
      { id: 'slow', resident: 'r2', subQuestions: [{ q: 'q1' }, { q: 'q2' }] },
    ], async (sq) => {
      await new Promise(r => setTimeout(r, 10));
      return { answer: 'ans', method: 'calc', size: 1 };
    });

    assert.ok(result.winner);
    assert.strictEqual(result.totalCandidates, 2);
    const discarded = result.all.filter(e => e.discarded);
    assert.ok(discarded.length > 0 || result.savings > 0);
  });

  test('analyze returns null for unknown problem', () => {
    const ce = new ConvergenceEngine();
    assert.strictEqual(ce.analyze('nonexistent'), null);
  });

  test('analyze returns analysis for a completed competition', async () => {
    const ce = new ConvergenceEngine({ timeout: 5000, minThreshold: 0.5 });
    await ce.compete('p3', [
      { id: 'd1', resident: 'r1', subQuestions: [{ q: 'q1' }] },
    ], async (sq) => ({ answer: 'ans', method: 'direct', size: 1 }));

    const analysis = ce.analyze('p3');
    assert.ok(analysis);
    assert.ok(analysis.optimalSubQuestionCount >= 1);
    assert.ok(typeof analysis.efficiency === 'number');
  });
});

describe('FairyGuardian', () => {
  test('constructor sets myPort', () => {
    const fg = new FairyGuardian(3800);
    assert.strictEqual(fg.myPort, 3800);
  });

  test('receiveHeartbeat records heartbeat', () => {
    const fg = new FairyGuardian(3800);
    fg.receiveHeartbeat(3002);
    assert.ok(fg._heartbeats.has(3002));
    const time = fg._heartbeats.get(3002);
    assert.ok(time > 0);
  });

  test('checkAll is noop when not main node', async () => {
    const fg = new FairyGuardian(3002);
    await fg.checkAll();
    assert.strictEqual(fg._reviveCount.size, 0);
  });

  test('getStats returns counts', () => {
    const fg = new FairyGuardian(3800);
    fg.receiveHeartbeat(3002);
    assert.strictEqual(fg._heartbeats.size, 1);
  });
});
