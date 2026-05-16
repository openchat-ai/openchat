import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { EvolutionEngine } from '../evolution-engine.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpBase = path.join(os.tmpdir(), 'openchat-test-' + Date.now());
let tmpDir;

function makeEngine() {
  const engine = new EvolutionEngine();
  // 重定向到临时目录以隔离测试
  engine.skillManager.storageDir = tmpDir;
  engine.skillManager.skillsFile = path.join(tmpDir, 'skills.json');
  return engine;
}

describe('EvolutionEngine Integration', () => {
  before(() => {
    tmpDir = path.join(tmpBase, String(Math.random().toString(36).slice(2, 8)));
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  test('EvolutionEngine 初始化', () => {
    const engine = makeEngine();
    assert.ok(engine.skillManager, 'skillManager 应存在');
    assert.notStrictEqual(engine.experiences, undefined);
  });

  test('Skill 保存到磁盘', async () => {
    const engine = makeEngine();
    engine.skillManager.addSkill('test-skill-1', {
      name: '测试技能',
      description: '这是一个测试技能',
      code: 'function test() { return true; }',
    });

    await engine.skillManager.saveSkills();
    assert.ok(fs.existsSync(engine.skillManager.getStoragePath()));
  });

  test('Skill 加载和恢复', async () => {
    const engine1 = makeEngine();
    engine1.skillManager.addSkill('test-skill-1', {
      name: '测试技能',
      description: '用于测试',
    });
    await engine1.skillManager.saveSkills();

    const engine2 = makeEngine();
    await engine2.loadSkills();
    const skill = engine2.skillManager.getSkill('test-skill-1');
    assert.ok(skill, '应能加载已保存的 Skill');
    assert.strictEqual(skill.name, '测试技能');
  });

  test('经验分析和统计', async () => {
    const engine = makeEngine();

    for (let i = 0; i < 5; i++) {
      await engine.analyzeExperience('代码重构', '成功完成代码重构，提升了性能 20%');
    }

    const stats = engine.getStats();
    assert.ok(stats.totalExperiences >= 5);
  });

  test('获取可用 Skills', async () => {
    const engine = makeEngine();
    await engine.loadSkills();
    const availableSkills = engine.getAvailableSkills('代码重构任务');
    assert.ok(Array.isArray(availableSkills));
  });

  test('SkillManager 导入导出', () => {
    const engine = makeEngine();
    engine.skillManager.addSkill('export-test', {
      name: '导出测试',
      description: '测试导出功能',
    });

    const exported = engine.skillManager.exportAsJSON();

    const engineNew = makeEngine();
    engineNew.skillManager.importFromJSON(exported);

    const imported = engineNew.skillManager.getSkill('export-test');
    assert.ok(imported, '应能导入 Skill');
    assert.strictEqual(imported.name, '导出测试');
  });
});
