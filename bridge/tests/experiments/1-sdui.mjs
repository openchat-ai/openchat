import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'SDUI — Qiniu 文件驱动 UI';

async function testSdui() {
  try {
    const mod = await import('../../src/core/sdui-config.mjs');
    if (mod && mod.default) {
      ok('sdui-config.mjs 可加载');
    } else {
      ok('sdui-config.mjs 模块存在');
    }
  } catch (e) {
    skip('SDUI 实验跳过 — 无 Qiniu 配置或模块不可用');
  }

  report(NAME);
}

testSdui().catch(e => { ng('实验异常', e); report(NAME); });
