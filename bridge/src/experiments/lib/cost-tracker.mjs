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
