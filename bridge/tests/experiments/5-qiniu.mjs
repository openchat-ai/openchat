import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'Qiniu — 七牛存储';

async function testQiniu() {
  let qiniuSignaling;
  try {
    const mod = await import('../../src/core/qiniu-signaling.mjs');
    qiniuSignaling = mod.qiniuSignaling || mod.default;
    ok('qiniuSignaling 模块可加载');
  } catch (e) {
    const ak = process.env.QINIU_ACCESS_KEY;
    const sk = process.env.QINIU_SECRET_KEY;
    if (!ak || !sk) {
      skip('Qiniu 未配置，跳过实验');
      return report(NAME);
    }
    ng('qiniu-signaling.mjs 加载失败', e);
    return report(NAME);
  }

  const methods = ['listObjects', 'getSignedUrl', 'putObject', 'deleteObject'];
  if (typeof qiniuSignaling === 'object' && qiniuSignaling !== null) {
    let allOk = true;
    for (const m of methods) {
      if (typeof qiniuSignaling[m] === 'function') ok(`${m} 方法存在`);
      else { allOk = false; ng(`${m} 方法缺失`); }
    }
    if (allOk) ok(`所有 ${methods.length} 个关键方法存在`);
  } else {
    ng('qiniuSignaling 不是有效对象');
  }

  report(NAME);
}

testQiniu().catch(e => { ng('实验异常', e); report(NAME); });
