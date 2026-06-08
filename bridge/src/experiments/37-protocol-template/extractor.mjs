// extractor.mjs — 从 LLM 输出抽取 JSON
//
// 策略: 优先找 ```json ... ``` 块, 再找 {...} 块, 再宽松找 { ... } 范围

export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. ```json ... ``` 代码块
  const codeMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeMatch) {
    const obj = tryParse(codeMatch[1]);
    if (obj) return obj;
  }

  // 2. 找最外层 { ... } (balanced braces, 简化版)
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.substring(firstBrace, i + 1);
        const obj = tryParse(candidate);
        if (obj) return obj;
      }
    }
  }
  return null;
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    // 尝试把单引号换成双引号 (LLM 经常写 'string' 而不是 "string")
    const fixed = s
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')  // { key: 'val' } → { "key": "val" }
      .replace(/,(\s*[}\]])/g, '$1');  // 去 trailing comma
    try {
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}
