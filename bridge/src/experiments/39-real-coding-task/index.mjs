// index.mjs — E39 real-coding-task 实验
//
// 目的: 测 "narrow + template + tool call" scaffold 在 真实编码任务 上的端到端表现
//   任务: LLM 写完整 mqttSubscribe 函数, 内部用 renderConnect + renderSubscribe
//   测: 源码里 tool call 正确 + sandbox 跑通 + 字节写对
//
// 模式:
//   test() 默认 dryRun (用 synthetic 源码验证 scorer 跟 sandbox)
//   run({ live: true }) 跑真 LLM

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import { score, aggregateScores } from './scorer.mjs';
import { TOOLS, TOOL_NAMES } from './tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const META = {
  id: '39-real-coding-task',
  name: 'Real coding task: LLM 写完整 mqttSubscribe 函数, sandbox 端到端验证',
  status: 'closed-loop',
  needsEnv: [],
  needsEnvLive: ['OPENCHAT_PROVIDER'],
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false,
      description: 'true = 跑真 LLM' },
    { name: 'repeats', type: 'number', required: false, default: 3,
      description: '重复次数' },
  ],
  outputs: [
    { name: 'aggregate', 'type': 'object', description: '8 维聚合分数' },
    { name: 'runs', 'type': 'array', description: '每次 run 的 8 维分数' },
    { name: 'calls', 'type': 'number', description: '总 LLM 调用次数' },
  ],
};

export async function loadTask() {
  const raw = await readFile(resolve(__dirname, 'task.json'), 'utf8');
  return JSON.parse(raw).task;
}

// === LLM 客户端 (跟 E36/37/38 同款) ===

async function createChatClient() {
  const { persistentConfig } = await import('../../core/persistent-config.js');
  const { createProvider } = await import('provider-kit');
  const cfg = persistentConfig.config;
  const providerId = cfg.current?.provider;
  if (!providerId) throw new Error('config.current.provider missing');
  const prov = cfg.providers?.[providerId];
  if (!prov) throw new Error(`config.providers.${providerId} missing`);
  const apiKey = prov.apiKey;
  if (!apiKey) throw new Error(`config.providers.${providerId}.apiKey missing`);
  const model = cfg.current?.model || prov.defaultModel || prov.model;
  const p = createProvider(providerId, apiKey);
  await p.connect(apiKey);
  return { provider: p, model };
}

// === live 模式 ===

export async function runLive({ repeats = 3, model = null } = {}) {
  const chat = await createChatClient();
  const useModel = model || chat.model;
  const task = await loadTask();
  const runs = [];
  let totalCalls = 0;

  for (let i = 0; i < repeats; i++) {
    let text = '';
    try {
      const r = await chat.provider.chat(useModel, [
        { role: 'user', content: task.prompt },
      ], { tools: TOOLS, max_tokens: 2000 });
      text = r.content || '';
      if (!text && r.choices) text = r.choices[0]?.message?.content || '';
      if (!text && r.toolCalls) {
        // function-calling 模式: 响应可能只有 tool calls
        text = r.toolCalls.map((c) => c.arguments || '').join('\n');
      }
      totalCalls++;
    } catch (e) {
      runs.push({
        sourceExtracted: false, functionShapeOk: false,
        renderConnectCalled: false, renderConnectArgsOk: false,
        renderSubscribeCalled: false, renderSubscribeArgsOk: false,
        sandboxRan: false, packetsSentCorrect: false,
        _error: e.message,
      });
      continue;
    }
    const s = await score(text);
    runs.push(s);
  }

  return { aggregate: aggregateScores(runs), runs, calls: totalCalls, model: useModel, task: { id: task.id, prompt: task.prompt } };
}

// === dryRun 模式 ===

export async function runDryRun() {
  const task = await loadTask();
  if (!task?.prompt) throw new Error('task.json missing prompt');

  // 1. 验证 tools 完整
  if (TOOLS.length === 0) throw new Error('no tools defined');
  for (const t of TOOLS) {
    if (!t.function?.name) throw new Error('tool missing name');
  }

  // 2. 用 synthetic 源码验证 scorer
  const goodSource = `
async function mqttSubscribe({host, port, topic, clientId}) {
  const connectBytes = await renderConnect({
    protoName: 'MQTT', protoLevel: 4,
    connectFlags: { cleanSession: true },
    keepAlive: 60, clientId: clientId
  });
  const subscribeBytes = await renderSubscribe({
    packetId: 1, subscriptions: [{topic: topic, qos: 1}]
  });
  const socket = new net.Socket();
  socket.on('connect', () => {
    socket.write(Buffer.from(connectBytes.bytes));
    socket.write(Buffer.from(subscribeBytes.bytes));
  });
  socket.connect(port, host);
  return new Promise((resolve) => setTimeout(() => resolve('done'), 100));
}
`;
  const sGood = await score(goodSource);
  if (!sGood.sourceExtracted) throw new Error('synthetic good source not extracted');
  if (!sGood.functionShapeOk) throw new Error('synthetic good source: functionShape failed');
  if (!sGood.renderConnectCalled) throw new Error('synthetic good source: renderConnect not called');
  if (!sGood.renderConnectArgsOk) throw new Error(`synthetic good source: renderConnect args failed: ${sGood._debug.rcReason}`);
  if (!sGood.renderSubscribeCalled) throw new Error('synthetic good source: renderSubscribe not called');
  if (!sGood.renderSubscribeArgsOk) throw new Error(`synthetic good source: renderSubscribe args failed: ${sGood._debug.rsReason}`);
  if (!sGood.sandboxRan) throw new Error(`synthetic good source: sandbox failed: ${sGood._debug.sandboxError}`);
  if (!sGood.packetsSentCorrect) throw new Error(`synthetic good source: packets wrong. packets=${JSON.stringify(sGood._debug)}`);

  // 3. 用坏源码验证 scorer 抓得出错
  const badSource = `
async function mqttSubscribe({host, port, topic, clientId}) {
  // 漏调 renderConnect, 直接写硬编码字节 (错的)
  const socket = new net.Socket();
  socket.on('connect', () => {
    socket.write(Buffer.from([0x10, 0x12, 0x00]));  // 错的字节
  });
  socket.connect(port, host);
  return new Promise(() => {});  // never resolves
}
`;
  const sBad = await score(badSource);
  if (sBad.packetsSentCorrect) throw new Error('synthetic bad source should fail packetsSentCorrect');
  if (sBad.renderConnectCalled) throw new Error('synthetic bad source: renderConnect should NOT be called');

  return {
    aggregate: null, runs: null, calls: 0, dryRun: true,
    checks: {
      taskLoaded: true,
      toolsDefined: TOOLS.length,
      toolNames: TOOL_NAMES,
      syntheticGoodSource: 'all 8 dims pass',
      syntheticBadSource: 'correctly fails',
      goodPacketsCount: sGood._debug.packetsCount,
    },
  };
}

export async function run({ inputs = {} } = {}) {
  const { live = false, ...rest } = inputs;
  if (live) return { outputs: await runLive(rest) };
  return { outputs: await runDryRun() };
}

const { ok, ng, skip, report } = create();
const NAME = '39-real-coding-task (dryRun 默认, live 需 E39_LIVE=1)';

async function loadLiveArtifact() {
  const candidates = ['live-100sample.json', 'live-30sample.json', 'live-6sample.json', 'live-3sample.json', 'live-run.json'];
  for (const name of candidates) {
    const p = resolve(__dirname, name);
    try {
      const raw = await readFile(p, 'utf8');
      return { name, data: JSON.parse(raw) };
    } catch { /* 不存在 */ }
  }
  return null;
}

async function test() {
  let r;
  try {
    r = await runDryRun();
    ok(`dryRun 跑通 (${r.checks.toolsDefined} tools: ${r.checks.toolNames.join(', ')})`);
    ok(`synthetic good source: 8 维全过 (packets=${r.checks.goodPacketsCount})`);
    ok(`synthetic bad source: scorer 正确判负`);
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  if (process.env.E39_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      const a = live.aggregate;
      ok(`live 跑完 ${live.calls} 次`);
      ok(`sourceExtracted=${(a.sourceExtracted * 100).toFixed(0)}% (能写 JS 代码块)`);
      ok(`functionShapeOk=${(a.functionShapeOk * 100).toFixed(0)}% (声明 mqttSubscribe)`);
      ok(`renderConnectArgsOk=${(a.renderConnectArgsOk * 100).toFixed(0)}% (CONNECT 参数对)`);
      ok(`renderSubscribeArgsOk=${(a.renderSubscribeArgsOk * 100).toFixed(0)}% (SUBSCRIBE 参数对)`);
      ok(`packetsSentCorrect=${(a.packetsSentCorrect * 100).toFixed(0)}% (端到端字节对)`);
      console.log('\n[E39] aggregate:', JSON.stringify(a));
      for (let i = 0; i < live.runs.length; i++) {
        const s = live.runs[i];
        console.log(`[E39] run ${i+1}: ext=${s.sourceExtracted}, shape=${s.functionShapeOk}, rcArgs=${s.renderConnectArgsOk}, rsArgs=${s.renderSubscribeArgsOk}, sandbox=${s.sandboxRan}, pkts=${s.packetsSentCorrect}, err=${s._debug?.sandboxError || s._error || 'none'}`);
      }
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    skip('live 模式需 E39_LIVE=1 (跳过, 避免 token 成本)');
  }

  const artifact = await loadLiveArtifact();
  if (artifact) {
    const a = artifact.data.aggregate || {};
    const verdict = a.packetsSentCorrect > 0.5
      ? `✅ 端到端通过: ${(a.packetsSentCorrect * 100).toFixed(0)}% runs 字节对 → scaffold 化弱模型能做编码`
      : a.renderConnectArgsOk > 0.5
        ? `⚠ 参数对 (rcArgs=${(a.renderConnectArgsOk * 100).toFixed(0)}%) 但 sandbox 跑崩 → tool call OK, JS 整合不行`
        : `❌ tool call 都搞不定 (rcArgs=${(a.renderConnectArgsOk * 100).toFixed(0)}%) → C 计划在真任务上仍不足`;
    ok(`历史 live [${artifact.name}]: ${verdict}`);
  } else {
    skip('无 live artifact (运行 E39_LIVE=1 生成)');
  }

  report(NAME);
}

export { test };
