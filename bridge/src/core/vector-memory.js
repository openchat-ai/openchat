/**
 * Vector Memory — Semantic search across resident knowledge
 * 向量记忆：跨居民的语义检索，不用关键词硬匹配
 *
 * Uses TF-IDF + cosine similarity for lightweight semantic search.
 * Future: swap in real embeddings (OpenAI/text-embedding-3-small) via provider-kit.
 *
 * TF-IDF + 余弦相似度实现轻量语义检索。
 * 未来可替换为真实 embedding 模型（通过 provider-kit 调用）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DATA_DIR = path.join(os.homedir(), '.openchat', 'vector-memory');
const DATA_FILE = path.join(DATA_DIR, 'vectors.json');
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'and', 'but', 'or', 'if', 'while', 'that', 'this', 'these', 'those',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们',
]);

function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ');
  const tokens = [];

  // Split into Latin/ASCII words and Chinese character n-grams
  let buf = '';
  for (const ch of cleaned) {
    if (/[\u4e00-\u9fff]/.test(ch)) {
      // Chinese character: flush latin buffer, add char
      if (buf) { tokens.push(buf); buf = ''; }
      tokens.push(ch);
    } else if (/[a-z0-9]/.test(ch)) {
      buf += ch;
    } else {
      // whitespace: flush latin buffer
      if (buf) { tokens.push(buf); buf = ''; }
    }
  }
  if (buf) tokens.push(buf);

  // Build character bigrams for Chinese text
  const result = [];
  const chChars = tokens.filter(t => /[\u4e00-\u9fff]/.test(t) && t.length === 1);
  for (let i = 0; i < chChars.length; i++) {
    result.push(chChars[i]); // unigram
    if (i + 1 < chChars.length) {
      result.push(chChars[i] + chChars[i + 1]); // bigram
    }
  }

  // Latin words
  for (const t of tokens) {
    if (/^[a-z0-9]+$/.test(t) && t.length > 1 && !STOP_WORDS.has(t)) {
      result.push(t);
    }
  }

  return result;
}

function computeTF(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  const len = tokens.length || 1;
  for (const k in tf) {
    tf[k] /= len;
  }
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
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
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
      console.warn('[VectorMemory] load failed, starting fresh:', e.message);
    }
  }

  _save() {
    try {
      this._ensureDir();
      fs.writeFileSync(DATA_FILE, JSON.stringify({ entries: this._entries, idf: this._idf }, null, 2));
      this._dirty = false;
    } catch (e) {
      console.error('[VectorMemory] save failed:', e.message);
    }
  }

  save() {
    if (this._dirty) this._save();
  }

  // ---- core operations ----

  /**
   * Store a memory entry with vectorized text.
   * 存储一条记忆并生成向量
   */
  store({ residentId, text, metadata = {}, source = 'conversation' }) {
    const tokens = tokenize(text);
    const tf = computeTF(tokens);
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    // Update IDF with new tokens
    for (const t of tokens) {
      this._idf[t] = (this._idf[t] || 0) + 1;
    }

    const entry = {
      id,
      residentId,
      text,
      tokens: Object.keys(tf),
      vector: tf,
      metadata,
      source,
      timestamp: Date.now(),
    };

    this._entries.push(entry);
    this._dirty = true;
    return id;
  }

  /**
   * Semantic search across ALL residents' memories.
   * 跨所有居民的语义搜索
   */
  search(query, { limit = 5, minScore = 0.05 } = {}) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const queryVector = computeTF(queryTokens);

    // Apply IDF weighting to all vectors
    const totalDocs = this._entries.length || 1;
    const weightedQuery = {};
    for (const k in queryVector) {
      const idf = Math.log(1 + totalDocs / (1 + (this._idf[k] || 0)));
      weightedQuery[k] = queryVector[k] * idf;
    }

    const scored = [];
    for (const entry of this._entries) {
      const weightedEntry = {};
      for (const k in entry.vector) {
        const idf = Math.log(1 + totalDocs / (1 + (this._idf[k] || 0)));
        weightedEntry[k] = entry.vector[k] * idf;
      }

      const score = cosineSimilarity(weightedQuery, weightedEntry);
      if (score >= minScore) {
        scored.push({ ...entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Search within a specific resident's memories.
   * 在指定居民的记忆中搜索
   */
  searchByResident(residentId, query, opts = {}) {
    const results = this.search(query, opts);
    return results.filter(r => r.residentId === residentId);
  }

  /**
   * Get all entries for a resident.
   * 获取某个居民的所有记忆
   */
  getResidentEntries(residentId) {
    return this._entries.filter(e => e.residentId === residentId);
  }

  /**
   * Get memory stats.
   * 统计信息
   */
  getStats() {
    const residents = new Set(this._entries.map(e => e.residentId));
    return {
      totalEntries: this._entries.length,
      totalResidents: residents.size,
      uniqueTokens: Object.keys(this._idf).length,
    };
  }
}

const vectorMemory = new VectorMemory();

// Auto-save every 30 seconds if dirty
setInterval(() => vectorMemory.save(), 30_000).unref();

export { VectorMemory, vectorMemory };
