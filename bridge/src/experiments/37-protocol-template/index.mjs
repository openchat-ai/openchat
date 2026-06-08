// index.mjs — E37 protocol-template 验证
//
// 目的: 验证 LLM 填 JSON 模板, scaffold 渲染成字节, 跟 E36 (LLM 直接写字节) 对比
//   - E36 exactMatch = 20% (3/15)
//   - E37 假设: 显著好, 因为 LLM 只做"填空", byte encoding 由 scaffold 负责

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import { extractJson } from './extractor.mjs';
import { render, scoreBytes, aggregateScores } from './renderer.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const META = {
  id: '37-protocol-template',
  name: 'Protocol-template 验证 (LLM 填 JSON, scaffold 渲染字节)',
  status: 'closed-loop',
  needsEnv: [],
  needsEnvLive: ['OPENCHAT_PROVIDER'],
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false, description: 'true = 跑真 LLM' },
    { name: 'repeats', type: 'number', required: false, default: 3, description: '每 packet 重复次数' },
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
      let text = '';
      try {
        const r = await chat.provider.chat(useModel, [
          { role: 'user', content: pkt.prompt },
        ], { max_tokens: 500 });
        text = r.content || '';
        if (!text && r.choices) text = r.choices[0]?.message?.content || '';
      } catch (e) {
        scores.push({
          extracted: false, exactMatch: 0, lengthMatch: 0,
          firstByteMatch: 0, byteAccuracy: 0,
          actualLength: 0, expectedLength: pkt.expectedBytes.length,
          _error: e.message,
        });
        totalCalls++;
        continue;
      }
      totalCalls++;

      // 1. 抽 JSON
      const json = extractJson(text);
      // 2. 渲染成字节
      let bytes = null;
      if (json) {
        try { bytes = render(json); } catch { bytes = null; }
      }
      // 3. 跟 expected 比较
      const s = scoreBytes(bytes ? Array.from(bytes) : null, pkt.expectedBytes);
      scores.push(s);
    }
    perPacket.push({ id: pkt.id, expectedJson: pkt.expectedJson, runs: scores });
  }

  const allScores = perPacket.flatMap((p) => p.runs);
  return { aggregate: aggregateScores(allScores), perPacket, calls: totalCalls, model: useModel };
}

// === dryRun ===

export async function runDryRun() {
  const packets = await loadPackets();
  if (packets.length === 0) throw new Error('packets.json empty');

  // 验证 renderer 对每个 expectedJson 都能产出 expectedBytes
  for (const p of packets) {
    const bytes = render(p.expectedJson);
    const actual = Array.from(bytes);
    const expected = p.expectedBytes;
    if (actual.length !== expected.length) {
      throw new Error(`${p.id}: renderer length mismatch ${actual.length} vs expected ${expected.length}`);
    }
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        throw new Error(`${p.id}: renderer byte ${i} mismatch ${actual[i]} vs expected ${expected[i]}`);
      }
    }
  }

  // 验证 extractor
  const goodText = '```json\n{"type": "PINGREQ"}\n```';
  if (!extractJson(goodText) || extractJson(goodText).type !== 'PINGREQ') {
    throw new Error('extractor: code block parse failed');
  }
  const noJson = 'I cannot answer this.';
  if (extractJson(noJson) !== null) throw new Error('extractor: should return null for non-JSON');

  return {
    aggregate: null, perPacket: null, calls: 0, dryRun: true,
    checks: {
      packetsLoaded: packets.length,
      rendererMatchesExpected: packets.length,
      extractorCodeBlock: true,
      extractorNonJson: true,
    },
  };
}

export async function run({ inputs = {} } = {}) {
  const { live = false, ...rest } = inputs;
  if (live) return { outputs: await runLive(rest) };
  return { outputs: await runDryRun() };
}

const { ok, ng, skip, report } = create();
const NAME = '37-protocol-template (dryRun 默认, live 需 E37_LIVE=1)';

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
    ok(`dryRun 跑通 (${r.checks.packetsLoaded} packets, renderer 输出跟 expectedBytes 全等)`);
    ok(`extractor: 代码块 + 非 JSON 文 本 都正确处理`);
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  if (process.env.E37_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      const a = live.aggregate;
      ok(`live 跑完 ${live.calls} 次 (5 packets × 3 repeats)`);
      ok(`exactMatch=${(a.exactMatch * 100).toFixed(1)}% (跟 E36 的 20% 对比)`);
      ok(`extracted=${(a.extracted * 100).toFixed(1)}% (JSON 抽取率)`);
      ok(`byteAccuracy=${(a.byteAccuracy * 100).toFixed(1)}% (渲染后字节准确率)`);
      console.log('\n[E37] aggregate:', JSON.stringify(a));
      for (const p of live.perPacket) {
        const n = p.runs.length;
        const exact = p.runs.filter((s) => s.exactMatch).length;
        const acc = p.runs.reduce((a, s) => a + s.byteAccuracy, 0) / n;
        console.log(`[E37] ${p.id}: exactMatch=${exact}/${n}, byteAccuracy=${(acc * 100).toFixed(0)}%`);
      }
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    skip('live 模式需 E37_LIVE=1 (跳过, 避免 token 成本)');
  }

  const artifact = await loadLiveArtifact();
  if (artifact) {
    const a = artifact.data.aggregate || {};
    const verdict = a.exactMatch >= 0.8
      ? `✅ 模板路径显著好 exactMatch=${(a.exactMatch * 100).toFixed(0)}% (vs E36 20%) → C 计划 1.3 锁定`
      : a.exactMatch >= 0.5
        ? `⚠ 模板路径略好 exactMatch=${(a.exactMatch * 100).toFixed(0)}% → 部分可救, 需 scaffold 帮填更多`
        : `❌ 模板路径也差 exactMatch=${(a.exactMatch * 100).toFixed(0)}% → 连填空都做不好, C 计划需重评`;
    ok(`历史 live [${artifact.name}]: ${verdict}`);
  } else {
    skip('无 live artifact (运行 E37_LIVE=1 生成)');
  }

  report(NAME);
}

export { test };
