// extractor.mjs — 从 LLM 输出抽取字节数组
//
// LLM 可能输出:
//   - JS: Buffer.from([0x10, 0x12, 0x00, 0x04, ...])
//   - JS: [16, 18, 0, 4, 77, 81, 84, 84, ...]  (十进制)
//   - 纯描述: 第一个字节是 0x10, 第二个是 0x12...
//   - 混合: 文字解释 + 代码块
//
// 策略: 优先找 Buffer.from([...]) 模式, 再退到找 [...] 数字数组, 再退到扫所有 0xNN/十进制数字

export function extractBytes(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. 优先找 Buffer.from([...]) 模式
  const bufMatch = text.match(/Buffer\.from\(\s*\[\s*([^\]]+)\s*\]\s*(?:,\s*['"][^'"]+['"])?\s*\)/);
  if (bufMatch) {
    const bytes = parseByteList(bufMatch[1]);
    if (bytes && bytes.length > 0) return bytes;
  }

  // 2. 找 [...] 数字数组 (>= 2 字节)
  const arrMatches = text.matchAll(/\[\s*((?:0x[0-9a-fA-F]+|\d+)\s*,\s*)+((?:0x[0-9a-fA-F]+|\d+)\s*)\]/g);
  for (const m of arrMatches) {
    const inner = m[0].slice(1, -1);  // 去掉 [...]
    const bytes = parseByteList(inner);
    if (bytes && bytes.length >= 2) return bytes;
  }

  // 3. 兜底: 找连续 0xNN 序列 (>= 2 字节)
  const hexSeq = text.match(/(?:0x[0-9a-fA-F]{2}\s*,\s*){1,}(?:0x[0-9a-fA-F]{2})/);
  if (hexSeq) {
    const bytes = parseByteList(hexSeq[0]);
    if (bytes && bytes.length >= 2) return bytes;
  }

  return null;
}

function parseByteList(s) {
  if (!s) return null;
  const tokens = s.split(/[\s,]+/).filter(Boolean);
  const bytes = [];
  for (const t of tokens) {
    if (t.startsWith('0x') || t.startsWith('0X')) {
      const n = parseInt(t.slice(2), 16);
      if (Number.isNaN(n) || n < 0 || n > 255) return null;
      bytes.push(n);
    } else if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (n < 0 || n > 255) return null;
      bytes.push(n);
    } else {
      return null;  // 包含非数字 token
    }
  }
  return bytes;
}

// === 评分 ===

export function scoreBytes(actual, expected) {
  if (!actual || actual.length === 0) {
    return {
      extracted: false,
      exactMatch: 0,
      lengthMatch: 0,
      firstByteMatch: 0,
      byteAccuracy: 0,
      actualLength: 0,
      expectedLength: expected.length,
    };
  }

  // 第一个字节: 0x10 = CONNECT, 0x30 = PUBLISH, 0x82 = SUBSCRIBE, 0xC0 = PINGREQ
  const firstByteMatch = actual[0] === expected[0] ? 1 : 0;

  // 长度匹配
  const lengthMatch = actual.length === expected.length ? 1 : 0;

  // 字节准确率: 逐字节比较 (取最短)
  const minLen = Math.min(actual.length, expected.length);
  let correct = 0;
  for (let i = 0; i < minLen; i++) {
    if (actual[i] === expected[i]) correct++;
  }
  const byteAccuracy = expected.length > 0 ? correct / expected.length : 0;

  // 整体匹配
  const exactMatch = lengthMatch && byteAccuracy === 1 ? 1 : 0;

  return {
    extracted: true,
    exactMatch,
    lengthMatch,
    firstByteMatch,
    byteAccuracy,
    actualLength: actual.length,
    expectedLength: expected.length,
  };
}

export function aggregateScores(scores) {
  if (scores.length === 0) return null;
  const acc = {
    exactMatch: 0,
    lengthMatch: 0,
    firstByteMatch: 0,
    byteAccuracy: 0,
    extracted: 0,
  };
  for (const s of scores) {
    acc.exactMatch += s.exactMatch;
    acc.lengthMatch += s.lengthMatch;
    acc.firstByteMatch += s.firstByteMatch;
    acc.byteAccuracy += s.byteAccuracy;
    acc.extracted += s.extracted ? 1 : 0;
  }
  const n = scores.length;
  return {
    n,
    exactMatch: acc.exactMatch / n,
    lengthMatch: acc.lengthMatch / n,
    firstByteMatch: acc.firstByteMatch / n,
    byteAccuracy: acc.byteAccuracy / n,
    extracted: acc.extracted / n,
  };
}
