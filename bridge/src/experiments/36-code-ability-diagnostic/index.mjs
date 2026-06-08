// index.mjs — E36 诊断实验
//
// 目的: 测弱模型在不调工具的情况下能不能写出正确的 MQTT 字节流
//   决定 C 计划的方向:
//     - 能写出 → 工具调用是瓶颈, C 计划能成
//     - 写不出 → 模型本身能力不足, C 计划无法救
//
// 模式:
//   test() 默认 dryRun (验证 extractor + scoring + packets.json)
//   run({ live: true }) 调 LLM, 不传 tools (模拟"不调工具"场景)

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import { extractBytes, scoreBytes, aggregateScores } from './extractor.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const META = {
  id: '36-code-ability-diagnostic',
  name: 'Code ability 诊断 (不调工具, 写 MQTT 字节)',
  status: 'closed-loop',
  needsEnv: [],
  needsEnvLive: ['OPENCHAT_PROVIDER'],
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false,
      description: 'true = 跑真 LLM (不传 tools); false = dryRun' },
    { name: 'repeats', type: 'number', required: false, default: 3,
      description: '每 packet 重复次数 (live)' },
  ],
  outputs: [
    { name: 'aggregate', 'type': 'object', description: '聚合分数' },
    { name: 'perPacket', 'type': 'array', description: '每个 packet 的详细分数' },
    { name: 'calls', 'type': 'number', description: '总 LLM 调用次数' },
  ],
};

export async function loadPackets() {
  const raw = await readFile(resolve(__dirname, 'packets.json'), 'utf8');
  return JSON.parse(raw).packets;
}

// === LLM 客户端 ===

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

// === live 模式: 不传 tools, 纯 chat ===

export async function runLive({ repeats = 3, model = null } = {}) {
  const chat = await createChatClient();
  const useModel = model || chat.model;
  const packets = await loadPackets();
  const perPacket = [];
  let totalCalls = 0;

  for (const pkt of packets) {
    const scores = [];
    const responses = [];
    for (let i = 0; i < repeats; i++) {
      let text = '';
      try {
        const r = await chat.provider.chat(useModel, [
          { role: 'user', content: pkt.prompt },
        ], { max_tokens: 500 });
        text = r.content || '';
        // provider-kit 偶尔把 args 当字符串, 抽 content 字段
        if (!text && r.choices) text = r.choices[0]?.message?.content || '';
      } catch (e) {
        scores.push({
          extracted: false, exactMatch: 0, lengthMatch: 0,
          firstByteMatch: 0, byteAccuracy: 0,
          actualLength: 0, expectedLength: pkt.expected.length,
          _error: e.message,
        });
        totalCalls++;
        continue;
      }
      totalCalls++;

      const bytes = extractBytes(text);
      const s = scoreBytes(bytes, pkt.expected);
      scores.push(s);
      responses.push({ text, bytes, score: s });
    }
    perPacket.push({
      id: pkt.id,
      prompt: pkt.prompt,
      expected: pkt.expected,
      fieldLabels: pkt.fieldLabels,
      runs: scores,
      responses,  // 留一份原 LLM 输出供调试
    });
  }

  // 聚合所有 scores
  const allScores = perPacket.flatMap((p) => p.runs);
  return {
    aggregate: aggregateScores(allScores),
    perPacket,
    calls: totalCalls,
    model: useModel,
  };
}

// === dryRun 模式 ===

export async function runDryRun() {
  // 1. 验证 packets.json
  const packets = await loadPackets();
  if (packets.length === 0) throw new Error('packets.json is empty');
  for (const p of packets) {
    if (!Array.isArray(p.expected) || p.expected.length === 0) {
      throw new Error(`${p.id}: expected bytes missing`);
    }
  }

  // 2. 验证 extractor + scoring
  // 标准输出
  const goodText = `
Here's the bytes:
const buf = Buffer.from([0x10, 0x14, 0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3C, 0x00, 0x08, 0x74, 0x65, 0x73, 0x74, 0x2D, 0x31, 0x32, 0x33]);
return buf;
`;
  const bytes = extractBytes(goodText);
  if (!bytes || bytes.length !== 22) {
    throw new Error(`extractor broken: got ${JSON.stringify(bytes)}`);
  }
  if (bytes[0] !== 0x10) throw new Error(`first byte should be 0x10, got 0x${bytes[0]?.toString(16)}`);

  // 十进制输出 (LLM 偶尔这么写)
  const decimalText = `const arr = [16, 20, 0, 4, 77, 81, 84, 84, 4, 2, 0, 60, 0, 8, 116, 101, 115, 116, 45, 49, 50, 51];`;
  const decimalBytes = extractBytes(decimalText);
  if (!decimalBytes || decimalBytes.length !== 22 || decimalBytes[0] !== 16) {
    throw new Error(`decimal extractor broken: got ${JSON.stringify(decimalBytes)}`);
  }

  // 错的内容
  const badText = `// I don't know how to write this`;
  if (extractBytes(badText) !== null) {
    throw new Error('extractor should return null for non-code text');
  }

  // 3. 验证 scoring
  const expected = packets[0].expected;
  const sGood = scoreBytes(bytes, expected);
  if (sGood.exactMatch !== 1) throw new Error(`scorer should match good bytes: ${JSON.stringify(sGood)}`);

  const sBad = scoreBytes([0x10, 0x00], expected);
  if (sBad.firstByteMatch !== 1) throw new Error(`scorer firstByte: ${JSON.stringify(sBad)}`);

  const sEmpty = scoreBytes(null, expected);
  if (sEmpty.extracted !== false) throw new Error(`scorer empty: ${JSON.stringify(sEmpty)}`);

  return {
    aggregate: null,
    perPacket: null,
    calls: 0,
    dryRun: true,
    checks: {
      packetsLoaded: packets.length,
      extractorHandlesHex: true,
      extractorHandlesDecimal: true,
      extractorHandlesEmpty: true,
      scoringAllCorrect: true,
    },
  };
}

// === compose 契约入口 ===

export async function run({ inputs = {} } = {}) {
  const { live = false, ...rest } = inputs;
  if (live) return { outputs: await runLive(rest) };
  return { outputs: await runDryRun() };
}

// === test() ===

const { ok, ng, skip, report } = create();
const NAME = '36-code-ability-diagnostic (dryRun 默认, live 需 E36_LIVE=1)';

async function loadLiveArtifact() {
  const candidates = ['live-100sample.json', 'live-30sample.json', 'live-15sample.json', 'live-run.json'];
  for (const name of candidates) {
    const p = resolve(__dirname, name);
    try {
      const raw = await readFile(p, 'utf8');
      return { name, data: JSON.parse(raw) };
    } catch { /* 文件不存在 */ }
  }
  return null;
}

async function test() {
  let r;
  try {
    r = await runDryRun();
    ok(`dryRun 跑通 (${r.checks.packetsLoaded} packets)`);
    ok(`extractor 处理 hex (0xNN) + 十进制 (NN)`);
    ok(`extractor 对非代码文本返回 null`);
    ok(`scoring: exactMatch / firstByte / empty 三态全过`);
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  if (process.env.E36_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      const a = live.aggregate;
      ok(`live 跑完 ${live.calls} 次 (5 packets × 3 repeats)`);
      ok(`exactMatch=${(a.exactMatch * 100).toFixed(1)}% (字节完全正确)`);
      ok(`firstByteMatch=${(a.firstByteMatch * 100).toFixed(1)}% (第一个字节正确)`);
      ok(`byteAccuracy=${(a.byteAccuracy * 100).toFixed(1)}% (逐字节平均)`);
      ok(`extracted=${(a.extracted * 100).toFixed(1)}% (LLM 输出了能解析的字节)`);
      console.log('\n[E36] aggregate:', JSON.stringify(a));
      for (const p of live.perPacket) {
        const r0 = p.runs[0] || {};
        console.log(`[E36] ${p.id}: exactMatch=${(p.runs.filter((s) => s.exactMatch).length)}/${p.runs.length}, ` +
                    `firstByte=${(p.runs.filter((s) => s.firstByteMatch).length)}/${p.runs.length}, ` +
                    `accuracy=${(p.runs.reduce((acc, s) => acc + s.byteAccuracy, 0) / p.runs.length * 100).toFixed(0)}%`);
      }
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    skip('live 模式需 E36_LIVE=1 (跳过, 避免 token 成本)');
  }

  const artifact = await loadLiveArtifact();
  if (artifact) {
    const a = artifact.data.aggregate || {};
    const verdict = a.exactMatch > 0.5
      ? `模型能写对字节 (exactMatch ${(a.exactMatch * 100).toFixed(0)}%) → 工具调用是瓶颈, C 计划能成`
      : a.firstByteMatch > 0.7
        ? `模型知道 packet type 但写不全 (firstByte ${(a.firstByteMatch * 100).toFixed(0)}%, exactMatch ${(a.exactMatch * 100).toFixed(0)}%) → 部分可救`
        : `模型写不出字节 (exactMatch ${(a.exactMatch * 100).toFixed(0)}%) → 模型能力不足, C 计划需重评`;
    ok(`历史 live [${artifact.name}]: ${verdict}`);
  } else {
    skip('无 live artifact (运行 E36_LIVE=1 生成)');
  }

  report(NAME);
}

export { test };
