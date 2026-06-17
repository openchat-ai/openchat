import { _setDeps, _resetDeps, processOne } from './lib/poller-shim.mjs';
import { ok, equal } from 'assert';

const NAME = 'Backpressure — Qiniu 慢时请求限流';

export async function run({ inputs = {} } = {}) {
  const { concurrency = 25, delay = 500, normalLoad = 4 } = inputs;
  let getDelay = 0;

  _setDeps({
    qiniuGet: async () => { await new Promise(r => setTimeout(r, getDelay)); return Buffer.from('{"text":"hi"}'); },
    qiniuList: async () => [],
    qiniuPut: async () => {},
    processText: async () => ({ response: 'ok' }),
    generateSessionName: async () => 'test',
    autoNameIfNeeded: async () => {},
    composeRun: async () => ({ outputs: { reply: 'ok', replyKey: 'r.json', error: null } }),
    LmdnCodec: class { initialize = async () => {}; decode = async () => ({ pcm: Buffer.alloc(100) }); },
  });

  getDelay = delay;
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(processOne(`oc/chat/test/${i}.msg`));
  }
  const results = await Promise.allSettled(promises);
  const backpressured = results.filter(r => r.status === 'fulfilled' && r.value?.skipped === 'backpressure').length;
  const succeeded = results.filter(r => r.status === 'fulfilled' && !r.value?.skipped).length;

  _resetDeps();

  getDelay = 0;
  _setDeps({
    qiniuGet: async () => Buffer.from('{"text":"hi"}'),
    qiniuList: async () => [],
    qiniuPut: async () => {},
    processText: async () => ({ response: 'ok' }),
    generateSessionName: async () => 'test',
    autoNameIfNeeded: async () => {},
    composeRun: async () => ({ outputs: { reply: 'ok', replyKey: 'r.json', error: null } }),
    LmdnCodec: class { initialize = async () => {}; decode = async () => ({ pcm: Buffer.alloc(100) }); },
  });
  const normal = await Promise.all(
    Array.from({ length: normalLoad }, (_, i) => processOne(`oc/chat/normal/${i}.msg`))
  );
  const rejected = normal.filter(r => r && r.skipped).length;
  _resetDeps();

  return {
    outputs: {
      backpressured,
      succeeded,
      total: concurrency,
      normalRejected: rejected,
      normalPassed: normalLoad - rejected,
    },
  };
}

export async function test() {
  const r = await run();
  const o = r.outputs;
  let pass = true;
  try {
    ok(o.backpressured > 0, `backpressure should trigger (got ${o.backpressured})`);
    console.debug(`  ✓ backpressure: ${o.backpressured}/${o.total} requests rejected`);
    ok(o.normalRejected === 0, `normal load should pass (got ${o.normalRejected} rejected)`);
    console.debug(`  ✓ backpressure: normal load (${o.normalPassed}) passes`);
    pass = true;
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    pass = false;
  }
  console.debug(`\n${pass ? '✓' : '✗'} ${NAME}`);
  return pass;
}
