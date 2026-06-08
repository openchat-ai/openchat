// scoring.mjs — 评分函数 (跟 E34 同款, 复制以保持实验独立)
//
// provider-kit 实际返回的 toolCall 形状: { id, name, arguments: "<json string>" }
// 不是 OpenAI 标准的 { id, type, function: { name, arguments } }

function parseCall(call) {
  if (!call) return { name: null, args: {} };
  let name = call.name || call.function?.name;
  let rawArgs = call.arguments ?? call.function?.arguments;
  let args = {};
  if (typeof rawArgs === 'string') {
    try { args = JSON.parse(rawArgs); } catch { args = { _parseError: true, raw: rawArgs }; }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs;
  }
  return { name, args };
}

export function scoreCall(call, expect) {
  const { name, args } = parseCall(call);
  if (!name) {
    return {
      toolPick: 0,
      paramName: 0,
      paramValue: 0,
      extraFields: 99,
      validCall: 0,
      noToolCall: 1,
    };
  }
  const expectArgs = expect.args || {};

  const toolPick = name === expect.name ? 1 : 0;
  const expectKeys = Object.keys(expectArgs);
  const paramName = expectKeys.length === 0
    ? 1
    : expectKeys.every((k) => k in args) ? 1 : 0;
  const paramValue = expectKeys.length === 0
    ? 1
    : expectKeys.every((k) => args[k] === expectArgs[k]) ? 1 : 0;
  const extraFields = Object.keys(args).filter((k) => !(k in expectArgs)).length;
  const validCall = toolPick && paramName && extraFields === 0 ? 1 : 0;
  const noToolCall = 0;

  return { toolPick, paramName, paramValue, extraFields, validCall, noToolCall };
}

export function aggregateScores(scores) {
  if (scores.length === 0) return null;
  const acc = {
    toolPick: 0,
    paramName: 0,
    paramValue: 0,
    extraFields: 0,
    validCall: 0,
    noToolCall: 0,
  };
  for (const s of scores) {
    acc.toolPick += s.toolPick;
    acc.paramName += s.paramName;
    acc.paramValue += s.paramValue;
    acc.extraFields += s.extraFields;
    acc.validCall += s.validCall;
    acc.noToolCall += s.noToolCall;
  }
  const n = scores.length;
  return {
    n,
    toolPick: acc.toolPick / n,
    paramName: acc.paramName / n,
    paramValue: acc.paramValue / n,
    extraFields: acc.extraFields / n,
    validCall: acc.validCall / n,
    noToolCall: acc.noToolCall / n,
  };
}

export function extractFirstCall(chatResponse) {
  if (!chatResponse) return null;
  if (chatResponse.toolCalls && chatResponse.toolCalls[0]) {
    return chatResponse.toolCalls[0];
  }
  return null;
}
