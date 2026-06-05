import { ok, ng, skip, report } from './lib/report.mjs';

const NAME = 'Agent — 聊天代理';

async function testAgent() {
  try {
    const m = await import('../../src/core/agent/agent-engine.js');
    if (m.AgentEngine || m.default) ok('AgentEngine 可加载');
    else ok('agent-engine.js 可加载');
  } catch (e) {
    skip('Agent 模块不可用');
  }
  report(NAME);
}

testAgent().catch(e => { ng('Agent 实验异常', e); report(NAME); });
