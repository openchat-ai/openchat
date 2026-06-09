// 50-mqtt-split/scoring.mjs
//
// 14-dim scoring for the 2-round split.
//   R1  static (5): sourceExtracted, functionShapeOk, usesRenderConnect, renderConnectArgsOk, attemptsRetry
//   R1  dynamic (2): sandboxRan (subA: refuse=0), retriesSurvivedFailure (subB: refuse=2)
//   R2  static (5): sourceExtracted, functionShapeOk, usesRenderSubscribe, renderSubscribeArgsOk, readsSessionStore
//   R2  dynamic (2): sandboxRan (subA: 0 stored), packetsCorrect (subB: 3 stored)
//   Combined (4): sandboxRan (A: 0 stored), retries (B: refuse=2, 3 stored),
//                  packets (B), endToEnd (B: r2Return.restoredCount === 3)
//
// All checks are 0/1. scoreOne() returns the full dim dict for one LLM run.
// aggregateScore() averages across runs.

// === Source extraction ===
export function extractSource(llmOutput) {
  if (!llmOutput || typeof llmOutput !== 'string') return null;
  const m = llmOutput.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  return null;
}

// === R1 static checks ===

export function checkR1SourceExtracted(llmOutput) {
  return extractSource(llmOutput) ? 1 : 0;
}

export function checkR1FunctionShape(source) {
  if (!source) return 0;
  return /async\s+function\s+connectWithRetry\s*\(/.test(source) ? 1 : 0;
}

export function checkR1UsesRenderConnect(source) {
  if (!source) return 0;
  return /\brenderConnect\s*\(/.test(source) ? 1 : 0;
}

export function checkR1RenderConnectArgs(source) {
  if (!source) return 0;
  const m = source.match(/renderConnect\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!m) return 0;
  const body = m[1];
  if (!/protoName\s*:\s*['"]MQTT['"]/.test(body)) return 0;
  if (!/protoLevel\s*:\s*4\b/.test(body)) return 0;
  if (!/connectFlags\s*:/i.test(body)) return 0;
  if (!/keepAlive\s*:/i.test(body)) return 0;
  if (!/\bclientId\b/.test(body)) return 0;
  return 1;
}

export function checkR1AttemptsRetry(source) {
  if (!source) return 0;
  if (/\b(for|while)\s*\(/.test(source)) return 1;
  if (/\b(attempts?|retries|maxAttempts|retryCount|tryCount)\b/i.test(source)) return 1;
  return 0;
}

// === R1 dynamic checks ===

export function checkR1SandboxRan(r1subA) {
  if (!r1subA) return 0;
  if (r1subA.error) return 0;
  if (!r1subA.returnValue) return 0;
  // R1 must return a conn object {socket, clientId}
  const r = r1subA.returnValue;
  if (typeof r !== 'object' || r === null) return 0;
  if (typeof r.socket === 'undefined') return 0;
  if (r.clientId !== 'test-split') return 0;
  return 1;
}

export function checkR1RetriesSurvivedFailure(r1subB) {
  if (!r1subB) return 0;
  if (r1subB.error) return 0;
  if (!r1subB.returnValue) return 0;
  // Must have produced at least 1×CONNECT (the successful attempt after retry)
  if (!r1subB.packets || r1subB.packets.length === 0) return 0;
  if (r1subB.packets[0].type !== 1) return 0;
  // And it should have taken >= 3 attempts (refuse=2 means succeed on 3rd)
  if (r1subB.attemptCount < 3) return 0;
  return 1;
}

// === R2 static checks ===

export function checkR2SourceExtracted(llmOutput) {
  return extractSource(llmOutput) ? 1 : 0;
}

export function checkR2FunctionShape(source) {
  if (!source) return 0;
  return /async\s+function\s+restoreSubscriptions\s*\(/.test(source) ? 1 : 0;
}

export function checkR2UsesRenderSubscribe(source) {
  if (!source) return 0;
  return /\brenderSubscribe\s*\(/.test(source) ? 1 : 0;
}

export function checkR2RenderSubscribeArgs(source) {
  if (!source) return 0;
  const m = source.match(/renderSubscribe\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!m) return 0;
  const body = m[1];
  if (!/packetId\s*:/i.test(body)) return 0;
  if (!/subscriptions\s*:\s*\[/.test(body)) return 0;
  return 1;
}

export function checkR2ReadsSessionStore(source) {
  if (!source) return 0;
  return /sessionStore\s*\.\s*getSubscriptions/.test(source) ? 1 : 0;
}

// === R2 dynamic checks ===

export function checkR2SandboxRan(r2subA) {
  if (!r2subA) return 0;
  if (r2subA.error) return 0;
  if (!r2subA.returnValue) return 0;
  return 1;
}

export function checkR2PacketsCorrect(r2subB, expectedCount = 3) {
  if (!r2subB || !r2subB.packets || r2subB.packets.length === 0) return 0;
  // All packets must be SUBSCRIBE (type=8)
  if (!r2subB.packets.every((p) => p.type === 8)) return 0;
  // Count must match expected
  if (r2subB.packets.length !== expectedCount) return 0;
  // Return value restoredCount must match
  if (!r2subB.returnValue || r2subB.returnValue.restoredCount !== expectedCount) return 0;
  return 1;
}

// === Combined dynamic checks ===

export function checkCombinedSandboxRan(combinedA) {
  if (!combinedA) return 0;
  if (combinedA.error) return 0;
  if (!combinedA.r2Return) return 0;
  // With 0 stored subs, r2Return should have restoredCount=0
  if (combinedA.r2Return.restoredCount !== 0) return 0;
  // Should have exactly 1×CONNECT + 0×SUBSCRIBE
  if (!combinedA.packets || combinedA.packets.length !== 1) return 0;
  if (combinedA.packets[0].type !== 1) return 0;
  return 1;
}

export function checkCombinedRetries(combinedB) {
  if (!combinedB) return 0;
  if (combinedB.error) return 0;
  if (!combinedB.r2Return) return 0;
  // After retry, must have at least 1×CONNECT
  if (!combinedB.packets || combinedB.packets.length === 0) return 0;
  if (combinedB.packets.filter((p) => p.type === 1).length === 0) return 0;
  // And it should have taken >= 3 attempts
  if (combinedB.attemptCount < 3) return 0;
  return 1;
}

export function checkCombinedPackets(combinedB, expectedSubscribeCount = 3) {
  if (!combinedB || !combinedB.packets) return 0;
  // At least 1×CONNECT (from successful retry) + N×SUBSCRIBE
  const connects = combinedB.packets.filter((p) => p.type === 1);
  const subs = combinedB.packets.filter((p) => p.type === 8);
  if (connects.length === 0) return 0;
  if (subs.length !== expectedSubscribeCount) return 0;
  // Order: all CONNECTs must come before all SUBSCRIBEs
  let seenSub = false;
  for (const p of combinedB.packets) {
    if (p.type === 8) seenSub = true;
    else if (p.type === 1 && seenSub) return 0;
  }
  return 1;
}

export function checkCombinedEndToEnd(combinedB, expectedCount = 3) {
  if (!combinedB) return 0;
  if (combinedB.error) return 0;
  if (!combinedB.r2Return) return 0;
  if (combinedB.r2Return.restoredCount !== expectedCount) return 0;
  if (!Array.isArray(combinedB.r2Return.subscriptions)) return 0;
  if (combinedB.r2Return.subscriptions.length !== expectedCount) return 0;
  return 1;
}

// === Score a single LLM run (2 LLM calls → 1 set of dims) ===
// Input: { r1LlmOutput, r2LlmOutput, r1subA, r1subB, r2subA, r2subB, combinedA, combinedB }

export function scoreOne({ r1LlmOutput, r2LlmOutput, r1subA, r1subB, r2subA, r2subB, combinedA, combinedB }) {
  const r1Source = extractSource(r1LlmOutput);
  const r2Source = extractSource(r2LlmOutput);
  return {
    // R1 static
    r1SourceExtracted: checkR1SourceExtracted(r1LlmOutput),
    r1FunctionShapeOk: checkR1FunctionShape(r1Source),
    r1UsesRenderConnect: checkR1UsesRenderConnect(r1Source),
    r1RenderConnectArgsOk: checkR1RenderConnectArgs(r1Source),
    r1AttemptsRetry: checkR1AttemptsRetry(r1Source),
    // R1 dynamic
    r1SandboxRan: checkR1SandboxRan(r1subA),
    r1RetriesSurvivedFailure: checkR1RetriesSurvivedFailure(r1subB),
    // R2 static
    r2SourceExtracted: checkR2SourceExtracted(r2LlmOutput),
    r2FunctionShapeOk: checkR2FunctionShape(r2Source),
    r2UsesRenderSubscribe: checkR2UsesRenderSubscribe(r2Source),
    r2RenderSubscribeArgsOk: checkR2RenderSubscribeArgs(r2Source),
    r2ReadsSessionStore: checkR2ReadsSessionStore(r2Source),
    // R2 dynamic
    r2SandboxRan: checkR2SandboxRan(r2subA),
    r2PacketsCorrect: checkR2PacketsCorrect(r2subB),
    // Combined
    combinedSandboxRan: checkCombinedSandboxRan(combinedA),
    combinedRetries: checkCombinedRetries(combinedB),
    combinedPackets: checkCombinedPackets(combinedB),
    combinedEndToEnd: checkCombinedEndToEnd(combinedB),
    // Triage helpers
    _r1Source: r1Source,
    _r2Source: r2Source,
    _r1LlmErr: r1LlmOutput === null || r1LlmOutput === undefined ? 'no llm output' : null,
    _r2LlmErr: r2LlmOutput === null || r2LlmOutput === undefined ? 'no llm output' : null,
  };
}

// === Aggregate across runs ===
export function aggregateScore(dimsList) {
  if (!dimsList || dimsList.length === 0) return null;
  const keys = [
    'r1SourceExtracted', 'r1FunctionShapeOk', 'r1UsesRenderConnect',
    'r1RenderConnectArgsOk', 'r1AttemptsRetry',
    'r1SandboxRan', 'r1RetriesSurvivedFailure',
    'r2SourceExtracted', 'r2FunctionShapeOk', 'r2UsesRenderSubscribe',
    'r2RenderSubscribeArgsOk', 'r2ReadsSessionStore',
    'r2SandboxRan', 'r2PacketsCorrect',
    'combinedSandboxRan', 'combinedRetries', 'combinedPackets', 'combinedEndToEnd',
  ];
  const agg = { n: dimsList.length };
  for (const k of keys) {
    const sum = dimsList.reduce((acc, d) => acc + (d[k] || 0), 0);
    agg[k] = sum / dimsList.length;
  }
  const total = keys.reduce((acc, k) => acc + agg[k], 0);
  agg.overall = total / keys.length;
  return agg;
}
