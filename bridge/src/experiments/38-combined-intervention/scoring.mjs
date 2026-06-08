// scoring.mjs — E38 评分函数
//
// 跟 E37 scoreBytes 完全一致 (字节级评分)
// 跟 E35 parseCall 兼容 (处理 {name, arguments} 扁平化)

function parseCall(call) {
  if (!call) return { name: null, args: null };
  let name = call.name || call.function?.name;
  let rawArgs = call.arguments ?? call.function?.arguments;
  let args = null;
  if (typeof rawArgs === 'string') {
    try { args = JSON.parse(rawArgs); } catch { args = null; }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs;
  }
  return { name, args };
}

// 从 LLM 响应里抽第一个 tool call
// provider-kit 响应形状: { content, toolCalls: [{id, name, arguments}], ... }
export function extractFirstCall(resp) {
  if (!resp) return null;
  const calls = resp.toolCalls || resp.choices?.[0]?.message?.tool_calls || [];
  if (calls.length === 0) return null;
  return calls[0];
}

export function scoreCall(call, expected) {
  // expected = { tool, json, bytes }
  const { name, args } = parseCall(call);

  // 1. tool 选对?
  const toolPick = name === expected.tool ? 1 : 0;

  // 2. json 抽到了?
  const jsonPresent = args && typeof args === 'object' && args.json ? 1 : 0;
  const innerJson = jsonPresent ? args.json : null;

  // 3. 字段匹配 (跟 E37 expectedJson 比)
  let paramName = 0;
  let paramValue = 0;
  if (innerJson) {
    const expKeys = Object.keys(expected.json);
    paramName = expKeys.every((k) => k in innerJson) ? 1 : 0;
    paramValue = expKeys.every((k) => JSON.stringify(innerJson[k]) === JSON.stringify(expected.json[k])) ? 1 : 0;
  }

  // 4. 字节级 (复用 E37 scoreBytes, 但传 raw bytes from tool result or re-render)
  // 我们这里没有 tool result, 假设 LLM 调完后由我们 re-render
  // 但 scoreCall 是纯函数, 不调 renderer, 留给 caller
  // 这里只输出"能不能 re-render" 的 flag
  return {
    toolPick,
    jsonPresent,
    paramName,
    paramValue,
    noToolCall: name ? 0 : 1,
    name,            // 调试用
    json: innerJson, // 调试用
  };
}

export function scoreBytes(actual, expected) {
  if (!actual || actual.length === 0) {
    return {
      extracted: false, exactMatch: 0, lengthMatch: 0,
      firstByteMatch: 0, byteAccuracy: 0,
      actualLength: 0, expectedLength: expected.length,
    };
  }
  const firstByteMatch = actual[0] === expected[0] ? 1 : 0;
  const lengthMatch = actual.length === expected.length ? 1 : 0;
  const minLen = Math.min(actual.length, expected.length);
  let correct = 0;
  for (let i = 0; i < minLen; i++) {
    if (actual[i] === expected[i]) correct++;
  }
  const byteAccuracy = expected.length > 0 ? correct / expected.length : 0;
  const exactMatch = lengthMatch && byteAccuracy === 1 ? 1 : 0;
  return { extracted: true, exactMatch, lengthMatch, firstByteMatch, byteAccuracy,
           actualLength: actual.length, expectedLength: expected.length };
}

export function aggregateScores(scores) {
  if (scores.length === 0) return null;
  const acc = {
    exactMatch: 0, lengthMatch: 0, firstByteMatch: 0,
    byteAccuracy: 0, extracted: 0,
    toolPick: 0, jsonPresent: 0, paramName: 0, paramValue: 0, noToolCall: 0,
  };
  for (const s of scores) {
    acc.exactMatch += s.exactMatch || 0;
    acc.lengthMatch += s.lengthMatch || 0;
    acc.firstByteMatch += s.firstByteMatch || 0;
    acc.byteAccuracy += s.byteAccuracy || 0;
    acc.extracted += s.extracted ? 1 : 0;
    acc.toolPick += s.toolPick || 0;
    acc.jsonPresent += s.jsonPresent || 0;
    acc.paramName += s.paramName || 0;
    acc.paramValue += s.paramValue || 0;
    acc.noToolCall += s.noToolCall || 0;
  }
  const n = scores.length;
  return {
    n,
    exactMatch: acc.exactMatch / n,
    lengthMatch: acc.lengthMatch / n,
    firstByteMatch: acc.firstByteMatch / n,
    byteAccuracy: acc.byteAccuracy / n,
    extracted: acc.extracted / n,
    toolPick: acc.toolPick / n,
    jsonPresent: acc.jsonPresent / n,
    paramName: acc.paramName / n,
    paramValue: acc.paramValue / n,
    noToolCall: acc.noToolCall / n,
  };
}
