import * as fs from 'fs';
import * as os from 'os';
import { generalizationEngineV2 } from './generalization.js';
import { vectorMemory } from '../memory/vector-memory.js';
import { GossipManager } from '../../p2p/gossip-manager.js';
import logger from '../logger.js';

class Forge {
  constructor() {
    this._gossip = null;
    this._llmHandler = null;
    this._llmFailures = 0;
    this._llmCircuitOpen = false;
    this._validators = [
      (t) => t && t.length > 5 ? null : 'too_short',
      (t) => t.length < 50000 ? null : 'too_long',
      (t) => !t.includes('无法回答') ? null : 'refusal',
      (t) => !t.includes('我不知道') ? null : 'refusal',
    ];
  }

  addValidator(fn) { this._validators.push(fn); }

  setLLMHandler(fn) {
    this._llmHandler = fn;
    this._llmFailures = 0;
    this._llmCircuitOpen = false;
  }

  async solve(question) {
    const traceId = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    let answer = null;
    let source = '';

    const recall = await vectorMemory.embedSearch(question, { limit: 1, minScore: 0.3 });
    const hit = recall?.[0];
    if (hit && hit.score > 0.6) {
      const p = hit.text.match(/A:\s*(.+)/s);
      if (p) return { answer: p[1].substring(0, 500), source: 'memory' };
    }

    try {
      const r = await generalizationEngineV2.solve({ question });
      if (r?.content) { answer = r.content; source = 'solver'; }
    } catch (e) { this._log(traceId, 'solver_error', e.message); }

    if (!answer && this._llmHandler && !this._llmCircuitOpen) {
      try {
        const llm = await Promise.race([
          this._llmHandler(question),
          new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 30000)),
        ]);
        if (llm) { answer = llm; source = 'llm'; this._llmFailures = 0; }
      } catch (e) {
        this._llmFailures++;
        if (this._llmFailures >= 3) this._llmCircuitOpen = true;
        this._log(traceId, 'llm_error', e.message);
      }
    }

    if (answer && this._verify(answer)) {
      this._store(question, answer, source);
    } else {
      this._deadLetter(question, answer);
    }
    return { answer, source };
  }

  search(q, o) { return vectorMemory.search(q, o); }
  embedSearch(q, o) { return vectorMemory.embedSearch(q, o); }

  learn(question, answer) {
    if (this._verify(answer)) this._store(question, answer, 'manual');
    return this;
  }

  sync(p2p, externalGossip) {
    if (externalGossip) {
      this._gossip = externalGossip;
    } else if (!this._gossip) {
      this._gossip = new GossipManager();
    }
    if (p2p) this._gossip.start(p2p);
    return this;
  }

  stopSync() {
    if (this._gossip) { this._gossip.stop(); this._gossip = null; }
  }

  _verify(t) {
    for (const v of this._validators) { const r = v(t); if (r) return false; }
    return true;
  }

  _store(q, a, s) {
    try {
      vectorMemory.store({ residentId: 'forge', text: `Q: ${q.substring(0,200)}\nA: ${a.substring(0,500)}`, metadata: { source: s }, source: 'forge' });
    } catch (e) { logger.error('[Forge] store failed:', e.message); }
  }

  _log(traceId, event, detail) {
    try { fs.appendFileSync(os.tmpdir() + '/forge-trace.log', `${Date.now()}|${traceId}|${event}|${(detail||'').substring(0,100)}\n`); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  _deadLetter(q, a) {
    try { fs.appendFileSync(os.tmpdir() + '/forge-deadletter.log', `${Date.now()}|deadletter|${(q||'').substring(0,80)}|${(a||'').substring(0,80)}\n`); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }
}

const forge = new Forge();
export { Forge, forge };
