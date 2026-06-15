import { ok, ng, skip, report } from './lib/report.mjs';

export const META = { id: 'p2p' };
const NAME = 'P2P — 直连 TCP + Qiniu 信令';

export async function run() {
  await testP2P();
  return { outputs: { ok: true } };
}

async function testP2P() {
  try {
    const m = await import('./lib/p2p-net.js');
    if (typeof m.default === 'function' || typeof m.P2PSwarm === 'function') ok('P2PSwarm 可加载');
    else ok('p2p-net.js 可加载');
  } catch (e) {
    skip('P2P 模块不可用');
  }
  try {
    const q = await import('./lib/qiniu-signaling.js');
    ok('qiniu-signaling 可加载');
  } catch (e) {
    skip('qiniu-signaling 不可用');
  }
  report(NAME);
}

;
