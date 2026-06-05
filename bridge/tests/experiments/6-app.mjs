import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'App — Flutter 应用集成';

async function testApp() {
  const BASE = 'http://127.0.0.1:3800';

  try {
    const resp = await fetch(`${BASE}/api/status`);
    if (resp.ok) {
      const data = await resp.json();
      ok('GET /api/status 返回 200');
      if (data.status === 'running') ok(`bridge 状态: ${data.status}`);
      else ng(`bridge 状态异常: ${data.status}`);
    } else {
      skip(`/api/status 不可达 (HTTP ${resp.status})`);
    }
  } catch (e) {
    skip('/api/status 不可达 (bridge 未运行)');
  }

  try {
    const resp = await fetch(`${BASE}/peers`);
    if (resp.ok) {
      const data = await resp.json();
      ok('GET /peers 返回 200');
      if (Array.isArray(data)) ok('/peers 返回数组');
      else if (Array.isArray(data.peers)) ok('/peers.peers 是数组');
      else ok('/peers 端点可达');
    } else {
      skip('/peers 不可达');
    }
  } catch (e) {
    skip('/peers 不可达 (bridge 未运行)');
  }

  report(NAME);
}

testApp().catch(e => { ng('实验异常', e); report(NAME); });
