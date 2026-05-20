import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EvolutionEngine } from '../evolution/evolution-engine.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-int-'));
const origCwd = process.cwd();

describe('EvolutionEngine integration', () => {
  before(() => {
    process.chdir(tmpDir);
  });

  after(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('initializes with skillManager and experiences', () => {
    const engine = new EvolutionEngine();
    assert.ok(engine.skillManager);
    assert.ok(engine.experiences !== undefined);
  });

  test('adds and saves a skill to disk', async () => {
    const engine = new EvolutionEngine();
    engine.skillManager.addSkill('test-skill-1', {
      name: 'test skill',
      description: 'a test skill',
      code: 'function test() { return true; }',
    });
    await engine.skillManager.saveSkills();
    const skillPath = engine.skillManager.getStoragePath();
    assert.ok(fs.existsSync(skillPath));
  });

  test('loads saved skill back', async () => {
    const engineA = new EvolutionEngine();
    engineA.skillManager.addSkill('test-skill-1', { name: 'test skill' });
    await engineA.skillManager.saveSkills();

    const engineB = new EvolutionEngine();
    await engineB.loadSkills();
    const skill = engineB.skillManager.getSkill('test-skill-1');
    assert.ok(skill);
    assert.strictEqual(skill.name, 'test skill');
  });

  test('analyzes experiences and accumulates them', async () => {
    const engine = new EvolutionEngine();
    for (let i = 0; i < 5; i++) {
      await engine.analyzeExperience('code refactor', 'successfully completed');
    }
    const stats = engine.getStats();
    assert.ok(stats.totalExperiences >= 5);
  });

  test('returns available skills as an array', async () => {
    const engine = new EvolutionEngine();
    await engine.loadSkills();
    const skills = engine.getAvailableSkills('code refactor task');
    assert.ok(Array.isArray(skills));
  });

  test('exports and imports skills via JSON', async () => {
    const engine = new EvolutionEngine();
    engine.skillManager.addSkill('export-test', { name: 'export test' });
    const exported = engine.skillManager.exportAsJSON();

    const engineNew = new EvolutionEngine();
    engineNew.skillManager.importFromJSON(exported);
    const imported = engineNew.skillManager.getSkill('export-test');
    assert.ok(imported);
    assert.strictEqual(imported.name, 'export test');
  });
});
