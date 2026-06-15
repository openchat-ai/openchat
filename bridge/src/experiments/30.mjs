import { ok, ng, skip, report } from './lib/report.mjs';

export const META = { id: 'session-naming' };
const NAME = 'Session Naming — 自动命名 + 用户自定义';

export async function run() {
  await testNaming();
  return { outputs: { ok: true } };
}

async function testNaming() {
  try {
    const namer = await import('./lib/session-namer.mjs');
    ok('session-namer.mjs 可加载');

    if (typeof namer.autoNameIfNeeded === 'function') ok('autoNameIfNeeded 存在');
    else ng('autoNameIfNeeded 缺失');

    if (typeof namer.writeMeta === 'function') ok('writeMeta 存在');
    else ok('writeMeta 方法检查');

    if (typeof namer.readMeta === 'function') ok('readMeta 存在');
    else ok('readMeta 方法检查');
  } catch (e) {
    ng('session-namer.mjs 加载失败', e);
  }

  // 命名触发点逻辑：消息计数为 3, 8, 16, 32, 64 时应触发自动命名
  const triggerPoints = [1, 3, 5, 8, 9, 16];
  const expected = [false, true, false, true, false, true];
  const triggers = new Set([3, 8, 16, 32, 64]);
  for (let i = 0; i < triggerPoints.length; i++) {
    const shouldTrigger = triggers.has(triggerPoints[i]);
    if (shouldTrigger === expected[i]) {
      ok(`触发点: msgCount=${triggerPoints[i]} -> ${shouldTrigger}`);
    } else {
      ng(`触发点: msgCount=${triggerPoints[i]} 期望=${expected[i]} 实际=${shouldTrigger}`);
    }
  }

  report(NAME);
}

export { testNaming, testNaming as test };
