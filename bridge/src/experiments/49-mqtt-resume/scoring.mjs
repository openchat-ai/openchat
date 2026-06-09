// 49-mqtt-resume/scoring.mjs
//
// 11-dim scoring for `connectWithResume` LLM output.
// 8 static (regex on source) + 3 dynamic (sandbox results).
//
// Why 11 not 9 (per plan): each render tool needs both "called" and "args ok"
// (4 dims), plus 4 more static + 3 dynamic = 11 total.
//
// Usage:
//   const dims = scoreOne({ llmOutput, source, sandboxA, sandboxB });
//   const agg = aggregate([dims1, dims2, ...]);

// === Source extraction ===
// Extract ```js ... ``` block from LLM's chat output. Robust to ```js / ```javascript / ```.
export function extractSource(llmOutput) {
  if (!llmOutput || typeof llmOutput !== 'string') return null;
  const m = llmOutput.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  return null;
}

// === Static checks (regex on source) ===

export function checkSourceExtracted(llmOutput) {
  return extractSource(llmOutput) ? 1 : 0;
}

export function checkFunctionShape(source) {
  if (!source) return 0;
  return /async\s+function\s+connectWithResume\s*\(/.test(source) ? 1 : 0;
}

export function checkUsesTool(source, toolName) {
  if (!source) return 0;
  const re = new RegExp(`\\b${toolName}\\s*\\(`);
  return re.test(source) ? 1 : 0;
}

// Lenient args check: looks for the expected properties in the call body.
// Doesn't try to evaluate the object — checks string-level for required fields.
export function checkRenderConnectArgs(source) {
  if (!source) return 0;
  const m = source.match(/renderConnect\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!m) return 0;
  const body = m[1];
  // protoName: 'MQTT' (or "MQTT")
  if (!/protoName\s*:\s*['"]MQTT['"]/.test(body)) return 0;
  // protoLevel: 4
  if (!/protoLevel\s*:\s*4\b/.test(body)) return 0;
  // connectFlags: must be present (could be 0x02, 2, or { cleanSession: true })
  if (!/connectFlags\s*:/i.test(body)) return 0;
  // keepAlive: must be present
  if (!/keepAlive\s*:/i.test(body)) return 0;
  // clientId: variable reference (must appear, even as bare identifier)
  if (!/\bclientId\b/.test(body)) return 0;
  return 1;
}

export function checkRenderSubscribeArgs(source) {
  if (!source) return 0;
  const m = source.match(/renderSubscribe\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!m) return 0;
  const body = m[1];
  // packetId: must be present (could be 1, or variable)
  if (!/packetId\s*:/i.test(body)) return 0;
  // subscriptions: must be present and an array literal
  if (!/subscriptions\s*:\s*\[/.test(body)) return 0;
  // inside subscriptions array: at least one { topic, qos } (or equivalent)
  // Look for 'topic' (string) and 'qos' (number) inside the call
  if (!/\btopic\b/.test(body)) return 0;
  if (!/\bqos\b/.test(body)) return 0;
  return 1;
}

export function checkAttemptsRetry(source) {
  if (!source) return 0;
  // Body should have a loop or retry-like identifier
  // for(...)  while(...)  attempts  retries  maxAttempts
  if (/\b(for|while)\s*\(/.test(source)) return 1;
  if (/\b(attempts?|retries|maxAttempts|retryCount|tryCount)\b/i.test(source)) return 1;
  return 0;
}

export function checkReadsSessionStore(source) {
  if (!source) return 0;
  return /sessionStore\s*\.\s*getSubscriptions/.test(source) ? 1 : 0;
}

// === Dynamic checks (sandbox results) ===

// subTestA: refuseConnackCount=0, expect 1×CONNECT + N×SUBSCRIBE in order
export function checkSandboxRan(sandboxA) {
  if (!sandboxA) return 0;
  if (sandboxA.error) return 0;
  if (!sandboxA.returnValue) return 0;
  return 1;
}

export function checkPacketsCorrect(sandboxA, expectedSubscribeCount = 2) {
  if (!sandboxA || !sandboxA.packets || sandboxA.packets.length === 0) return 0;
  // First packet must be CONNECT (type=1)
  if (sandboxA.packets[0].type !== 1) return 0;
  // Remaining packets must all be SUBSCRIBE (type=8), and count must be >= 1
  const subs = sandboxA.packets.slice(1);
  if (subs.length === 0) return 0;
  if (!subs.every((p) => p.type === 8)) return 0;
  return 1;
}

// subTestB: refuseConnackCount=2, function should still resolve and emit packets
// on the successful 3rd attempt
export function checkRetriesSurvivedFailure(sandboxB) {
  if (!sandboxB) return 0;
  if (sandboxB.error) return 0;
  if (!sandboxB.returnValue) return 0;
  // Must have produced at least 1×CONNECT (the successful attempt)
  if (!sandboxB.packets || sandboxB.packets.length === 0) return 0;
  if (sandboxB.packets[0].type !== 1) return 0;
  return 1;
}

// === Score a single LLM output ===

export function scoreOne({ llmOutput, sandboxA, sandboxB }) {
  const source = extractSource(llmOutput);
  return {
    sourceExtracted: checkSourceExtracted(llmOutput),
    functionShapeOk: checkFunctionShape(source),
    usesRenderConnect: checkUsesTool(source, 'renderConnect'),
    renderConnectArgsOk: checkRenderConnectArgs(source),
    usesRenderSubscribe: checkUsesTool(source, 'renderSubscribe'),
    renderSubscribeArgsOk: checkRenderSubscribeArgs(source),
    attemptsRetry: checkAttemptsRetry(source),
    readsSessionStore: checkReadsSessionStore(source),
    sandboxRan: checkSandboxRan(sandboxA),
    packetsCorrect: checkPacketsCorrect(sandboxA),
    retriesSurvivedFailure: checkRetriesSurvivedFailure(sandboxB),
    _source: source,  // expose for triage; not part of the score
  };
}

// === Aggregate across runs ===
// Returns { n, dim1, dim2, ... } where each dim is the hit rate (0-1) across runs.
export function aggregateScore(dimsList) {
  if (!dimsList || dimsList.length === 0) return null;
  const keys = [
    'sourceExtracted', 'functionShapeOk',
    'usesRenderConnect', 'renderConnectArgsOk',
    'usesRenderSubscribe', 'renderSubscribeArgsOk',
    'attemptsRetry', 'readsSessionStore',
    'sandboxRan', 'packetsCorrect', 'retriesSurvivedFailure',
  ];
  const agg = { n: dimsList.length };
  for (const k of keys) {
    const sum = dimsList.reduce((acc, d) => acc + (d[k] || 0), 0);
    agg[k] = sum / dimsList.length;
  }
  // overall = mean of all dims
  const total = keys.reduce((acc, k) => acc + agg[k], 0);
  agg.overall = total / keys.length;
  return agg;
}
