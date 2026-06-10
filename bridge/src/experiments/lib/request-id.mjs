import crypto from 'crypto';
const _store = new Map();

export function generate() {
  const id = crypto.randomUUID().slice(0, 8);
  return id;
}

export function createSpan(parentId, name) {
  const id = generate();
  _store.set(id, { parentId, name, start: Date.now() });
  return id;
}

export function endSpan(spanId) {
  const span = _store.get(spanId);
  if (!span) return;
  span.duration = Date.now() - span.start;
}

export function getTrace(spanId) {
  const parts = [];
  let cur = spanId;
  while (cur && _store.has(cur)) {
    const s = _store.get(cur);
    parts.unshift(s);
    cur = s.parentId;
  }
  return parts;
}

export function formatLog(requestId, ...args) {
  return `[${requestId}] ${args.join(' ')}`;
}
