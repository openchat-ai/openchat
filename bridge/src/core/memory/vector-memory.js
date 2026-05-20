/**
 * Vector memory - cross-resident semantic search
 *
 * Primary: TF-IDF + cosine similarity (fast, local, always works)
 * Enhanced: Real embeddings via SiliconFlow API (semantic, needs API key)
 *
 * TF-IDF fast path as primary, embedding-enhanced search as secondary
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../logger.js';

const DATA_DIR = path.join(os.homedir(), '.openchat', 'vector-memory');
const DATA_FILE = path.join(DATA_DIR, 'vectors.json');
const EMBED_API = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';
const EMBED_MODEL = 'BAAI/bge-m3'; // Good Chinese+English embedding model
const EMBED_DIM = 1024; // bge-m3 output dimension

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','shall','can','need','dare','ought',
  'used','to','of','in','for','on','with','at','by','from',
  'as','into','through','during','before','after','above','below',
  'between','out','off','over','under','again','further','then',
  'once','here','there','when','where','why','how','all','each',
  'every','both','few','more','most','other','some','such','no',
  'nor','not','only','own','same','so','than','too','very',
  'and','but','or','if','while','that','this','these','those',
  'i','me','my','myself','we','our','ours','ourselves',
  'you','your','yours','yourself','yourselves',
  'he','him','his','himself','she','her','hers','herself',
  'it','its','itself','they','them','their','theirs','themselves',
  'what','which','who','whom','this','that','these','those',
  'am','is','are','was','were','be','been','being',
  '的','了','在','是','我','有','和','就','不','人','都','一',
  '个','上','也','很','到','说','要','去','你','会','着',
  '没有','自己','这','那','什么','吗','啊','被','把','从',
]);

// ---- TF-IDF utilities (fast path / fallback) ----

function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ');
  const tokens = [];
  let buf = '';
  for (const ch of cleaned) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else if (/[a-z0-9]/.test(ch)) {
      buf += ch;
    } else {
      if (buf) { tokens.push(buf); buf = ''; }
    }
  }
  if (buf) tokens.push(buf);
  const result = [];
  const chChars = tokens.filter(t => /[\u4e00-\u9fff]/.test(t) && t.length === 1);
  for (let i = 0; i < chChars.length; i++) {
    result.push(chChars[i]);
    if (i + 1 < chChars.length) result.push(chChars[i] + chChars[i + 1]);
  }
  for (const t of tokens) {
    if (/^[a-z0-9]+$/.test(t) && t.length > 1 && !STOP_WORDS.has(t)) result.push(t);
  }
  return result;
}

function computeTF(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const len = tokens.length || 1;
  for (const k in tf) tf[k] /= len;
  return tf;
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of allKeys) {
    const va = a[k] || 0;
    const vb = b[k] || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Cosine similarity for float arrays (embedding vectors) */
function vectorCosineSim(a, b) {
  let dot = 0, n1 = 0, n2 = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    n1 += a[i] * a[i];
    n2 += b[i] * b[i];
  }
  const d = Math.sqrt(n1) * Math.sqrt(n2);
  return d === 0 ? 0 : dot / d;
}

// ---- Embedding API ----

let _embedApiKey = process.env.SILICONFLOW_API_KEY || '';
let _embedCache = new Map();
let _embedInflight = new Map();
const EMBED_CACHE_MAX = 1000;

async function _callEmbedAPI(texts, retries = 2) {
  if (!_embedApiKey) return null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${EMBED_API}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_embedApiKey}` },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts, encoding_format: 'float' }),
      });
      if (!res.ok) {
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      const data = await res.json();
      if (data.data?.length > 0) return data.data.map(d => d.embedding);
    } catch (e) {
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function getEmbedding(text) {
  if (!_embedApiKey) return null;
  const key = text.substring(0, 200);
  if (_embedCache.has(key)) return _embedCache.get(key);

  if (_embedInflight.has(key)) return _embedInflight.get(key);

  const promise = _callEmbedAPI([text]).then(vecs => {
    const vec = vecs?.[0] || null;
    if (vec) {
      _embedCache.set(key, vec);
      if (_embedCache.size > EMBED_CACHE_MAX) {
        const first = _embedCache.keys().next().value;
        if (first) _embedCache.delete(first);
      }
    }
    _embedInflight.delete(key);
    return vec;
  }).catch(() => {
    _embedInflight.delete(key);
    return null;
  });

  _embedInflight.set(key, promise);
  return promise;
}

// ==============================

class VectorMemory {
  constructor() {
    this._entries = [];
    this._idf = {};
    this._dirty = false;
    this._load();
  }

  // ---- persistence ----

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const data = JSON.parse(raw);
        this._entries = data.entries || [];
        this._idf = data.idf || {};
      }
    } catch (e) {
      logger.warn('[VectorMemory] load failed:', e.message);
    }
  }

  _save() {
    try {
      this._ensureDir();
      // Don't persist raw embedding arrays (too large, recompute on restart)
      const stripped = this._entries.map(e => ({ ...e, _embed: undefined }));
      fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: stripped, idf: this._idf }, null, 2));
      this._dirty = false;
    } catch (e) {
      logger.error('[VectorMemory] save failed:', e.message);
    }
  }

  save() { if (this._dirty) this._save(); }

  // ---- core operations ----

  /** * Store a memory entry. * ? */
  store({ residentId, text, metadata = {}, source = 'conversation' }) {
    if (!text || typeof text !== 'string' || text.length > 50000) return null;
    const tokens = tokenize(text);
    const tf = computeTF(tokens);
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    for (const t of tokens) this._idf[t] = (this._idf[t] || 0) + 1;

    const entry = {
      id, residentId, text,
      tokens: Object.keys(tf),
      vector: tf,
      metadata, source,
      timestamp: Date.now(),
      _embed: null, // placeholder for real embedding
    };

    this._entries.push(entry);
    this._dirty = true;

    // Async: compute embedding in background
    getEmbedding(text).then(vec => {
      if (vec) { entry._embed = vec; }
    }).catch(() => {});

    return id;
  }

  /** * Semantic search via TF-IDF (fast, always works). * TF-IDF （） */
  search(query, { limit = 5, minScore = 0.05 } = {}) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const queryVector = computeTF(queryTokens);
    const totalDocs = this._entries.length || 1;

    const scored = [];
    for (const entry of this._entries) {
      const weightedQuery = {};
      for (const k in queryVector) {
        const idf = Math.log(1 + totalDocs / (1 + (this._idf[k] || 0)));
        weightedQuery[k] = queryVector[k] * idf;
      }
      const weightedEntry = {};
      for (const k in entry.vector) {
        const idf = Math.log(1 + totalDocs / (1 + (this._idf[k] || 0)));
        weightedEntry[k] = entry.vector[k] * idf;
      }
      const score = cosineSimilarity(weightedQuery, weightedEntry);
      if (score >= minScore) scored.push({ ...entry, score, _embed: undefined });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** * Semantic search via real embeddings (accurate, needs API key). * Returns null if embedding fails ?caller should fall back to search(). * Embedding （， API key? */
  async embedSearch(query, { limit = 5, minScore = 0.3 } = {}) {
    const qVec = await getEmbedding(query).catch(() => null);
    const scored = [];

    if (qVec) {
      for (const entry of this._entries) {
        if (!entry._embed) continue;
        const score = vectorCosineSim(qVec, entry._embed);
        if (score >= minScore) scored.push({ ...entry, score, _embed: undefined });
      }
    }

    // Always augment with TF-IDF (fills gaps when embedding unavailable or sparse)
    const tfidf = this.search(query, { limit, minScore: 0.01 });
    for (const t of tfidf) {
      if (!scored.find(s => s.id === t.id)) {
        const embedScore = scored.find(s => s.id === t.id)?.score || 0;
        scored.push({ ...t, score: Math.max(t.score, embedScore), _embed: undefined });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** * Auto search: embedding + TF-IDF merged, best recall. * ：embedding + TF-IDF ，? */
  async autoSearch(query, opts = {}) {
    const embedResults = await this.embedSearch(query, opts).catch(() => null);
    const tfidfResults = this.search(query, opts);

    if (!embedResults || embedResults.length === 0) return tfidfResults;

    // Merge: keep unique by ID, prefer embedding score
    const seen = new Set();
    const merged = [];
    for (const r of [...embedResults, ...tfidfResults]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, opts.limit || 5);
  }

  /** * Batch compute missing embeddings for all entries. * ?embedding */
  async reembedAll() {
    const todo = this._entries.filter(e => !e._embed);
    if (todo.length === 0) return;
    logger.info(`[VectorMemory] Computing ${todo.length} embeddings...`);

    // Batch in groups of 10
    for (let i = 0; i < todo.length; i += 10) {
      const batch = todo.slice(i, i + 10);
      const texts = batch.map(e => e.text);
      const vecs = await _callEmbedAPI(texts);
      if (vecs) {
        for (let j = 0; j < batch.length; j++) {
          if (vecs[j]) batch[j]._embed = vecs[j];
        }
      }
      await new Promise(r => setTimeout(r, 200)); // rate limit
    }
    logger.info(`[VectorMemory] Embedding done for ${todo.length} entries`);
  }

  searchByResident(residentId, query, opts = {}) {
    const results = this.search(query, opts);
    return results.filter(r => r.residentId === residentId);
  }

  getResidentEntries(residentId) {
    return this._entries.filter(e => e.residentId === residentId);
  }

  /**
   * Find entries by metadata field value (public, replaces _entries direct access)
   */
  findByMetadata(key, value) {
    return this._entries.filter(e => e.metadata?.[key] === value);
  }

  getStats() {
    const residents = new Set(this._entries.map(e => e.residentId));
    const embedded = this._entries.filter(e => e._embed).length;
    return {
      totalEntries: this._entries.length,
      totalResidents: residents.size,
      uniqueTokens: Object.keys(this._idf).length,
      embedded,
    };
  }
}

const vectorMemory = new VectorMemory();

// Auto-save every 30s
setInterval(() => vectorMemory.save(), 30_000).unref();

export { VectorMemory, vectorMemory };
