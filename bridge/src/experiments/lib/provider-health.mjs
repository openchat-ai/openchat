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

export const META = { id: 'provider-health' };
