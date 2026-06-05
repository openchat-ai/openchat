// openchat dev — multi-session 浏览器
const sessionList = document.getElementById('session-list');
const thinkLog = document.getElementById('think-log');
const finalLog = document.getElementById('final-log');
const currentSessionEl = document.getElementById('current-session');
const statusEl = document.getElementById('status');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const newSessionBtn = document.getElementById('new-session');
const streamAllBtn = document.getElementById('stream-all-btn');

let currentSid = null;
let isStreamAll = false;
let streamController = null;

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sidLabel = (sid) => sid ? `<span class="sid-label">${escapeHtml(sid.substring(0, 8))}</span> ` : '';

const appendThink = (text, sid) => {
  const d = document.createElement('div');
  d.className = 'event';
  d.innerHTML = sidLabel(sid) + text;
  thinkLog.appendChild(d);
  thinkLog.scrollTop = thinkLog.scrollHeight;
};

const appendTool = (tool, args, sid) => {
  const d = document.createElement('div');
  d.className = 'event tool';
  const argsStr = Object.entries(args || {}).map(([k, v]) => `${k}=${typeof v === 'string' ? v.substring(0, 50) : JSON.stringify(v).substring(0, 50)}`).join(', ');
  d.innerHTML = sidLabel(sid) + `→ ${tool}(${argsStr})`;
  thinkLog.appendChild(d);
  thinkLog.scrollTop = thinkLog.scrollHeight;
};

const appendResult = (tool, result, sid) => {
  const d = document.createElement('div');
  d.className = 'event result';
  const preview = typeof result === 'string' ? result : JSON.stringify(result);
  d.innerHTML = sidLabel(sid) + `← ${tool}: ${preview.substring(0, 150)}`;
  thinkLog.appendChild(d);
  thinkLog.scrollTop = thinkLog.scrollHeight;
};

const unwrapJsonAnswer = (text) => {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const inner = obj.answer ?? obj.response ?? obj.text ?? obj.content ?? obj.result;
      if (typeof inner === 'string') return inner;
    }
  } catch {}
  return text;
};

const appendFinal = (text, sid) => {
  text = unwrapJsonAnswer(text);
  const d = document.createElement('div');
  d.className = 'msg';
  d.innerHTML = sidLabel(sid) + text;
  finalLog.appendChild(d);
  finalLog.scrollTop = finalLog.scrollHeight;
};

const appendFinalUser = (text, sid) => {
  const d = document.createElement('div');
  d.className = 'msg user';
  d.innerHTML = sidLabel(sid) + '> ' + text;
  finalLog.appendChild(d);
  finalLog.scrollTop = finalLog.scrollHeight;
};

const appendFinalError = (text, sid) => {
  const d = document.createElement('div');
  d.className = 'msg error';
  d.innerHTML = sidLabel(sid) + '✗ ' + text;
  finalLog.appendChild(d);
  finalLog.scrollTop = thinkLog.scrollHeight;
};

const HANDLERS = {
  session: (e, sid) => { if (!currentSid && !isStreamAll) currentSid = e.sessionId; },
  thinking: (e, sid) => appendThink('思考: ' + (e.content || 'iteration ' + e.iteration), sid),
  content: (e, sid) => {
    const text = unwrapJsonAnswer(e.content || '');
    if (e.reasoningContent) appendThink('(partial) ' + e.reasoningContent, sid);
    if (text) appendFinalUser('(partial) ' + text, sid);
  },
  tool_call: (e, sid) => appendTool(e.tool, e.args, sid),
  tool_result: (e, sid) => appendResult(e.tool, e.result, sid),
  iteration: () => {},
  complete: (e, sid) => {
    if (e.reasoningContent) appendThink('最终思考: ' + e.reasoningContent, sid);
    const text = unwrapJsonAnswer(e.response || '');
    if (text) appendFinal(text, sid);
  },
  error: (e, sid) => appendFinalError(e.error || e.message || 'unknown', sid),
  done: () => setBusy(false),
  subscribed: () => {},
};

let busy = false;
const setBusy = (b) => {
  busy = b;
  sendBtn.disabled = b;
  statusEl.className = b ? 'busy' : '';
};

const clearLogs = () => {
  thinkLog.innerHTML = '';
  finalLog.innerHTML = '';
};

const dispatchEvent = (e) => {
  const sid = e.sessionId || currentSid;
  const handler = HANDLERS[e.type];
  if (handler) handler(e, sid);
};

const readSSE = async (url, signal) => {
  const r = await fetch(url, { signal });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { dispatchEvent(JSON.parse(line.slice(6))); } catch {}
    }
  }
};

const switchSession = async (sid) => {
  isStreamAll = false;
  streamAllBtn.classList.remove('active');
  currentSid = sid;
  currentSessionEl.textContent = sid || '未选择';
  clearLogs();
  if (streamController) { streamController.abort(); streamController = null; }
  if (!sid) return;
  streamController = new AbortController();
  try {
    await readSSE(`/api/sessions/${encodeURIComponent(sid)}/stream`, streamController.signal);
  } catch (e) {
    if (e.name !== 'AbortError') appendFinalError('stream disconnected');
  }
};

const streamAll = async () => {
  isStreamAll = true;
  streamAllBtn.classList.add('active');
  currentSid = null;
  currentSessionEl.textContent = '全部 session';
  clearLogs();
  if (streamController) { streamController.abort(); streamController = null; }
  streamController = new AbortController();
  try {
    await readSSE('/api/sessions/stream', streamController.signal);
  } catch (e) {
    if (e.name !== 'AbortError') appendFinalError('all-stream disconnected');
  }
};

streamAllBtn.onclick = () => {
  if (isStreamAll) {
    document.querySelector('.session-item.active')?.click();
  } else {
    streamAll();
  }
};

const refreshSessions = async () => {
  try {
    const r = await fetch('/api/sessions');
    const d = await r.json();
    sessionList.innerHTML = '';
    if (!d.sessions || d.sessions.length === 0) {
      sessionList.innerHTML = '<div style="padding:10px;color:#888;font-size:11px">无活跃 session</div>';
      return;
    }
    // 排序: 最后活跃优先
    const sorted = [...d.sessions].sort((a, b) => (b.lastEventAt || b.created || 0) - (a.lastEventAt || a.created || 0));
    for (const s of sorted) {
      const div = document.createElement('div');
      const active = s.sessionId === currentSid || (isStreamAll && s.sessionId === document.querySelector('.session-item.active')?.dataset?.sid);
      div.className = 'session-item' + (active ? ' active' : '');
      div.dataset.sid = s.sessionId;
      const lastEvent = s.lastEventAt ? new Date(s.lastEventAt).toLocaleTimeString() : '';
      const model = s.model ? ' · ' + escapeHtml(s.model) : '';
      div.innerHTML = `<div class="sid">${escapeHtml(s.sessionId.substring(0, 12))}…</div><div class="meta">${escapeHtml(s.source || '')}${model} · ${s.eventCount || 0} ev · ${lastEvent}</div>`;
      div.onclick = () => switchSession(s.sessionId);
      sessionList.appendChild(div);
    }
  } catch (e) { /* silent */ }
};

const send = async () => {
  const msg = input.value.trim();
  if (!msg || busy) return;
  setBusy(true);
  input.value = '';
  appendFinalUser(msg);
  try {
    await fetch('/api/chat/debug', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, sessionId: currentSid }),
    });
    setTimeout(refreshSessions, 1500);
  } catch (e) {
    appendFinalError('send failed: ' + e.message);
    setBusy(false);
  }
};

const newSession = async () => {
  if (isStreamAll) streamAllBtn.click();
  await switchSession(null);
  input.focus();
};

sendBtn.onclick = send;
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
newSessionBtn.onclick = newSession;

setInterval(refreshSessions, 3000);
refreshSessions();
input.focus();
