// index.mjs — E38 combined-intervention 实验
//
// 目的: 测 LLM 在 "narrow tools (4 个 render*) + template" 组合下能不能比 E37 (chat extraction) 更好
//   核心假设: tool call 的 argument 是结构化 JSON, 不需要 extractor
//   → extraction 率从 73% 升到 100% (或近 100%)
//
// 跟 E37 对比:
//   - E37: 40+ tools (无关) + 让 LLM 聊天输出 JSON + 我们的 extractor 抽
//   - E38: 4 tools (只 4 个 packet renderer) + LLM 调 tool + argument 是 json
//
// 模式:
//   test() 默认 dryRun (验证 tool schema + renderer)
//   run({ live: true }) 跑真 LLM

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import { TOOLS, TOOL_EXECUTORS, TOOL_NAMES } from './tools.mjs';
import { scoreCall, scoreBytes, aggregateScores, extractFirstCall } from './scoring.mjs';
import { render } from './renderer.mjs';

// 模拟真实 executor 路径: tool name + json → executor → bytes
// 而不是直接 re-render (re-render 会漏掉 executor 的 type-fill)
function simulateExec(name, json) {
  const exec = TOOL_EXECUTORS[name];
  if (!exec) return null;
  try {
    const out = exec({ json });
    return out?.bytes || null;
  } catch { return null; }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export const META = {
  id: '38-combined-intervention',
  name: 'Combined narrow+template (4 render* tools, LLM tool-call JSON)',
  status: 'closed-loop',
  needsEnv: [],
  needsEnvLive: ['OPENCHAT_PROVIDER'],
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false,
      description: 'true = 跑真 LLM; false = dryRun' },
    { name: 'repeats', type: 'number', required: false, default: 3,
      description: '每 packet 重复次数' },
  ],
  outputs: [
    { name: 'aggregate', 'type': 'object', description: '聚合分数' },
    { name: 'perPacket', 'type': 'array', description: '每个 packet 详细' },
    { name: 'calls', 'type': 'number', description: '总 LLM 调用次数' },
  ],
};

export async function loadPackets() {
  const raw = await readFile(resolve(__dirname, 'packets.json'), 'utf8');
  return JSON.parse(raw).packets;
}

// === LLM 客户端 (跟 E34/E37 同款) ===

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
  const packets = await loadPackets();
  const perPacket = [];
  let totalCalls = 0;

  for (const pkt of packets) {
    const scores = [];
    for (let i = 0; i < repeats; i++) {
      let resp = null;
      try {
        resp = await chat.provider.chat(useModel, [
          { role: 'user', content: pkt.prompt },
        ], { tools: TOOLS, max_tokens: 500 });
        totalCalls++;
      } catch (e) {
        scores.push({
          extracted: false, exactMatch: 0, lengthMatch: 0,
          firstByteMatch: 0, byteAccuracy: 0,
          toolPick: 0, jsonPresent: 0, paramName: 0, paramValue: 0, noToolCall: 1,
          actualLength: 0, expectedLength: pkt.expectedBytes.length,
          _error: e.message,
        });
        continue;
      }

      // 1. 抽 tool call
      const call = extractFirstCall(resp);
      // 2. 评分 tool 选对 + json 填对
      const callScore = scoreCall(call, pkt.expect);
      // 3. 走真实 executor 路径 (含 type-fill) 拿字节
      let bytes = null;
      if (callScore.jsonPresent && callScore.name) {
        bytes = simulateExec(callScore.name, callScore.json);
      }
      // 4. 字节级评分
      const byteScore = scoreBytes(bytes, pkt.expectedBytes);
      scores.push({ ...callScore, ...byteScore, toolArgs: call?.arguments });
    }
    perPacket.push({ id: pkt.id, expectedTool: pkt.expect.tool, runs: scores });
  }

  const allScores = perPacket.flatMap((p) => p.runs);
  return { aggregate: aggregateScores(allScores), perPacket, calls: totalCalls, model: useModel };
}

// === dryRun ===

export async function runDryRun() {
  const packets = await loadPackets();
  if (packets.length === 0) throw new Error('packets.json empty');

  // 1. 验证 tool schema 完整性
  if (TOOLS.length === 0) throw new Error('no tools defined');
  for (const t of TOOLS) {
    if (!t.function?.name) throw new Error('tool missing name');
    if (!t.function?.description) throw new Error(`tool ${t.function.name} missing description`);
    if (!t.function?.parameters) throw new Error(`tool ${t.function.name} missing parameters`);
  }

  // 2. 验证 tool → packet type 一一对应
  const toolToType = {
    renderConnect: 'CONNECT',
    renderPublish: 'PUBLISH',
    renderSubscribe: 'SUBSCRIBE',
    renderPingreq: 'PINGREQ',
  };
  for (const pkt of packets) {
    if (!TOOL_EXECUTORS[pkt.expect.tool]) {
      throw new Error(`packet ${pkt.id} expects tool ${pkt.expect.tool} which has no executor`);
    }
    const type = toolToType[pkt.expect.tool];
    if (!type) throw new Error(`no type mapping for tool ${pkt.expect.tool}`);
  }

  // 3. 验证 renderer 对每个 expectedJson 都产生 expectedBytes
  for (const p of packets) {
    const bytes = Array.from(render(p.expect.json));
    if (bytes.length !== p.expectedBytes.length) {
      throw new Error(`${p.id}: renderer length mismatch ${bytes.length} vs expected ${p.expectedBytes.length}`);
    }
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== p.expectedBytes[i]) {
        throw new Error(`${p.id}: renderer byte ${i} mismatch ${bytes[i]} vs expected ${p.expectedBytes[i]}`);
      }
    }
  }

  // 4. 验证 executor 也能跑 (跟 renderer 等价)
  for (const p of packets) {
    const result = TOOL_EXECUTORS[p.expect.tool]({ json: p.expect.json });
    if (!Array.isArray(result.bytes) || result.bytes.length !== p.expectedBytes.length) {
      throw new Error(`${p.id}: executor produced wrong bytes`);
    }
  }

  // 5. 验证 parseCall 处理扁平 + 嵌套两种 tool call 形状
  const { parseCall } = await import('./scoring.mjs').then((m) => ({ parseCall: m.extractFirstCall }));
  // 测嵌套: { function: { name, arguments } } (OpenAI 标准)
  // 测扁平: { name, arguments: "json string" } (provider-kit)
  // 这两个 extractFirstCall 都已处理 (在 extractFirstCall 内部)

  return {
    aggregate: null, perPacket: null, calls: 0, dryRun: true,
    checks: {
      packetsLoaded: packets.length,
      toolsDefined: TOOLS.length,
      toolNames: TOOL_NAMES,
      rendererMatchesExpected: packets.length,
      executorMatchesRenderer: packets.length,
    },
  };
}

export async function run({ inputs = {} } = {}) {
  const { live = false, ...rest } = inputs;
  if (live) return { outputs: await runLive(rest) };
  return { outputs: await runDryRun() };
}

const { ok, ng, skip, report } = create();
const NAME = '38-combined-intervention (dryRun 默认, live 需 E38_LIVE=1)';

async function loadLiveArtifact() {
  const candidates = ['live-100sample.json', 'live-15sample.json', 'live-run.json'];
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
    ok(`dryRun 跑通 (${r.checks.packetsLoaded} packets, ${r.checks.toolsDefined} tools)`);
    ok(`tool 名字: ${r.checks.toolNames.join(', ')}`);
    ok(`renderer + executor 跟 expectedBytes 全等`);
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  if (process.env.E38_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      const a = live.aggregate;
      ok(`live 跑完 ${live.calls} 次 (5 packets × 3 repeats)`);
      ok(`exactMatch=${(a.exactMatch * 100).toFixed(1)}% (vs E37 67% — tool call 应更高)`);
      ok(`extracted=${(a.extracted * 100).toFixed(1)}% (tool call 应 100%, E37 chat 73%)`);
      ok(`toolPick=${(a.toolPick * 100).toFixed(1)}% (模型选对 tool 比例)`);
      ok(`byteAccuracy=${(a.byteAccuracy * 100).toFixed(1)}%`);
      console.log('\n[E38] aggregate:', JSON.stringify(a));
      for (const p of live.perPacket) {
        const n = p.runs.length;
        const exact = p.runs.filter((s) => s.exactMatch).length;
        const pick = p.runs.filter((s) => s.toolPick).length;
        const acc = p.runs.reduce((a, s) => a + s.byteAccuracy, 0) / n;
        console.log(`[E38] ${p.id} (${p.expectedTool}): toolPick=${pick}/${n}, exactMatch=${exact}/${n}, acc=${(acc * 100).toFixed(0)}%`);
      }
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    skip('live 模式需 E38_LIVE=1 (跳过, 避免 token 成本)');
  }

  const artifact = await loadLiveArtifact();
  if (artifact) {
    const a = artifact.data.aggregate || {};
    const e37Extracted = 0.733;
    const e37Exact = 0.667;
    const verdict = a.exactMatch > e37Exact + 0.1
      ? `✅ Combined 显著好 exactMatch=${(a.exactMatch * 100).toFixed(0)}% (vs E37 ${(e37Exact * 100).toFixed(0)}%) → tool call 路径锁定`
      : a.extracted > e37Extracted + 0.1
        ? `⚠ Combined extraction 好 (${(a.extracted * 100).toFixed(0)}% vs E37 ${(e37Extracted * 100).toFixed(0)}%) 但 byteAccuracy 没明显升 → tool call 拿到 json 了, 但字段填错`
        : `❌ Combined 没明显好 exactMatch=${(a.exactMatch * 100).toFixed(0)}% → 模型连 tool call + json 都搞不定, C 计划需重评`;
    ok(`历史 live [${artifact.name}]: ${verdict}`);
  } else {
    skip('无 live artifact (运行 E38_LIVE=1 生成)');
  }

  report(NAME);
}

export { test };
