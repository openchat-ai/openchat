import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EvolutionEngine } from '../evolution-engine.js';
import SkillManager from '../skill-manager.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-test-'));
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('EvolutionEngine integration', () => {
  let testDir;
  let engine;

  before(() => {
    testDir = tmpDir();
    engine = new EvolutionEngine();
    engine.skillManager = new SkillManager(testDir);
    engine.experiences = [];
  });

  after(() => {
    cleanDir(testDir);
  });

  it('initializes with skillManager and experiences', () => {
    assert.ok(engine.skillManager);
    assert.ok(Array.isArray(engine.experiences));
  });

  it('adds and saves a skill to disk', async () => {
    engine.skillManager.addSkill('test-skill-1', {
      name: 'test skill',
      description: 'a test skill',
      code: 'function test() { return true; }',
    });

    await engine.skillManager.saveSkills();

    const skillPath = engine.skillManager.getStoragePath();
    assert.ok(fs.existsSync(skillPath), 'skill file should exist on disk');
  });

  it('loads saved skill back', async () => {
    engine.skillManager.addSkill('test-skill-2', {
      name: 'test skill 2',
      description: 'another test skill',
      code: 'function test2() { return 42; }',
    });
    await engine.skillManager.saveSkills();

    const engine2 = new EvolutionEngine();
    const sm2 = new SkillManager(testDir);
    engine2.skillManager = sm2;
    await engine2.loadSkills();

    const skill = sm2.getSkill('test-skill-2');
    assert.ok(skill);
    assert.equal(skill.name, 'test skill 2');
  });

  it('analyzes experiences and accumulates them', async () => {
    for (let i = 0; i < 5; i++) {
      await engine.analyzeExperience(
        'refactor code',
        'successfully completed refactoring, improved performance by 20%'
      );
    }

    const stats = engine.getStats();
    assert.ok(stats.totalExperiences >= 5);
  });

  it('returns available skills as an array', () => {
    const skills = engine.getAvailableSkills('refactor code task');
    assert.ok(Array.isArray(skills));
  });

  it('exports and imports skills via JSON', () => {
    engine.skillManager.addSkill('export-test', {
      name: 'export test',
      description: 'test export functionality',
    });

    const exported = engine.skillManager.exportAsJSON();

    const engineNew = new EvolutionEngine();
    const smNew = new SkillManager(testDir);
    engineNew.skillManager = smNew;
    smNew.importFromJSON(exported);

    const imported = smNew.getSkill('export-test');
    assert.ok(imported);
    assert.equal(imported.name, 'export test');
  });
});
