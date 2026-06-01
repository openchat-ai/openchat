import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EvolutionEngine } from '../evolution/evolution-engine.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function tmpEngine() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-test-'));
  return new EvolutionEngine(tmpDir);
}

describe('EvolutionEngine Integration', () => {
  test('constructor initializes correctly', () => {
    const engine = tmpEngine();
    assert.ok(engine.skillManager, 'skillManager exists');
    assert.ok(engine.experiences !== undefined, 'experiences exists');
  });

  test('add and save skill to disk', async () => {
    const engine = tmpEngine();
    engine.skillManager.addSkill('test-skill-1', {
      name: 'test skill',
      description: 'test',
      code: 'function test() { return true; }',
    });
    await engine.skillManager.saveSkills();

    const skillPath = engine.skillManager.getStoragePath();
    assert.ok(fs.existsSync(skillPath), 'skill file created on disk');

    // cleanup
    try { fs.rmSync(path.dirname(skillPath), { recursive: true }); } catch { /* noop */ }
  });

  test('load saved skill', async () => {
    const uid = 'ts-' + Date.now();
    const engine = tmpEngine();
    engine.skillManager.addSkill(uid, {
      name: 'test skill ' + uid,
      description: 'test',
      code: 'function test2() { return false; }',
    });
    await engine.skillManager.saveSkills();

    const engine2 = tmpEngine();
    await engine2.skillManager.loadSkills();

    // engine2 can't see engine's skill because they use different temp dirs.
    // That's expected — we just verify loadSkills doesn't crash and returns empty.
    const skill = engine2.skillManager.getSkill(uid);
    assert.strictEqual(skill, null, 'different storage dir: not visible');

    // Verify engine's own skill is loadable from its own dir
    const engineReload = new EvolutionEngine(path.dirname(engine.skillManager.getStoragePath()));
    await engineReload.skillManager.loadSkills();
    const loaded = engineReload.skillManager.getSkill(uid);
    assert.ok(loaded, 'loaded skill exists from same dir');
    assert.strictEqual(loaded.name, 'test skill ' + uid);

    // cleanup
    const skillPath = engine.skillManager.getStoragePath();
    try { fs.rmSync(path.dirname(skillPath), { recursive: true }); } catch { /* noop */ }
  });

  test('skill manager tracks skills', () => {
    const engine = tmpEngine();
    engine.skillManager.addSkill('track-test', {
      name: 'track',
      description: 'test',
      code: 'function t() {}',
    });
    const skill = engine.skillManager.getSkill('track-test');
    assert.ok(skill);
    assert.strictEqual(skill.name, 'track');
  });

  test('analyze experience', async () => {
    const engine = tmpEngine();
    await engine.analyzeExperience('test task', 'test result');
    assert.ok(engine.experiences.length >= 1);
  });

  test('empty skill manager returns null', () => {
    const engine = tmpEngine();
    const skill = engine.skillManager.getSkill('nonexistent');
    assert.strictEqual(skill, null);
  });
});
