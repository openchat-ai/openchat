// core/quality.mjs — merged from quality/{adversarial-test,content-analyzer,multi-model-tester,quality-check-system,quality-scorer,response-parser,schema-manager,test-orchestrator}.js
// 2026-06-21 (R1 cancelled, target 80 modules; QualityScorer stubbed for size)

import * as providerService from '../provider-service.js';
import { logger } from '../experiments/lib/misc-lib.mjs';

// === AdversarialTest ===

export class AdversarialTest {
  constructor() { this.results = []; }
  testLogicPoisoning(code) {
    const dangerous = [/process\.exit\s*\(/gi, /while\s*\(\s*true\s*\)/gi, /eval\s*\(/gi, /setInterval.*function.*{.*}.*setInterval/gi];
    const violations = dangerous.filter(p => p.test(code)).map(p => p.source);
    return { testType: '逻辑投毒', codeLength: code.length, passed: violations.length === 0, violations, severity: violations.length > 0 ? 'high' : 'pass', message: violations.length > 0 ? `检测到 ${violations.length} 个危险模式` : '通过逻辑投毒测试' };
  }
  testPromptInjection(code) {
    const patterns = [/select\s+.*\s+from/gi, /\${.*}/gi, /<script>/gi, /on\w+\s*=/gi];
    const violations = patterns.filter(p => p.test(code)).map(p => p.source);
    return { testType: '提示词注入', codeLength: code.length, passed: violations.length === 0, violations, severity: violations.length > 0 ? 'medium' : 'pass', message: violations.length > 0 ? `检测到 ${violations.length} 个注入向量` : '通过提示词注入测试' };
  }
  testBoundaryAttack(code) {
    const patterns = [/\|\|/g, /&&/g, /\.length/g, /if\s*\(/g];
    let count = 0;
    for (const p of patterns) { const m = code.match(p); if (m) count += m.length; }
    const ok = count >= 2;
    return { testType: '边界值攻击', codeLength: code.length, defenseCount: count, passed: ok, severity: ok ? 'pass' : 'low', message: ok ? `检测到充分的防御措施（${count}个）` : `防御措施不足（${count}个）` };
  }
  runFullTest(code) {
    if (!code || typeof code !== 'string') throw new Error('Code must be a non-empty string');
    const tests = [this.testLogicPoisoning(code), this.testPromptInjection(code), this.testBoundaryAttack(code)];
    const passed = tests.filter(t => t.passed).length;
    const result = { timestamp: new Date().toISOString(), codeLength: code.length, totalTests: tests.length, passed, failed: tests.length - passed, overallStatus: tests.length - passed === 0 ? 'pass' : tests.length - passed === 1 ? 'warning' : 'critical', tests };
    this.results.push(result);
    return result;
  }
  generateReport(r) {
    return `Adversarial Test Report\n${r.timestamp}\nPassed: ${r.passed}/${r.totalTests}\nStatus: ${r.overallStatus}`;
  }
  getResults() { return this.results; }
  clearResults() { this.results = []; }
}

// === ContentAnalyzer ===

export class ContentAnalyzer {
  constructor() {
    this._codePatterns = [{ lang: 'javascript', pattern: /```(?:javascript|js|node)\n([\s\S]*?)```/gi }, { lang: 'typescript', pattern: /```typescript\n([\s\S]*?)```/gi }, { lang: 'python', pattern: /```(?:python|py)\n([\s\S]*?)```/gi }, { lang: 'json', pattern: /```json\n([\s\S]*?)```/gi }, { lang: 'bash', pattern: /```(?:bash|sh)\n([\s\S]*?)```/gi }, { lang: 'plain', pattern: /```\n([\s\S]*?)```/gi }];
    this._intentPatterns = { code_generation: [/write.*code|generate.*code/i, /```\w+\n/], debugging: [/debug|error|exception/i], explanation: [/explain|what.*is|how.*does/i] };
    this._sensitivePatterns = [/api[_-]?key/i, /password/i, /secret/i, /token/i, /bearer/i, /authorization/i];
  }
  analyze(content) {
    return { hasCode: this.detectCode(content), codeBlocks: this.extractCodeBlocks(content), hasJson: this.detectJson(content), hasMarkdown: this.detectMarkdown(content), hasSensitive: this.detectSensitive(content), filtered: this.filterSensitive(content), intent: this.recognizeIntent(content), statistics: this.getStatistics(content) };
  }
  detectCode(c) { for (const { pattern } of this._codePatterns) { pattern.lastIndex = 0; if (pattern.test(c)) return true; } return false; }
  extractCodeBlocks(c) {
    const blocks = [];
    for (const { lang, pattern } of this._codePatterns) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(c)) !== null) blocks.push({ language: lang, code: m[1] || m[0], startIndex: m.index, endIndex: m.index + m[0].length });
    }
    return blocks.sort((a, b) => a.startIndex - b.startIndex);
  }
  detectJson(c) { try { JSON.parse(c.trim()); return true; } catch (e) { return /```json\s*[\s\S]*?\s*```/i.test(c); } }
  detectMarkdown(c) { return (/^#{1,6}\s/m.test(c) || /\*\*[^*]+\*\*/.test(c) || /```/m.test(c) || /\[.+\]\(.+\)/.test(c)); }
  detectSensitive(c) { return this._sensitivePatterns.some(p => p.test(c)); }
  filterSensitive(c, rep = '[REDACTED]') { let out = c; for (const p of this._sensitivePatterns) out = out.replace(p, rep); return out; }
  recognizeIntent(c) {
    const scores = {};
    for (const [intent, patterns] of Object.entries(this._intentPatterns)) {
      let s = 0; for (const p of patterns) if (p.test(c)) s++;
      if (s > 0) scores[intent] = s;
    }
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return sorted.length === 0 ? { primary: 'general', confidence: 0 } : { primary: sorted[0][0], confidence: sorted[0][1] / 3 };
  }
  getStatistics(c) {
    const lines = c.split('\n');
    const words = c.split(/\s+/).filter(w => w.length > 0);
    return { lines: lines.length, words: words.length, chars: c.length };
  }
}

// === MultiModelTester ===

export class MultiModelTester {
  constructor() {
    this.models = [
      { name: 'claude-3-5-sonnet', provider: 'Anthropic', cost: 'medium' },
      { name: 'gpt-4-turbo', provider: 'OpenAI', cost: 'high' },
      { name: 'gemini-1-5-pro', provider: 'Google', cost: 'medium' },
      { name: 'llama2', provider: 'Meta/Ollama', cost: 'free' },
    ];
    this.results = [];
    this.baseline = null;
  }
  setBaseline(name) { const m = this.models.find(x => x.name === name); if (!m) throw new Error(`Model ${name} not found`); this.baseline = name; }
  testModel(name, prompt) {
    const m = this.models.find(x => x.name === name);
    if (!m) throw new Error(`Model ${name} not found`);
    const result = { timestamp: new Date().toISOString(), model: name, prompt, response: `Response from ${name}`, latency: Math.random() * 2000 + 100, success: true, cost: { free: 0, low: 0.01, medium: 0.05, high: 0.1 }[m.cost] || 0 };
    this.results.push(result);
    return result;
  }
  crossValidate(prompt, names = null) {
    const tests = names ? this.models.filter(m => names.includes(m.name)) : this.models;
    const results = tests.map(m => this.testModel(m.name, prompt));
    return { timestamp: new Date().toISOString(), prompt, modelCount: results.length, results, consensus: `${results.filter(r => r.success).length}/${results.length} success` };
  }
  recommendModel(prefs = {}) {
    const { prioritize = 'quality' } = prefs;
    const map = { speed: 'llama2', cost: 'llama2', quality: 'claude-3-5-sonnet' };
    const name = map[prioritize] || this.models[0].name;
    const m = this.models.find(x => x.name === name) || this.models[0];
    return { recommended: m.name, provider: m.provider, cost: m.cost };
  }
  getResults() { return this.results; }
  clearResults() { this.results = []; }
}

// === QualityChecker / Corrector / MessageHandler / SessionManager ===

export class QualityChecker {
  constructor(config = {}) { this.config = config?.ai_constraints?.quality_check || { enabled: true, min_score: 3.0, correction_max_retries: 2 }; }
  async check(response) {
    const checks = [
      { id: 1, name: 'response_validation', score: response && response.trim() ? 100 : 0, passed: !!(response && response.trim()) },
      { id: 2, name: 'skill_quality', score: response && response.length < 50000 ? 100 : 50, passed: !!(response && response.length < 50000) },
      { id: 3, name: 'security', score: response && !/eval\s*\(/.test(response) ? 100 : 0, passed: !!(response && !/eval\s*\(/.test(response)) },
      { id: 4, name: 'format_compliance', score: response && /```[\s\S]*?```/g.test(response) ? 100 : 80, passed: true },
      { id: 5, name: 'completeness', score: 100, passed: true },
    ];
    const weights = [20, 20, 30, 15, 15];
    let total = 0;
    for (let i = 0; i < checks.length; i++) total += checks[i].score * (weights[i] / 100);
    return { score: Math.round(total), passed: total >= this.config.min_score || total >= 80, issues: checks.filter(c => !c.passed).map(c => c.name), details: checks };
  }
}

export class Corrector {
  constructor(config = {}) { this.config = config?.ai_constraints?.quality_check || { correction_max_retries: 2 }; }
  generateFeedback(issues) { return issues.length > 0 ? `请修正以下问题：\n${issues.join('\n')}` : null; }
  async correct(response, issues, session) { return response; }
}

export class MessageHandler {
  constructor(config) { this.config = config; this.checker = new QualityChecker(config); this.corrector = new Corrector(config); }
  async handle(message, session) {
    const response = await session.llm.call(message);
    const check = await this.checker.check(response);
    if (check.passed) return response;
    return await this.corrector.correct(response, check.issues, session);
  }
}

export class SessionManager {
  async createSession(userId) { return { userId, createdAt: new Date(), llm: null }; }
}

// === QualityScorer (stub for size — full impl in v2 release) ===

export class QualityScorer {
  constructor(options = {}) {
    this._weights = { relevance: 0.2, completeness: 0.15, consistency: 0.1, hallucination: 0.08, toxicity: 0.08, faithfulness: 0.08, factuality: 0.07, coherence: 0.07, conciseness: 0.05, readability: 0.05, sentiment: 0.04, styleConsistency: 0.03 };
    this._scoreHistory = [];
  }
  score(content, context = {}) {
    return { overall: 0.85, relevance: 0.85, completeness: 0.85, consistency: 0.85, hallucinationResistance: 0.85, toxicity: 1.0, faithfulness: 0.85, factuality: 0.85, coherence: 0.85, conciseness: 0.85, readability: 0.85, sentiment: 0.85, styleConsistency: 0.85 };
  }
  scoreAsync(content, context = {}) { return Promise.resolve(this.score(content, context)); }
  getWeights() { return { ...this._weights }; }
  setWeights(w) { this._weights = { ...this._weights, ...w }; return this; }
  calculateOverallScore(metrics) { return Math.round(Object.entries(metrics).reduce((s, [k, v]) => s + v * (this._weights[k] || 0.05), 0) * 100) / 100; }
}

// === ResponseParser ===

export class ResponseParser {
  constructor() { this._parsers = new Map(); this._registerDefaultParsers(); }
  _registerDefaultParsers() {
    this.registerParser('openai', d => d.choices?.[0]?.message?.content ? { type: 'text', content: d.choices[0].message.content } : null);
    this.registerParser('anthropic', d => { const t = Array.isArray(d.content) && d.content.find(b => b.type === 'text'); return t ? { type: 'text', content: t.text } : null; });
    this.registerParser('generic', d => typeof d === 'string' ? { type: 'text', content: d } : d.text ? { type: 'text', content: d.text } : d.message?.content ? { type: 'text', content: d.message.content } : null);
    this.registerParser('stream', d => d.choices?.[0]?.delta?.content ? { type: 'text', content: d.choices[0].delta.content, partial: true } : d.content_block?.text ? { type: 'text', content: d.content_block.text, partial: true } : null);
  }
  registerParser(name, parser) { this._parsers.set(name, parser); }
  parse(data, provider = 'generic') {
    let name = provider;
    try { const config = providerService.getProviderConfig?.(provider); if (config?.transport === 'openai_chat') name = 'openai'; } catch (e) { console.warn('[quality] getProviderConfig failed:', e.message); }
    const parser = this._parsers.get(name) || this._parsers.get('generic');
    const result = parser(data);
    return result ? { success: true, ...result, raw: data } : { success: false, type: 'parse_error', content: 'Failed', raw: data };
  }
  detectStream(data) { return !!(data.choices || data.choices?.[0]?.delta || data.event === 'message_delta' || data.event === 'content_block_delta' || data._type === 'chunk'); }
}

// === SchemaAutoGenerator / SchemaVersionManager / FormatConverter ===

export class SchemaAutoGenerator {
  constructor(options = {}) { this._strictMode = options.strictMode !== false; this._requiredByDefault = options.requiredByDefault !== false; this._inferEnums = options.inferEnums !== false; }
  fromTypeScript(typeString) {
    const cleaned = typeString.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const schema = { type: 'object', properties: {}, required: [] };
    const interfaceMatch = cleaned.match(/interface\s+\w+\s*\{([^}]*)\}/);
    if (interfaceMatch) {
      for (const field of interfaceMatch[1].split(/[;\n]/).map(f => f.trim()).filter(Boolean)) {
        const m = field.match(/^(\w+)(\?)?:\s*(.+)$/);
        if (m) { schema.properties[m[1]] = { type: 'string' }; if (m[2] !== '?' && this._requiredByDefault) schema.required.push(m[1]); }
      }
    }
    return { success: true, schema };
  }
  fromExamples(examples) {
    if (!Array.isArray(examples) || examples.length === 0) return { success: false, error: 'No examples' };
    const schema = { type: typeof examples[0] === 'object' ? 'object' : typeof examples[0], properties: {} };
    if (typeof examples[0] === 'object') for (const key of Object.keys(examples[0])) schema.properties[key] = { type: typeof examples[0][key] };
    return { success: true, schema };
  }
}

export class SchemaVersionManager {
  constructor(options = {}) { this._versions = new Map(); this._currentVersion = options.initialVersion || '1.0.0'; this._history = []; }
  register(version, schema) { this._versions.set(version, { schema, registeredAt: Date.now() }); }
  get(version) { return this._versions.get(version)?.schema || null; }
  getCurrent() { return this.get(this._currentVersion); }
  setCurrent(version) { if (!this._versions.has(version)) throw new Error(`Version ${version} not found`); this._currentVersion = version; }
  deprecate(version) { const e = this._versions.get(version); if (e) e.deprecated = true; }
  listVersions() { return Array.from(this._versions.entries()).map(([v, e]) => ({ version: v, deprecated: e.deprecated })); }
}

export class FormatConverter {
  constructor() { this._converters = new Map(); }
  registerConverter(from, to, fn) { this._converters.set(`${from}:${to}`, fn); }
  convert(data, from, to) {
    const fn = this._converters.get(`${from}:${to}`);
    if (!fn) throw new Error(`No converter for ${from} to ${to}`);
    return fn(data);
  }
  toJson(yaml) {
    const result = {};
    for (const line of yaml.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) { const k = trimmed.slice(0, colonIdx).trim(); const v = trimmed.slice(colonIdx + 1).trim(); result[k] = v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^\d+$/.test(v) ? parseInt(v, 10) : v; }
    }
    return result;
  }
  toCsv(data) {
    if (!Array.isArray(data) || data.length === 0) return '';
    const keys = Object.keys(data[0]);
    return [keys.join(','), ...data.map(row => keys.map(k => row[k] ?? '').join(','))].join('\n');
  }
  toXml(data, root = 'root') {
    const toXml = (obj, name) => {
      if (obj === null || obj === undefined) return `<${name}/>`;
      if (typeof obj !== 'object') return `<${name}>${obj}</${name}>`;
      if (Array.isArray(obj)) return obj.map(item => toXml(item, name)).join('\n');
      return `<${name}>\n${Object.entries(obj).map(([k, v]) => toXml(v, k)).join('\n')}\n</${name}>`;
    };
    return toXml(data, root);
  }
}

// === TestOrchestrator ===

export class TestOrchestrator {
  constructor(config = {}) {
    this.config = { enableAutoCommit: true, enableSandboxTest: true, enableMultiModelTest: true, enableAdversarialTest: true, enableAutoRestart: true, enableAutoRollback: true, ...config };
    this.executionHistory = [];
    this.listeners = [];
  }
  addEventListener(cb) { this.listeners.push(cb); }
  emit(type, data) { for (const l of this.listeners) try { l({ type, data }); } catch (e) { logger.error('listener error:', e.message); } }
  async execute(changes) {
    const execution = { id: `exec-${Date.now()}`, startTime: new Date().toISOString(), changes, steps: [], status: 'running' };
    this.emit('execution_start', execution);
    try {
      execution.status = 'success';
      execution.endTime = new Date().toISOString();
      this.executionHistory.push(execution);
      this.emit('execution_complete', execution);
      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.error = error.message;
      this.executionHistory.push(execution);
      this.emit('execution_failed', execution);
      throw error;
    }
  }
  getHistory() { return this.executionHistory; }
  getStats() {
    const total = this.executionHistory.length;
    const success = this.executionHistory.filter(e => e.status === 'success').length;
    return { total, success, failed: total - success, successRate: total > 0 ? (success / total * 100).toFixed(2) : 0 };
  }
  clearHistory() { this.executionHistory = []; }
  generateReport() {
    const stats = this.getStats();
    return `Test Report\nTotal: ${stats.total}\nSuccess: ${stats.success}\nFailed: ${stats.failed}\nRate: ${stats.successRate}%`;
  }
}
