// index.mjs — E35 narrow-tools 实验
//
// 目的: 测 "工具数量" 对弱模型选对工具的影响
//   WIDE   = 40 tools
//   NARROW = 10 tools (与 10 个 prompt 相关)
// 假设: NARROW 在 toolPick / validCall 上显著高于 WIDE
//
// 模式:
//   test() 默认走 dryRun (无 LLM 调用), 验证 tool-set + prompt 完整性 + scoring
//   run({ live: true }) 才发真 LLM 调用

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { create } from '../lib/report.mjs';
import { WIDE_TOOLS, NARROW_TOOLS, TOOL_SET_SIZE, validateNarrow } from './tool-sets.mjs';
import { scoreCall, aggregateScores, extractFirstCall } from './scoring.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const META = {
  id: '35-narrow-tools',
  name: 'Narrow tools 测量 (WIDE 40 vs NARROW 10)',
  status: 'closed-loop',
  needsEnv: [],
  needsEnvLive: ['OPENCHAT_PROVIDER'],
  inputs: [
    { name: 'live', type: 'boolean', required: false, default: false,
      description: 'true = 跑真 LLM; false = dryRun' },
    { name: 'repeats', type: 'number', required: false, default: 3,
      description: '每 prompt 重复次数 (live)' },
  ],
  outputs: [
    { name: 'wide', 'type': 'object', description: 'WIDE 条件聚合分数' },
    { name: 'narrow', 'type': 'object', description: 'NARROW 条件聚合分数' },
    { name: 'delta', 'type': 'object', description: 'narrow - wide 差值' },
    { name: 'calls', 'type': 'number', description: '总 LLM 调用次数' },
  ],
};

export async function loadPrompts() {
  const raw = await readFile(resolve(__dirname, 'prompts.json'), 'utf8');
  const data = JSON.parse(raw);
  return data.prompts;
}

// === LLM 客户端 (live 模式) — 跟 E34 同款 ===

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
  return await chat.chat(model, [
    { role: 'user', content: promptText },
  ], { tools });
}

// === live 模式 ===

export async function runLive({ repeats = 3, model = null } = {}) {
  const chat = await createChatClient();
  const useModel = model || chat.model;
  const prompts = await loadPrompts();
  const conditions = [
    { name: 'wide', tools: WIDE_TOOLS },
    { name: 'narrow', tools: NARROW_TOOLS },
  ];
  const allScores = { wide: [], narrow: [] };
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
    wide: aggregateScores(allScores.wide),
    narrow: aggregateScores(allScores.narrow),
    delta: deltas(aggregateScores(allScores.wide), aggregateScores(allScores.narrow)),
    calls: totalCalls,
    model: useModel,
  };
}

function deltas(a, b) {
  if (!a || !b) return null;
  const keys = ['toolPick', 'paramName', 'paramValue', 'validCall', 'noToolCall'];
  const d = {};
  for (const k of keys) d[k] = b[k] - a[k];
  d.extraFields = a.extraFields - b.extraFields;  // 反向: 越少越好
  return d;
}

// === dryRun 模式 ===

export async function runDryRun() {
  // 1. 验证 tool set 数量
  if (TOOL_SET_SIZE.wide === 0) throw new Error('WIDE_TOOLS is empty');
  if (TOOL_SET_SIZE.narrow === 0) throw new Error('NARROW_TOOLS is empty');
  if (TOOL_SET_SIZE.wide === TOOL_SET_SIZE.narrow) {
    throw new Error('WIDE and NARROW have same size — narrowing failed');
  }
  if (TOOL_SET_SIZE.narrow !== 10) {
    throw new Error(`NARROW should be 10 tools, got ${TOOL_SET_SIZE.narrow}`);
  }

  // 2. 验证 NARROW 包含所有 10 个 prompt 期望的 tool
  const prompts = await loadPrompts();
  if (prompts.length !== 10) throw new Error(`expected 10 prompts, got ${prompts.length}`);
  const v = validateNarrow(prompts);
  if (!v.ok) throw new Error(`NARROW 缺少期望 tool: ${v.missing.join(', ')}`);

  // 3. 验证 scoring 函数
  const goodCall = { name: 'read_file', arguments: '{"path": "src/index.js"}' };
  const sGood = scoreCall(goodCall, { name: 'read_file', args: { path: 'src/index.js' } });
  if (sGood.toolPick !== 1 || sGood.paramName !== 1 || sGood.paramValue !== 1 ||
      sGood.extraFields !== 0 || sGood.validCall !== 1) {
    throw new Error(`scorer broken on good call: ${JSON.stringify(sGood)}`);
  }

  const noCall = null;
  const sNone = scoreCall(noCall, { name: 'read_file', args: { path: 'src/index.js' } });
  if (sNone.noToolCall !== 1 || sNone.toolPick !== 0) {
    throw new Error(`scorer broken on no call: ${JSON.stringify(sNone)}`);
  }

  // 4. 模拟 5 正确 + 5 错 (跟 E34 同款)
  const fakeScores = prompts.map((p, i) => {
    if (i % 2 === 0) {
      return scoreCall({ name: p.expect.name, arguments: JSON.stringify({ ...p.expect.args }) }, p.expect);
    } else {
      return scoreCall({ name: 'wrong_tool', arguments: '{"x": 1}' }, p.expect);
    }
  });
  const agg = aggregateScores(fakeScores);
  if (Math.abs(agg.toolPick - 0.5) > 0.01) {
    throw new Error(`aggregate toolPick expected 0.5, got ${agg.toolPick}`);
  }

  return {
    wide: null,
    narrow: null,
    delta: null,
    calls: 0,
    dryRun: true,
    checks: {
      wide: TOOL_SET_SIZE.wide,
      narrow: TOOL_SET_SIZE.narrow,
      promptsLoaded: prompts.length,
      narrowCoversExpectations: v.ok,
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

// === test() — 默认 dryRun ===

const { ok, ng, skip, report } = create();
const NAME = '35-narrow-tools (dryRun 默认, live 需 E35_LIVE=1)';

async function loadLiveArtifact() {
  const candidates = ['live-100sample.json', 'live-30sample.json', 'live-run.json'];
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
    ok(`dryRun 跑通 (wide=${r.checks.wide}, narrow=${r.checks.narrow}, prompts=${r.checks.promptsLoaded})`);
    ok(`NARROW 包含所有 10 个 prompt 期望的 tool`);
    ok('scoring 函数: good/no-call 两态全通过');
  } catch (e) {
    ng(`dryRun 失败: ${e.message}`);
    return report(NAME);
  }

  if (process.env.E35_LIVE === '1') {
    try {
      const live = await runLive({ repeats: 3 });
      ok(`live 跑完 ${live.calls} 次`);
      ok(`wide.validCall=${live.wide.validCall.toFixed(3)}, narrow.validCall=${live.narrow.validCall.toFixed(3)}`);
      ok(`delta.validCall=${live.delta.validCall.toFixed(3)} (正数=narrow 更好)`);
      console.log('\n[E35] wide:  ', JSON.stringify(live.wide));
      console.log('[E35] narrow:', JSON.stringify(live.narrow));
      console.log('[E35] delta: ', JSON.stringify(live.delta));
    } catch (e) {
      ng(`live 失败: ${e.message}`);
    }
  } else {
    skip('live 模式需 E35_LIVE=1 (跳过, 避免 token 成本)');
  }

  const artifact = await loadLiveArtifact();
  if (artifact) {
    const d = artifact.data;
    const n = d.wide?.n || 0;
    const dValid = (d.narrow?.validCall ?? 0) - (d.wide?.validCall ?? 0);
    const verdict = dValid > 0.05
      ? `NARROW 显著好 +${(dValid * 100).toFixed(1)}% validCall (${n}/cond 置信)`
      : dValid < -0.05
        ? `NARROW 显著差 ${(dValid * 100).toFixed(1)}% (${n}/cond 置信)`
        : `NARROW 与 WIDE 在 validCall 上无显著差异 (±5% 噪声内, ${n}/cond)`;
    ok(`历史 live [${artifact.name}] n=${n}/cond: ${verdict}`);
  } else {
    skip('无 live artifact (运行 E35_LIVE=1 生成)');
  }

  report(NAME);
}

export { test };
