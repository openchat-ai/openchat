// === cost-tracker.mjs ===
// === cost-tracker.mjs ===
// dev-repl 的 token/cost 累计 (opencode `/cost` 简化版)
//
// 策略:
//   - 不依赖 provider-kit 返 usage (它不返)
//   - 用"消息字符数 / 4" 粗估 token (业界常用近似, 误差 10-20%)
//   - 成本按 model name 查本地 COST_PER_1K map, 未配 = 0 (显式零不隐藏)
//   - 累加器在 REPL 启动时初始化, 每轮 chat 后调 recordUsage(messages, response)
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { op: 'record', promptChars, completionChars, model } → { tokens, cost, total }
//   { op: 'summary' } → { promptTokens, completionTokens, totalTokens, cost, calls, byModel }
//   { op: 'reset' } → { ok }
//
// === invariants ===
// - 永不抛 (cost 错误降级为 0)
// - 字符→token 系数 4 (业界粗估, 不假装精确)
// - 单价 map 找不到 → 0, 不报错 (用户没配该 model = 显式零成本)
// - summary 返回的 byModel 永远有 'unknown' 兜底

const CHARS_PER_TOKEN = 4;

// 默认单价 (USD / 1K tokens), 缺数据 = 0
// 用户可在 config.json 的 providers.<name>.costPer1k 覆盖
const DEFAULT_COST = {
  // openai
  'gpt-4o':         { input: 0.005,  output: 0.015 },
  'gpt-4o-mini':    { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':    { input: 0.01,   output: 0.03 },
  'gpt-3.5-turbo':  { input: 0.0005, output: 0.0015 },
  // anthropic
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-haiku-20240307':    { input: 0.00025, output: 0.00125 },
  // MiniMax (openchat 自家, 待用户配)
  'MiniMax-M3':     { input: 0,      output: 0 },
};

function charToToken(chars) {
  if (!chars || chars < 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function lookupCost(model, pcfg = {}) {
  if (pcfg.costPer1k) return pcfg.costPer1k; // 用户自定义优先
  return DEFAULT_COST[model] || null;
}

export class CostTracker {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.calls = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalCost = 0;
    this.byModel = {}; // model → { calls, tokens, cost }
  }

  // messages: provider.chat() 的 messages 参数
  // responseContent: response.content 字符串
  // model: 当前 model 名
  // providerName: 当前 provider 名 (查 cfg.providers.<name>.costPer1k)
  recordUsage({ messages, responseContent, model, providerName }) {
    if (!Array.isArray(messages) && typeof messages !== 'string') return { tokens: 0, cost: 0 };
    // 算 prompt chars
    let promptChars = 0;
    if (typeof messages === 'string') {
      promptChars = messages.length;
    } else {
      for (const m of messages) {
        if (typeof m.content === 'string') promptChars += m.content.length;
        if (Array.isArray(m.content)) {
          for (const c of m.content) if (typeof c?.text === 'string') promptChars += c.text.length;
        }
        if (Array.isArray(m.tool_calls)) {
          for (const tc of m.tool_calls) promptChars += JSON.stringify(tc).length;
        }
      }
    }
    const completionChars = typeof responseContent === 'string' ? responseContent.length : 0;
    const promptTok = charToToken(promptChars);
    const completionTok = charToToken(completionChars);

    const pcfg = providerName ? (this.cfg.providers?.[providerName] || {}) : {};
    const costMap = lookupCost(model, pcfg);
    let cost = 0;
    if (costMap) {
      cost = (promptTok / 1000) * (costMap.input || 0) + (completionTok / 1000) * (costMap.output || 0);
    }

    this.calls++;
    this.promptTokens += promptTok;
    this.completionTokens += completionTok;
    this.totalCost += cost;
    const m = this.byModel[model] || (this.byModel[model] = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 });
    m.calls++;
    m.promptTokens += promptTok;
    m.completionTokens += completionTok;
    m.cost += cost;

    return { promptTokens: promptTok, completionTokens: completionTok, cost };
  }

  summary() {
    return {
      calls: this.calls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      cost: Math.round(this.totalCost * 10000) / 10000, // 4 位小数
      byModel: this.byModel,
    };
  }

  compactThreshold() {
    return 125_000;
  }

  compactWarning() {
    const s = this.summary();
    if (s.totalTokens < this.compactThreshold()) return null;
    const pct = Math.round((s.totalTokens / this.compactThreshold()) * 100);
    return `  ⚠ 当前会话已用 ${s.totalTokens.toLocaleString()} tokens (${pct}% of ${this.compactThreshold().toLocaleString()} 阈值)。建议 /compact 重置累积。`;
  }

  burnRate() {
    // 算平均每轮 token 消耗, 预估剩余对话轮数
    const s = this.summary();
    if (s.calls === 0) return { avgPerRound: 0, estimatedRoundsLeft: 0 };
    if (!this._startTime) this._startTime = Date.now();
    const elapsed = (Date.now() - this._startTime) / 1000 / 60; // 分钟
    const avgPerRound = Math.round(s.totalTokens / s.calls);
    const remaining = this.compactThreshold() - s.totalTokens;
    const estimatedRoundsLeft = remaining > 0 && avgPerRound > 0 ? Math.floor(remaining / avgPerRound) : 0;
    return { avgPerRound, estimatedRoundsLeft, totalTokens: s.totalTokens };
  }

  formatSummary() {
    const s = this.summary();
    if (s.calls === 0) return '  cost: 暂无记录 (跑一轮对话后看)';
    const lines = [
      `  calls:     ${s.calls}`,
      `  prompt:    ${s.promptTokens} tokens`,
      `  complete:  ${s.completionTokens} tokens`,
      `  total:     ${s.totalTokens} tokens`,
      `  cost:      $${s.cost.toFixed(4)} USD`,
    ];
    const models = Object.entries(s.byModel);
    if (models.length > 1) {
      lines.push('  by model:');
      for (const [m, v] of models) lines.push(`    ${m}: ${v.promptTokens + v.completionTokens} tok, $${v.cost.toFixed(4)}`);
    }
    const burn = this.burnRate();
    if (burn.avgPerRound > 0) {
      lines.push(`  avg/round: ${burn.avgPerRound} tokens`);
      if (burn.estimatedRoundsLeft > 0) lines.push(`  ~${burn.estimatedRoundsLeft} rounds until compact threshold`);
    }
    const warn = this.compactWarning();
    if (warn) lines.push(warn);
    return lines.join('\n');
  }
}

// compose 入口
export async function run({ inputs = {} } = {}) {
  const { op, cfg, messages, responseContent, model, providerName, tracker } = inputs;
  if (!op) throw new Error('cost-tracker.run: op required');
  if (op === 'new') return { outputs: { tracker: new CostTracker(cfg || {}) } };
  if (op === 'record') {
    const t = tracker instanceof CostTracker ? tracker : new CostTracker(cfg || {});
    return { outputs: t.recordUsage({ messages, responseContent, model, providerName }) };
  }
  if (op === 'summary') {
    const t = tracker instanceof CostTracker ? tracker : new CostTracker(cfg || {});
    return { outputs: t.summary() };
  }
  if (op === 'format') {
    const t = tracker instanceof CostTracker ? tracker : new CostTracker(cfg || {});
    return { outputs: { text: t.formatSummary() } };
  }
  if (op === 'reset') {
    if (tracker instanceof CostTracker) tracker.reset();
    return { outputs: { ok: true } };
  }
  throw new Error(`cost-tracker.run: unknown op "${op}"`);
}

export { DEFAULT_COST, charToToken, lookupCost };
export const META = { id: 'cost-tracker' };

// === provider-health.mjs ===
// === provider-health.mjs ===
// 启动 REPL 前的"完整 LLM 健康诊断" — 替代 dev-repl.mjs:127 那个裸 throw。
// 单文件单职责: 只诊断 provider 可用性 + 生成 actionable 修复指引。
//
// 诊断维度 (按顺序检查, 全部记录, 不短路):
//   1. config 文件存在性
//   2. current.provider 已设置
//   3. current.provider 的 apiKey 是否配置 (provider-kit 兼容表查 skipAuth)
//   4. 降级链: current → openrouter → 其他有 apiKey 的 provider
//   5. 每个候选: 真 ping 端点 (HEAD /models 或 /api/tags, 3s 超时)
//   6. 生成中文 actionable 报告
//
// I/O (compose 契约, 供实验 25 dev-tools 也可调用):
//   { op: 'diagnose', configPath? } → { ok, report, lines, firstAlive, fix }
//
// === invariants ===
// - diagnose() 永不抛 — 所有错误降级为 report.items[i].error
// - ping 超时硬上限 3000ms, 不会 hang 住 REPL 启动
// - alive 判定: 2xx/3xx 才算 alive; 4xx/5xx/timeout/网络错 全部 alive=false
// - 不写盘: 只读 config + 只发 GET ping, 不持久化任何结果
// - silent=true 时不打颜色码 (供测试断言), silent=false 输出 ANSI 着色
// - 降级链构造顺序与 dev-repl.mjs:107-111 行为一致 (current → openrouter → 其他有 apiKey)
// - firstAlive 取**第一个**存活 provider, 不选"最优" (避免策略复杂度)

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const DEFAULT_CONFIG = path.join(os.homedir(), '.config', 'openchat', 'config.json');

const COLOR = {
  reset: '\x1b[0m', dim: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }

async function readConfig(configPath) {
  const p = configPath || DEFAULT_CONFIG;
  try {
    const raw = await fs.readFile(p, 'utf8');
    return { path: p, exists: true, json: JSON.parse(raw), parseError: null };
  } catch (e) {
    if (e.code === 'ENOENT') return { path: p, exists: false, json: null, parseError: null };
    return { path: p, exists: true, json: null, parseError: e.message };
  }
}

// 从 provider-kit 拉预设列表, 拿到 baseUrl + skipAuth
async function loadPresetMeta() {
  try {
    const { PRESET_PROVIDERS, listPresetProviders } = await import('provider-kit');
    // 直接读 PRESET_PROVIDERS (listPresetProviders 不返回 baseUrl, 是 bug)
    const map = {};
    for (const [id, p] of Object.entries(PRESET_PROVIDERS)) {
      map[id] = { baseUrl: p.baseUrl, skipAuth: !!p.skipAuth, name: p.name };
    }
    return map;
  } catch {
    return {};
  }
}

async function pingEndpoint(url, { timeoutMs = 3000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal, headers });
    return { ok: res.status >= 200 && res.status < 400, status: res.status, latencyMs: Date.now() - t0, error: null };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - t0, error: e.name === 'AbortError' ? `timeout (${timeoutMs}ms)` : e.message };
  } finally {
    clearTimeout(t);
  }
}

function fixFor(item) {
  const { provider, apiKey, baseUrl, error } = item;
  if (error === 'config-missing')   return `创建配置文件: openchat config init (或手动建 ${DEFAULT_CONFIG})`;
  if (error === 'parse-error')      return `修复 ${item.path} 的 JSON 语法`;
  if (error === 'no-provider')      return `在 config.json 设 "current": { "provider": "<id>" }`;
  if (apiKey === '') {
    if (provider === 'ollama') return `Ollama 不需要 key — 启动它: ollama serve  (然后: ollama pull <model>)`;
    if (item.skipAuth)         return `${provider} 无需 key, 但端点不通: 检查 ${baseUrl}`;
    return `设置 apiKey: openchat config set ${provider} <your_key>   (或编辑 config.json providers.${provider}.apiKey)`;
  }
  if (error && /timeout|ECONNREFUSED|fetch failed|ENOTFOUND/i.test(error)) {
    if (provider === 'ollama') return `Ollama 端点无响应: 执行 ollama serve (默认监听 11434)`;
    return `${provider} 端点不通 (${baseUrl}): 检查网络/代理, 或换 baseUrl`;
  }
  if (error && /401|403|auth/i.test(error)) return `apiKey 被拒: 重新设置 openchat config set ${provider} <新key>`;
  if (error && /404|model/i.test(error)) return `模型不存在: openchat config set ${provider}.defaultModel <可用model>`;
  if (error && /429/i.test(error))        return `${provider} 限流: 稍后重试, 或换 provider`;
  if (error) return `${provider} 失败: ${error}`;
  return null;
}

export async function diagnose({ configPath, silent = false } = {}) {
  const presetMeta = await loadPresetMeta();
  const cfg = await readConfig(configPath);
  const lines = [];
  const report = { checkedAt: new Date().toISOString(), configPath: cfg.path, items: [] };

  const c = (color, s) => silent ? s : `${color}${s}${COLOR.reset}`;

  lines.push(c(COLOR.bold, '\n  openchat — LLM 健康诊断'));
  lines.push(c(COLOR.dim, `  配置: ${cfg.path}`));

  if (!cfg.exists) {
    lines.push(c(COLOR.red, `  ✗ 配置文件不存在`));
    const item = { stage: 'config', error: 'config-missing' };
    report.items.push(item);
    report.fix = fixFor(item);
    lines.push(c(COLOR.yellow, `  → 修复: ${report.fix}`));
    return { ok: false, report, lines, firstAlive: null, fix: report.fix };
  }
  if (cfg.parseError) {
    lines.push(c(COLOR.red, `  ✗ 配置 JSON 解析失败: ${cfg.parseError}`));
    const item = { stage: 'config', path: cfg.path, error: 'parse-error' };
    report.items.push(item);
    report.fix = fixFor(item);
    lines.push(c(COLOR.yellow, `  → 修复: ${report.fix}`));
    return { ok: false, report, lines, firstAlive: null, fix: report.fix };
  }

  const currentName = cfg.json?.current?.provider;
  if (!currentName) {
    lines.push(c(COLOR.red, `  ✗ 未设置 current.provider`));
    const item = { stage: 'current', error: 'no-provider' };
    report.items.push(item);
    report.fix = fixFor(item);
    lines.push(c(COLOR.yellow, `  → 修复: ${report.fix}`));
    return { ok: false, report, lines, firstAlive: null, fix: report.fix };
  }

  // 构建降级链 (与 dev-repl.mjs:107-111 行为一致)
  const chain = [];
  chain.push({ name: currentName, model: cfg.json.current?.model });
  for (const [name, pcfg] of Object.entries(cfg.json.providers || {})) {
    if (name !== currentName && pcfg?.apiKey) chain.push({ name, model: pcfg.defaultModel });
  }

  lines.push(c(COLOR.dim, `  降级链: ${chain.map(x => x.name).join(' → ')}`));
  lines.push('');

  for (const fb of chain) {
    const pcfg = cfg.json.providers?.[fb.name] || {};
    const preset = presetMeta[fb.name] || {};
    // config 嵌套深: providers.<id>.adapter.<model>.<family>.baseURL
    // 优先 openai (anthropic 不暴露 /models, ping 必然 404)
    const modelCfg = pcfg.adapter?.[fb.model] || {};
    const deepBaseUrl = modelCfg.openai?.baseURL || modelCfg.anthropic?.baseURL || modelCfg.baseURL;
    const baseUrl = deepBaseUrl || pcfg.baseUrl || preset.baseUrl || '';
    const skipAuth = pcfg.skipAuth ?? preset.skipAuth ?? false;
    const apiKey = pcfg.apiKey || '';

    const item = { provider: fb.name, model: fb.model, baseUrl, hasApiKey: !!apiKey, skipAuth };
    report.items.push(item);

    if (!skipAuth && !apiKey) {
      item.error = 'no-api-key';
      item.fix = fixFor(item);
      lines.push(c(COLOR.red, `  ✗ ${pad(fb.name, 14)} apiKey 未配置`));
      lines.push(c(COLOR.yellow, `    → ${item.fix}`));
      continue;
    }

    // 真 ping 端点
    let pingUrl = null;
    if (fb.name === 'ollama') pingUrl = (baseUrl || 'http://localhost:11434') + '/api/tags';
    else if (baseUrl) pingUrl = baseUrl.replace(/\/+$/, '') + '/models';

    if (pingUrl) {
      const headers = {};
      if (!skipAuth && apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const ping = await pingEndpoint(pingUrl, { timeoutMs: 3000, headers });
      item.ping = ping;
      if (ping.ok) {
        item.alive = true;
        lines.push(c(COLOR.green, `  ✓ ${pad(fb.name, 14)} 存活 (${ping.status}, ${ping.latencyMs}ms)`));
        if (!report.firstAlive) report.firstAlive = { name: fb.name, model: fb.model, baseUrl, ping };
      } else {
        item.alive = false;
        item.error = ping.error || `status ${ping.status}`;
        item.fix = fixFor(item);
        lines.push(c(COLOR.red, `  ✗ ${pad(fb.name, 14)} 不可达 (${item.error})`));
        lines.push(c(COLOR.yellow, `    → ${item.fix}`));
      }
    } else {
      item.alive = null; // 跳过 ping, 让 connect() 决定
      lines.push(c(COLOR.dim, `  ? ${pad(fb.name, 14)} 跳过 ping (无 baseUrl, 由 connect() 验证)`));
    }
  }

  lines.push('');
  if (report.firstAlive) {
    lines.push(c(COLOR.green, `  ✓ 找到可用 provider: ${report.firstAlive.name}/${report.firstAlive.model || '(default)'}`));
    return { ok: true, report, lines, firstAlive: report.firstAlive, fix: null };
  }

  // 全部失败: 汇总 actionable 修复
  const fixes = report.items.map(i => i.fix).filter(Boolean);
  const uniqueFixes = [...new Set(fixes)];
  report.fix = uniqueFixes.join('\n  或: ');
  lines.push(c(COLOR.red, `  ✗ 所有 provider 都不可用`));
  for (const f of uniqueFixes) lines.push(c(COLOR.yellow, `    → ${f}`));
  lines.push(c(COLOR.dim, `  提示: 编辑 ${cfg.path} 修好后重试`));
  return { ok: false, report, lines, firstAlive: null, fix: report.fix };
}

// 暴露给 failover-picker 复用 (R6: 不在 dev-repl 里重写 baseUrl 拼接)
export async function pingProvider(name, pcfg = {}, { timeoutMs = 3000 } = {}) {
  const preset = (await loadPresetMeta())[name] || {};
  // config 嵌套深: pcfg.adapter[model].<family>.baseURL (跟 diagnose() 保持一致)
  // 优先 openai (anthropic 不暴露 /models, ping 必然 404)
  const modelName = pcfg._model || '';
  const modelCfg = pcfg.adapter?.[modelName] || {};
  const deepBaseUrl = modelCfg.openai?.baseURL || modelCfg.anthropic?.baseURL || modelCfg.baseURL;
  const baseUrl = deepBaseUrl || pcfg.baseUrl || preset.baseUrl || '';
  if (!baseUrl) return { ok: false, status: 0, latencyMs: 0, error: 'no-baseurl', skipPing: true };
  const skipAuth = pcfg.skipAuth ?? preset.skipAuth ?? false;
  const apiKey = pcfg.apiKey || '';
  if (!skipAuth && !apiKey) return { ok: false, status: 0, latencyMs: 0, error: 'no-api-key' };
  let pingUrl = null;
  if (name === 'ollama') pingUrl = baseUrl.replace(/\/+$/, '') + '/api/tags';
  else pingUrl = baseUrl.replace(/\/+$/, '') + '/models';
  const headers = {};
  if (!skipAuth && apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const result = await pingEndpoint(pingUrl, { timeoutMs, headers });
  return { ...result, baseUrl };  // 把 baseUrl 带回去供 caller 用
}

// export const META = { id: 'provider-health' };

// === failover-picker.mjs ===
// === failover-picker.mjs ===
// 运行时降级链选择器 (替代 dev-repl 里 connect 试错 — 每次失败等 5-10s)
//
// 流程: 对降级链每个候选先做轻量 ping (≤3s), 首个 alive 再 createProvider+connect
//   - 启动时: pickFirstAlive(fallbacks, cfg) → { provider, label, pickedFrom }
//   - 运行时切: pickFirstAlive(remainingFallbacks, cfg) → 同上
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   pickFirstAlive(fallbacks, cfg, { silent, timeoutMs? })
//     → { ok, provider?, label?, pickedFrom, tried: [{name, ping, error?}], fix? }
//
// === invariants ===
// - 真 ping 永不抛 — 全部错误降级为 tried[i].error
// - 真 ping 超时默认 8000ms (可配, 上限 10000). 跟 pingProvider 上限对齐, 给真实 provider 4-6s 留余量.
//   旧默认 3000ms 在 minimax/openrouter 4-6s 真实延迟下会假性超时, 触发 v4 报告里的 pre-flight crash.
// - 只对**首个 alive** 调 createProvider+connect, 不浪费 5-10s 在死端点
// - 不写盘, 不持久化任何结果
// - silent=true 不打 stdout, 供测试断言


export async function pickFirstAlive(fallbacks, cfg = {}, { silent = false, timeoutMs = 8000 } = {}) {
  const tried = [];
  const log = (s) => { if (!silent) process.stdout.write(s); };

  for (const fb of fallbacks) {
    const pcfg = cfg.providers?.[fb.name] || {};
    // 把 model 透给 pingProvider 让它能挖 providers.<id>.adapter.<model>.<family>.baseURL
    const ping = await pingProvider(fb.name, { ...pcfg, _model: fb.model }, { timeoutMs });
    tried.push({ name: fb.name, model: fb.model, ping });

    if (ping.error === 'no-api-key') {
      log(`\x1b[90m[failover] ${fb.name}: 缺 apiKey, 跳过\x1b[0m\n`);
      continue;
    }
    if (ping.error === 'no-baseurl') {
      log(`\x1b[90m[failover] ${fb.name}: 缺 baseUrl, 跳过\x1b[0m\n`);
      continue;
    }
    if (!ping.ok) {
      log(`\x1b[90m[failover] ${fb.name} 不可达 (${ping.status || ping.error}), ${ping.latencyMs}ms\x1b[0m\n`);
      continue;
    }

    // 首个 alive: 真 createProvider + connect
    log(`\x1b[32m[failover] ${fb.name} 存活 (${ping.status}, ${ping.latencyMs}ms), 正在 connect...\x1b[0m`);
    try {
      const { createProvider } = await import('provider-kit');
      // 把 deep-extract 的 baseURL 显式传过去, 避免 createProvider 用错 (api.minimax.com vs api.minimaxi.com)
      const baseUrlOverride = ping.baseUrl && ping.baseUrl !== 'skip' ? ping.baseUrl : null;
      const p = createProvider(fb.name, pcfg.apiKey, baseUrlOverride ? { baseUrl: baseUrlOverride } : {});
      await p.connect(pcfg.apiKey);
      log(' \x1b[32m✓\x1b[0m\n');
      return { ok: true, provider: p, label: `${fb.name}/${fb.model}`, pickedFrom: fb.name, tried };
    } catch (e) {
      log(` \x1b[31m✗ connect 失败: ${e.message?.slice(0, 60)}\x1b[0m\n`);
      tried[tried.length - 1].connectError = e.message;
    }
  }

  // 全部失败
  return {
    ok: false,
    provider: null,
    label: '',
    pickedFrom: null,
    tried,
    fix: '所有 provider 都不可用, 用 `config set <provider> <key>` 或 `ollama serve` 修好后重试',
  };
}

// export const META = { id: 'failover-picker' };

// === error-tracker.mjs ===
// ErrorTracker — 跨轮次错误追踪 + 重试决策
// 记录每次工具调用的错误，判断是否需要重试
// === invariants ===
// - maxAttemptsPerCall=3，同一 call 超过直接标记 fatal
// - similarError(msg1, msg2): 消息相似度判断，防止绕圈

export function createErrorTracker() {
  const history = []; // { tool, args, error, attempt, round }

  return {
    record(tool, args, error, round) {
      history.push({ tool, args: JSON.stringify(args), error, round, ts: Date.now() });
    },

    // 判断是否可以重试
    shouldRetry(tool, args, error) {
      const argsStr = JSON.stringify(args);
      const attempts = history.filter(h =>
        h.tool === tool &&
        h.args === argsStr &&
        _similarError(h.error, error)
      );
      if (attempts.length >= 3) return { retry: false, reason: '超过最大重试次数 (3)' };
      if (error && _isFatal(error)) return { retry: false, reason: '致命错误，不应重试' };
      return { retry: true, attempt: attempts.length + 1 };
    },

    getHistory() {
      return [...history];
    },

    // 获取最近的同类错误
    getLastSimilar(tool, error) {
      const similar = history.filter(h =>
        h.tool === tool && _similarError(h.error, error)
      );
      return similar[similar.length - 1] || null;
    },

    reset() {
      history.length = 0;
    },
  };
}

function _similarError(a, b) {
  if (!a || !b) return a === b;
  return a.includes(b) || b.includes(a) ||
    a.slice(0, 50) === b.slice(0, 50);
}

function _isFatal(error) {
  const fatals = ['traversal denied', 'permission denied', 'access denied',
    'not supported', 'invalid operation', 'unknown tool'];
  return fatals.some(f => error?.toLowerCase().includes(f));
}

// === response-validator.mjs ===
// ResponseValidator — 响应级工具调用批量校验
// 校验 LLM 响应中的所有 tool_calls 是否符合 schema
// === invariants ===
// - 不修改 content，只校验 tool_calls 数组
// - 未知 tool name 算 fatal 错误，不自动跳过
// - 返回 errors 数组，不 throw
// - 5 件套 v2 件套 3 (强契约): 校验参数 type + enum 越界, 输出 shape 不在这层 (runtime call 之后)
//   enum 校验: 若 schema prop 有 enum 数组, value 必须在数组内

function _repairJSON(s) {
  let fixed = s;
  let inStr = false, escape = false;
  for (const c of fixed) { if (escape) { escape = false; continue; } if (c === '\\') { escape = true; continue; } if (c === '"') { inStr = !inStr; } }
  if (inStr) fixed += '"';
  const opens = (fixed.match(/\{/g) || []).length;
  const closes = (fixed.match(/\}/g) || []).length;
  for (let i = 0; i < opens - closes; i++) fixed += '}';
  return fixed;
}

export function validateResponse(response, schemas) {
  const errors = [];
  if (!response || !response.toolCalls || !Array.isArray(response.toolCalls)) {
    return { valid: true, errors: [], toolCalls: [] };
  }

  const validCalls = [];
  for (const tc of response.toolCalls) {
    const name = tc.function?.name || tc.name;
    const rawArgs = tc.function?.arguments || tc.arguments || '{}';
    const schema = _findSchema(schemas, name);

    if (!schema) {
      errors.push({ tool: name, error: `未注册的工具 "${name}"，可用工具: ${schemas.map(s => s.function?.name || s.name).join(', ')}` });
      continue;
    }

    let args;
    let parseError = '';
    try {
      args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
    } catch (e) {
      // 尝试修复常见的 LLM JSON 截断（未闭合的引号/花括号）
      const repaired = _repairJSON(typeof rawArgs === 'string' ? rawArgs : '{}');
      try { args = JSON.parse(repaired); }
      catch (e2) {
        parseError = e2.message?.includes('position') ? e2.message.slice(0, 60) : '语法错误';
        errors.push({ tool: name, error: `JSON 参数解析失败: ${parseError}。收到: ${String(rawArgs).slice(0, 80)}` });
        continue;
      }
    }

    const paramErrors = _validateArgs(args, schema);
    if (paramErrors.length > 0) {
      errors.push({ tool: name, error: `参数校验失败: ${paramErrors.join('; ')}`, args });
    }

    validCalls.push({ name, args, id: tc.id });
  }

  return { valid: errors.length === 0, errors, toolCalls: validCalls };
}

function _findSchema(schemas, name) {
  for (const s of schemas || []) {
    const fn = s.function || s;
    if (fn.name === name) return fn;
  }
  return null;
}

function _validateArgs(args, schema) {
  const errors = [];
  const params = schema.parameters || {};
  const props = params.properties || {};
  const required = params.required || [];

  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      errors.push(`缺少必要参数 "${key}"`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = props[key];
    if (!prop && key !== '$schema') {
      errors.push(`未知参数 "${key}"`);
      continue;
    }
    if (prop?.type && typeof value !== prop.type && prop.type !== 'object' && prop.type !== 'array') {
      errors.push(`参数 "${key}" 应为 ${prop.type}，实际为 ${typeof value}`);
    }
    // 件套 3 强契约: enum 越界校验
    if (Array.isArray(prop?.enum) && !prop.enum.includes(value)) {
      errors.push(`参数 "${key}" 应为 enum [${prop.enum.join(', ')}]，实际为 ${JSON.stringify(value)}`);
    }
  }

  return errors;
}

// === step-enforcer.mjs ===
// StepEnforcer — 步骤前提检查
// 记录已完成的步骤，检查下一步所需的前提是否已满足
// === invariants ===
// - 只检查已注册的前提，未知步骤不报错
// - registerCompleted() 后不可撤销
// - reset() 清空所有状态

export function createStepEnforcer() {
  const completed = new Set();
  const preconditions = new Map(); // stepName → string[] (前提步骤)

  return {
    // 定义步骤依赖: stepName 依赖于 prereqs
    define(stepName, prereqs = []) {
      preconditions.set(stepName, prereqs);
      return this;
    },

    // 批量定义
    defineAll(map) {
      for (const [step, prereqs] of Object.entries(map)) {
        preconditions.set(step, prereqs);
      }
      return this;
    },

    // 标记步骤已完成
    complete(stepName) {
      completed.add(stepName);
      return this;
    },

    // 检查前提是否满足
    // 返回 { ok, missing[] }
    check(stepName) {
      const prereqs = preconditions.get(stepName) || [];
      const missing = prereqs.filter(p => !completed.has(p));
      return { ok: missing.length === 0, missing };
    },

    // 是否已完成
    isComplete(stepName) {
      return completed.has(stepName);
    },

    getCompleted() {
      return [...completed];
    },

    reset() {
      completed.clear();
    },

    list() {
      return Array.from(preconditions.entries()).map(([step, prereqs]) => ({ step, prereqs }));
    },
  };
}

// === guardian.mjs ===
// Guardian — 工具调用的守卫层（验证 + 强制 + 追踪）
// 可注入 skeleton-agent 或 dev-repl，作为可选的 guardrails 层
// === invariants ===
// - wrap(tc, executor): 先校验，通过后执行，返回结果字符串
// - validateResponse(response): 校验整个 LLM 响应
// - MAX_REPEAT=3


export function createGuardian({ tools, stepDeps = {} } = {}) {
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();
  if (Object.keys(stepDeps).length > 0) enforcer.defineAll(stepDeps);
  const callCount = new Map();

  function _parseArgs(tc) {
    const raw = tc.function?.arguments || tc.arguments || '{}';
    try { return { ok: true, args: typeof raw === 'string' ? JSON.parse(raw) : raw }; }
    catch { return { ok: false, error: `[Guardian] 参数非法 JSON: ${String(raw).slice(0, 80)}` }; }
  }

  return {
    // 先校验，再执行。返回 { ok, result/error, bypassedByGuardian? }
    async wrap(tc, executor) {
      const name = tc.function?.name || tc.name;
      const parsed = _parseArgs(tc);
      if (!parsed.ok) return parsed;

      const key = `${name}:${JSON.stringify(parsed.args)}`;
      const cnt = (callCount.get(key) || 0) + 1;
      callCount.set(key, cnt);
      if (cnt > 3) return { ok: false, error: `[Guardian] 循环中止: ${name} 相同参数调用 ${cnt} 次`, bypassedByGuardian: true };

      const check = enforcer.check(name);
      if (!check.ok) return { ok: false, error: `[Guardian] 前置步骤缺失: ${name} 需要先完成 ${check.missing.join(', ')}`, bypassedByGuardian: true };

      try {
        const result = await executor(name, JSON.stringify(parsed.args));
        enforcer.complete(name);
        return { ok: true, result };
      } catch (e) {
        tracker.record(name, parsed.args, e.message, -1);
        return { ok: false, error: `[Error] ${e.message}` };
      }
    },

    // 校验整个 LLM 响应，返回 { valid, toolCalls, errors }
    validateResponse(response) {
      const v = validateResponse(response, tools);
      return v;
    },

    reset() { callCount.clear(); enforcer.reset(); tracker.reset(); },
  };
}

// === neural-bridge.mjs ===
// neural-bridge.mjs — 进程内 NeuralBrain 单例 (always-on)
//
// 设计 (Step 4, L2 局部):
//   1. singleton — 进程内 1 个 NeuralBrain 实例, 避免每 call new 8KB 权重
//   2. always-on — 默认启用. brain 未训时预测是 noise, 但 22.mjs 已容错 (null 时走 base)
//   3. 3 API:    predict(text) / adaptTools / adaptMaxRounds / trainOnOutcome
//   4. 持久化    — NeuralBrain 内部管 ~/.openchat/brain/weights.json
//
// 调用方 (22.mjs / tool-loop) 在 processText 入口调 predict, loop 中调 adapt*,
// 出口调 trainOnOutcome. 跑得越多预测越准, 无需 opt-in.

import { NeuralBrain } from '../../core/memory/neural-brain.js';

let _instance = null;
let _enabled = false;

const READ_ONLY_TOOLS = new Set([
  'read_file', 'grep', 'code_search', 'ast_find_refs', 'find_refs',
  'ast_index', 'ast_search', 'ast_extract', 'ts_typecheck', 'lint_run',
  'test_run', 'test_discover', 'docs_suggest', 'env_diff', 'sec_audit',
  'ci_detect', 'git_log',
]);

const ROUNDS_BY_DIFFICULTY = [10, 15, 20, 30]; // easy → hard

export function init({ enabled = true } = {}) {
  if (_instance) return _instance;
  _enabled = enabled;
  _instance = new NeuralBrain();
  console.debug(`[neural-bridge] always-on (samples=${_instance.trainingSamples}, accuracy=${(_instance.accuracy * 100).toFixed(1)}%)`);
  return _instance;
}

// 暴露给 env 变化时动态切 (测试 / 单 run override)
export function setEnabled(on) { _enabled = !!on; }

export function isEnabled() { return _enabled && !!_instance; }

export function predict(text) {
  if (!_enabled || !_instance) return null;
  return {
    difficulty: _instance.predictDifficulty(text),  // 0-3
    domain: _instance.predictDomain(text),           // math/logic/research/code_review
    canLocal: _instance.canSolveLocally(text),
    samples: _instance.trainingSamples,
  };
}

export function adaptTools(tools, domain) {
  if (!_enabled || !_instance) return tools;
  if (domain !== 'code_review') return tools;
  return tools.filter(t => READ_ONLY_TOOLS.has(t.function?.name));
}

export function adaptMaxRounds(base, difficulty) {
  if (!_enabled || !_instance) return base;
  if (typeof difficulty !== 'number' || difficulty < 0 || difficulty > 3) return base;
  return ROUNDS_BY_DIFFICULTY[difficulty];
}

export function trainOnOutcome({ text, predicted, success, error } = {}) {
  if (!_enabled || !_instance) return null;
  if (!text || !predicted) return null;
  // 失败时: 难度升 1 档, 领域换 logic (代表"判断错")
  const domain = success ? predicted.domain : 'logic';
  const diff = success
    ? predicted.difficulty
    : Math.min(3, (predicted.difficulty ?? 1) + 1);
  const r = _instance.trainOnSolvedProblems([{ question: text, domain, difficulty: diff }]);
  if (error) r.lastError = error.slice(0, 80);
  return r;
}

export function getStats() {
  if (!_instance) return null;
  return _instance.getStats();
}

// === config.mjs ===
import { existsSync, readFileSync } from 'node:fs';

const NEW_CONFIG_FILE = path.join(os.homedir(), '.config', 'openchat', 'config.json');

function loadNewConfig() {
  try {
    if (existsSync(NEW_CONFIG_FILE)) {
      return JSON.parse(readFileSync(NEW_CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.debug('[config] load error:', e.message);
  }
  return null;
}

const _config = loadNewConfig() || {};

export const persistentConfig = {
  get config() { return _config; },
};

// === epc-pipeline.mjs ===
// EPC pipeline: LLM 响应 → EPC 字节流 (inbound 显式 4 步) + System prompt 拼段
//
// === Inbound (LLM → us): runPipeline ===
//   provider-kit 的 adapter 已经把 raw 响应做完了 4 个处理 (think 剥除 / reasoning 提取 /
//   tool_calls 标准化 / ACTION: 降级) 并返回 { content, toolCalls, epc }。
//   runPipeline 在 openchat 这一层"显式过一道" — 让数据流可见可测, 函数都是幂等的。
//   4 个纯函数从 provider-kit 导入, 单一来源。
//
// === Outbound (us → LLM): getEditProtocolGuidance ===
//   拼到 skeleton-agent 的 SYSTEM_PROMPT 末尾, 引导 LLM:
//     - 大文件 (≥80 行) + 单行编辑时, 用 hash_edit 而不是 edit_file (省 50%+ tokens)
//     - 多行 / 小文件 → edit_file
//     - 新文件 → write_file
//   协议选用交给 LLM (在 prompt 里明说), 不在 runtime 拦截 —
//   拦截会破坏 FC 协议, 又难以观测。
//
// 用法:
//   import { runPipeline, getEditProtocolGuidance } from './epc-pipeline.mjs';
//   // Inbound
//   const r = await _provider.chat(model, messages, { includeRaw: false });
//   const p = runPipeline(r);   // { rawContent, content, reasoningContent, toolCalls, epc }
//   // System prompt
//   const prompt = `${baseSystemPrompt}\n\n${getEditProtocolGuidance()}`;

import { epcFromResponse, extractContent, extractReasoning, normalizeToolCalls, parseActionFallback } from 'provider-kit';

/** 把 (content, reasoningContent, toolCalls) 装进 EPC 帧 */
export function buildEpc({ content, reasoningContent = '', toolCalls = [] }) {
  return epcFromResponse({ content, reasoningContent, toolCalls });
}

/**
 * 主入口: 显式过 4 步 + 装 EPC
 * @param {object} rawResponse  provider.chat(...) 返回的响应
 *                              通常 = { content, toolCalls, epc, raw? }
 *                              (注: reasoningContent 不在顶层, 只在 epc SUB_THINKING 帧里)
 * @returns {object} { rawContent, content, reasoningContent, toolCalls, epc }
 *
 * 注: provider-kit 的 adapter 已经做过 4 步处理, 这里再过一道是"显式可见"的兜底。
 *     4 个函数都从 provider-kit 导入且都是幂等的 — 二次处理不改变数据。
 */
export function runPipeline(rawResponse) {
  // rawContent 在这里是"半成品" (provider-kit 已处理过) — 我们再 extractContent 兜底确保干净
  const rawContent = rawResponse?.content || '';
  const reasoningContent = extractReasoning(rawResponse);
  let toolCalls = normalizeToolCalls(rawResponse?.toolCalls);
  toolCalls = parseActionFallback(rawContent, toolCalls);
  const content = extractContent(rawContent);
  const epc = buildEpc({ content, reasoningContent, toolCalls });
  return { rawContent, content, reasoningContent, toolCalls, epc };
}

/**
 * 给 LLM 看的"工具选用指南" — 拼到 system prompt 里, 让 LLM 自己挑最省 token 的协议。
 *
 * 设计:
 *   - 不在 runtime 拦截 LLM 的 edit_file 调用 (会破坏 FC 协议 + 难以观测)
 *   - 改在 system prompt 里"明说" — LLM 看到后会主动用 hash_edit
 *   - hash_edit 工具在 coding-tools.mjs: executeTool('hash_edit', { path, hash, newContent })
 *
 * @returns {string} 拼到 system prompt 末尾的纯文本
 */
export function getEditProtocolGuidance() {
  return `## 工具选用指南 (省 token)
编辑代码时, 根据"目标文件大小" + "编辑范围" 选用最省 token 的工具:

1. **新建/全量重写文件** → 用 \`write_file\` (无替代)
2. **单行修改 (search/newStr 都不含换行) + 文件 ≥80 行** → 用 \`hash_edit\`
   - 8 字符 md5 hash 替代整个 search 串, token 可省 50%+
   - 格式: { path, hash: "8位hex", newContent: "新行完整内容" }
3. **多行修改 / 小文件 (<80 行)** → 用 \`edit_file\`
4. **修改多行不相邻** → 用 \`multi_edit\` (批量)

> 注: edit_file 的 search 串必须**完整且唯一** (含前导空格、缩进)。如果你不能确认唯一性, 优先 hash_edit。`;
}

// === provider-service.js ===
// Bridge-side provider-kit wrapper.
// This is the ONLY file that imports from 'provider-kit'.
// All other bridge code must use this service or go through sessionManager/agentEngine.
import { providerManager, providerRegistry, getRuntimeApiKey, getRuntimeBaseUrl, PRESET_PROVIDERS, DEFAULT_PROVIDER } from 'provider-kit';

export { getRuntimeApiKey, getRuntimeBaseUrl, PRESET_PROVIDERS, DEFAULT_PROVIDER };

export function getProviderConfig(type) {
  return providerManager.getProviderConfig(type);
}
export function listProviders() {
  return providerManager.listProviders();
}
export function getProvider(id) {
  return providerManager.getProvider(id);
}
export function listModels(provider) {
  return providerManager.listModels(provider);
}
export function getDefaultModel(providerName) {
  return providerManager.getDefaultModel(providerName);
}
export function addCustomProvider(name, baseUrl, apiKey, model) {
  return providerManager.addCustomProvider(name, baseUrl, apiKey, model);
}

export function listAll() {
  return providerRegistry.listAll();
}
export function listConfigured() {
  return providerRegistry.listConfigured();
}
export function getModels(providerId) {
  return providerRegistry.getModels(providerId);
}
export function refreshModels(providerId) {
  return providerRegistry.refreshModels(providerId);
}
export function configureProvider(providerId, config) {
  return providerRegistry.configure(providerId, config);
}

export function getProviderInstance(providerId) {
  return providerRegistry.getProvider(providerId);
}



