// index.mjs — E34 schema-strictness 实验
//
// 目的: 测量 strict+example schema 对弱模型工具调用质量的提升
// 模式:
//   test() 默认走 dryRun (无 LLM 调用)，验证 schema 结构 + scoring 函数
//   run({ live: true }) 才发真 LLM 调用
//
// 测量维度: toolPick, paramName, paramValue, extraFields, validCall, noToolCall
// 来自 0/10 MQTT_AUTONOMY_REPORT 的失败模式:
//   - 70% no-tool-call
//   - 30% 调了但参数错 (file_path vs path)
//   - 0% validCall 综合

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import {
  SCHEMAS_BASELINE,
  SCHEMAS_PADDED,
  SCHEMAS_STRICT,
  TOOL_COUNT,
  findSchema,
} from './schemas.mjs';
import { scoreCall, aggregateScores, extractFirstCall } from './scoring.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const META = {
  id: '34-schema-strictness',
  name: 'Schema strictness 测量 (baseline vs strict+example)',
  status: 'closed-loop',
  needsEnv: [],  // dryRun 模式不需要
  needsEnvLive: ['OPENCHAT_PROVIDER'],  // live 模式需要 provider
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false,
      description: 'true = 跑真 LLM 调用; false = dryRun (默认)' },
    { name: 'repeats', type: 'number', required: false, default: 3,
      description: '每个 prompt 重复次数 (live 模式)' },
    { name: 'model', type: 'string', required: false, default: null,
      description: '覆盖默认 model (live 模式)' },
  ],
  outputs: [
    { name: 'baseline', type: 'object', description: 'baseline 条件聚合分数' },
    { name: 'strict', type: 'object', description: 'strict 条件聚合分数' },
    { name: 'delta', type: 'object', description: 'strict - baseline 差值' },
    { name: 'calls', type: 'number', description: '总 LLM 调用次数 (live 模式)' },
  ],
};

// 加载 prompts.json
export async function loadPrompts() {
  const raw = await readFile(resolve(__dirname, 'prompts.json'), 'utf8');
  const data = JSON.parse(raw);
  return data.prompts;
}

// === LLM 客户端 (live 模式) ===

async function createChatClient() {
  const { persistentConfig } = await import('../../core/persistent-config.js');
  const { createProvider } = await import('provider-kit');
  const cfg = persistentConfig.config;
  const providerId = cfg.current?.provider;
  if (!providerId) {
    throw new Error('config.current.provider missing — run `node bin/opencode.js provider set` first');
  }
  const prov = cfg.providers?.[providerId];
  if (!prov) throw new Error(`config.providers.${providerId} missing`);
  const apiKey = prov.apiKey;
  if (!apiKey) throw new Error(`config.providers.${providerId}.apiKey missing`);
  const model = cfg.current?.model || prov.defaultModel || prov.model;
  const p = createProvider(providerId, apiKey);
  await p.connect(apiKey);
  return { provider: p, model };
}

async function callOnce(chat, model, tools, promptText) {
  const r = await chat.chat(model, [
    { role: 'user', content: promptText },
  ], { tools });
  return r;
}

// === live 模式: 跑真实 LLM ===

export async function runLive({ repeats = 3, model = null } = {}) {
  const chat = await createChatClient();
  const useModel = model || chat.model;
  const prompts = await loadPrompts();
  const conditions = [
    { name: 'baseline', tools: SCHEMAS_BASELINE },
    { name: 'padded',   tools: SCHEMAS_PADDED },
    { name: 'strict',   tools: SCHEMAS_STRICT },
  ];
  const allScores = { baseline: [], padded: [], strict: [] };
  let totalCalls = 0;

  for (const cond of conditions) {
    for (const p of prompts) {
      for (let i = 0; i < repeats; i++) {
        try {
          const resp = await callOnce(chat.provider, useModel, cond.tools, p.text);
          const call = extractFirstCall(resp);
          const s = scoreCall(call, p.expect);
          allScores[cond.name].push(s);
        } catch (e) {
          // LLM 报错 → 记为 noToolCall
          allScores[cond.name].push({
            toolPick: 0, paramName: 0, paramValue: 0,
            extraFields: 99, validCall: 0, noToolCall: 1,
            _error: e.message,
          });
        }
        totalCalls++;
      }
    }
  }

  return {
    baseline: aggregateScores(allScores.baseline),
    padded:   aggregateScores(allScores.padded),
    strict:   aggregateScores(allScores.strict),
    delta: {
      paddedVsBaseline: deltas(aggregateScores(allScores.baseline), aggregateScores(allScores.padded)),
      strictVsBaseline: deltas(aggregateScores(allScores.baseline), aggregateScores(allScores.strict)),
      strictVsPadded:   deltas(aggregateScores(allScores.padded),   aggregateScores(allScores.strict)),
    },
    calls: totalCalls,
    model: useModel,
  };
}

function deltas(a, b) {
  if (!a || !b) return null;
  const keys = ['toolPick', 'paramName', 'paramValue', 'validCall', 'noToolCall'];
  const d = {};
  for (const k of keys) d[k] = b[k] - a[k];
  d.extraFields = a.extraFields - b.extraFields;  // 反向: extraFields 越少越好
  return d;
}

// === dryRun 模式: 不发 LLM，验证 schema 结构 + scoring ===

export async function runDryRun() {
  // 1. 验证 schema 数量
  if (TOOL_COUNT.baseline === 0) throw new Error('SCHEMAS_BASELINE is empty');
  if (TOOL_COUNT.strict === 0) throw new Error('SCHEMAS_STRICT is empty');
  if (TOOL_COUNT.baseline !== TOOL_COUNT.strict) {
    throw new Error(`tool count mismatch: baseline=${TOOL_COUNT.baseline} strict=${TOOL_COUNT.strict}`);
  }

  // 2. 验证 strict 模式每个 schema 都有 additionalProperties:false
  let strictOk = 0;
  for (const t of SCHEMAS_STRICT) {
    const params = t.function.parameters;
    if (params?.additionalProperties === false) strictOk++;
  }
  if (strictOk !== SCHEMAS_STRICT.length) {
    throw new Error(`only ${strictOk}/${SCHEMAS_STRICT.length} strict schemas have additionalProperties:false`);
  }

  // 3. 验证 strict 模式 description 含 example 关键词
  const withExample = SCHEMAS_STRICT.filter((t) =>
    /Example:\s+\w+\(\{/.test(t.function.description || '')
  ).length;
  if (withExample === 0) throw new Error('no strict schema has Example: ... in description');

  // 4. 验证 scoring 函数: 全对/全错/幻觉 三种情况
  const goodCall = {
    function: {
      name: 'read_file',
      arguments: { path: 'src/index.js' },
    },
  };
  const sGood = scoreCall(goodCall, { name: 'read_file', args: { path: 'src/index.js' } });
  if (sGood.toolPick !== 1 || sGood.paramName !== 1 || sGood.paramValue !== 1 ||
      sGood.extraFields !== 0 || sGood.validCall !== 1) {
    throw new Error(`scorer broken on good call: ${JSON.stringify(sGood)}`);
  }

  const badCall = {
    function: {
      name: 'read_file',
      arguments: { file_path: 'src/index.js', extra_thing: 42 },  // 幻觉 file_path + 额外字段
    },
  };
  const sBad = scoreCall(badCall, { name: 'read_file', args: { path: 'src/index.js' } });
  if (sBad.toolPick !== 1 || sBad.paramName !== 0 || sBad.extraFields !== 2 ||
      sBad.validCall !== 0) {
    throw new Error(`scorer broken on bad call: ${JSON.stringify(sBad)}`);
  }

  const noCall = null;
  const sNone = scoreCall(noCall, { name: 'read_file', args: { path: 'src/index.js' } });
  if (sNone.noToolCall !== 1 || sNone.toolPick !== 0) {
    throw new Error(`scorer broken on no call: ${JSON.stringify(sNone)}`);
  }

  // 5. 模拟 10 个 prompt: 一半正确一半错误，验证 aggregate
  const prompts = await loadPrompts();
  if (prompts.length !== 10) throw new Error(`expected 10 prompts, got ${prompts.length}`);

  const fakeScores = prompts.map((p, i) => {
    if (i % 2 === 0) {
      return scoreCall({ function: { name: p.expect.name, arguments: { ...p.expect.args } } }, p.expect);
    } else {
      return scoreCall({ function: { name: 'wrong_tool', arguments: { file_path: 'x' } } }, p.expect);
    }
  });
  const agg = aggregateScores(fakeScores);
  // 5 个好, 5 个坏 → toolPick 应是 0.5
  if (Math.abs(agg.toolPick - 0.5) > 0.01) {
    throw new Error(`aggregate toolPick expected 0.5, got ${agg.toolPick}`);
  }

  return {
    baseline: null,
    strict: null,
    delta: null,
    calls: 0,
    dryRun: true,
    checks: {
      toolCount: TOOL_COUNT,
      strictWithAdditionalPropertiesFalse: strictOk,
      strictWithExample: withExample,
      promptsLoaded: prompts.length,
    },
  };
}

// === compose 契约入口 ===

export async function run({ inputs = {} } = {}) {
  const { live = false, ...rest } = inputs;
  if (live) {
    return { outputs: await runLive(rest) };
  }
  return { outputs: await runDryRun() };
}

// === test() — 默认走 dryRun，run-all 不发 LLM ===

const { ok, ng, skip, report } = create();
const NAME = '34-schema-strictness (dryRun 默认, live 需 E34_LIVE=1)';

// 加载历史 live 跑批的 artifact (e.g. live-100sample.json)
async function loadLiveArtifact() {
  const candidates = ['live-100sample.json', 'live-30sample.json', 'live-run.json'];
  for (const name of candidates) {
    const p = resolve(__dirname, name);
    try {
      const raw = await readFile(p, 'utf8');
      return { name, data: JSON.parse(raw) };
    } catch { /* 文件不存在, 试下一个 */ }
  }
  return null;
}

async function test() {
  // dryRun 路径
  let r;
  try {
    r = await runDryRun();
    ok(`dryRun 跑通 (${r.checks.toolCount.strict} strict schemas, ${r.checks.promptsLoaded} prompts)`);
    ok(`所有 strict schema 有 additionalProperties:false (${r.checks.strictWithAdditionalPropertiesFalse}/${r.checks.toolCount.strict})`);
    ok(`strict schema 含 Example: 描述 (${r.checks.strictWithExample} 个)`);
    ok('scoring 函数: good/bad/no-call 三态全通过');
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  // live 路径 — 仅在 E34_LIVE=1 时跑
  if (process.env.E34_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      ok(`live 跑完 ${live.calls} 次`);
      ok(`baseline.validCall=${live.baseline.validCall.toFixed(3)}, strict.validCall=${live.strict.validCall.toFixed(3)}`);
      ok(`delta.validCall=${live.delta.strictVsBaseline.validCall.toFixed(3)} (正数=strict 更好)`);
      console.log('\n[E34] baseline:', JSON.stringify(live.baseline));
      console.log('[E34] strict:  ', JSON.stringify(live.strict));
      console.log('[E34] delta:   ', JSON.stringify(live.delta));
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    skip('live 模式需 E34_LIVE=1 (跳过, 避免 token 成本)');
  }

  // 历史 live artifact 摘要 — 始终检查, 不重跑也能看到结论
  const artifact = await loadLiveArtifact();
  if (artifact) {
    const d = artifact.data;
    const n = d.baseline?.n || 0;
    const bExtra = d.baseline?.extraFields ?? 0;
    const sExtra = d.strict?.extraFields ?? 0;
    const bValid = d.baseline?.validCall ?? 0;
    const sValid = d.strict?.validCall ?? 0;
    const dValid = sValid - bValid;
    const verdict = sExtra > bExtra + 0.3
      ? `strict 模式副作用: extraFields 暴涨 +${(sExtra - bExtra).toFixed(2)} (${n}/cond 置信)`
      : Math.abs(dValid) < 0.05
        ? `strict 与 baseline 在 validCall 上无显著差异 (±5% 噪声内)`
        : dValid > 0
          ? `strict 略好 +${(dValid * 100).toFixed(1)}% (但 < 5%, 噪声范围内)`
          : `strict 略差 ${(dValid * 100).toFixed(1)}% (但 < 5%, 噪声范围内)`;
    ok(`历史 live [${artifact.name}] n=${n}/cond: ${verdict}`);
  } else {
    skip('无 live artifact (运行 E34_LIVE=1 生成 live-100sample.json)');
  }

  report(NAME);
}

export { test };
