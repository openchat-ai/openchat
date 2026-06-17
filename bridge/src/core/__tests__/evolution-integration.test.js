import { test, describe } from 'node:test';
import assert from 'node:assert';
import { EvolutionEngine } from '../evolution/evolution-engine.js';
import fs from 'fs';
import path from 'path';

describe('EvolutionEngine Integration', () => {
  test('constructor initializes correctly', () => {
    const engine = new EvolutionEngine();
    assert.ok(engine.skillManager, 'skillManager exists');
    assert.ok(engine.experiences !== undefined, 'experiences exists');
  });

  test('add and save skill to disk', async () => {
    const engine = new EvolutionEngine();
    engine.skillManager.addSkill('test-skill-1', {
      name: 'test skill',
      description: 'test',
      code: 'function test() { return true; }',
    });
    await engine.skillManager.saveSkills();

    const skillPath = engine.skillManager.getStoragePath();
    assert.ok(fs.existsSync(skillPath), 'skill file created on disk');

    // cleanup
    try { fs.unlinkSync(skillPath); } catch (e) { console.error('[C0]', e); }
  });

  test('load saved skill', async () => {
    const uid = 'ts-' + Date.now();
    const engine = new EvolutionEngine();
    engine.skillManager.addSkill(uid, {
      name: 'test skill ' + uid,
      description: 'test',
      code: 'function test2() { return false; }',
    });
    await engine.skillManager.saveSkills();

    const engine2 = new EvolutionEngine();
    await engine2.skillManager.loadSkills();

    const skill = engine2.skillManager.getSkill(uid);
    assert.ok(skill, 'loaded skill exists');
    assert.strictEqual(skill.name, 'test skill ' + uid);

    // cleanup
    const skillPath = engine.skillManager.getStoragePath();
    try { fs.unlinkSync(skillPath); } catch (e) { console.error('[C0]', e); }
  });

  test('skill manager tracks skills', () => {
    const engine = new EvolutionEngine();
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
    const engine = new EvolutionEngine();
    await engine.analyzeExperience('test task', 'test result');
    assert.ok(engine.experiences.length >= 1);
  });

  test('empty skill manager returns null', () => {
    const engine = new EvolutionEngine();
    const skill = engine.skillManager.getSkill('nonexistent');
    assert.strictEqual(skill, null);
  });
});
