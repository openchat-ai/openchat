// lab-dashboard.mjs — /lab web UI + 8 JSON API
//
//   GET /lab                    → HTML dashboard (5 tab, 5s poll, time window filter)
//   GET /lab/api/status         → queue 状态计数
//   GET /lab/api/queue          → listGoals
//   GET /lab/api/history        → listHistory (?sinceMs=X)
//   GET /lab/api/failures       → listFailed + classification (?sinceMs=X)
//   GET /lab/api/escalated      → listEscalated (?sinceMs=X)
//   GET /lab/api/regressions    → detectRegressions
//   GET /lab/api/aggregate      → getExperimentStats
//   GET /lab/api/retry-stats    → 算自 history
//
// 后续 (L3): 加 WebSocket 推 (现在 5s poll 够用)
// 不做: 交互式 (restart goal, retry 等) — 走 lab.mjs CLI, 留 P4
//
// auth: 无 (跟随 /identity 同样假设, L1.5 桥内 trust 域)

// === invariants ===
// - 8 API 都只读 JSONL, 不写 (后端 lab 写入走 lab.mjs CLI / runner.mjs)
// - 调 src/lab/* 模块, 不复制读 jsonl 逻辑
// - HTML 不缓存 (no-store) — 改 JS 立刻见效
// - sinceMs 是相对 (ms, 客户端 Date.now()-sinceMs → since) — 不是绝对时间戳
// - 颜色: green=ok, red=failed, yellow=transient/running, orange=config, gray=pending/unknown
// - 5s poll, 不 WebSocket — 留 L3
// - 错误返 500 JSON {error}, HTML 显示红色 banner, 不刷死

import { Router } from 'express';
import { listGoals, getStatus, listFailed } from '../../lab/goal-queue.mjs';
import { listHistory } from '../../lab/history.mjs';
import { getExperimentStats } from '../../lab/aggregator.mjs';
import { detectRegressions } from '../../lab/regression.mjs';
import { listEscalated, getEscalationStats } from '../../lab/escalate.mjs';

const router = Router();

// === JSON API ===

router.get('/api/status', (req, res) => {
  res.json(getStatus());
});

router.get('/api/queue', (req, res) => {
  res.json({ goals: listGoals() });
});

router.get('/api/history', (req, res) => {
  const since = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
  res.json({ runs: listHistory(since ? { since } : {}) });
});

router.get('/api/failures', (req, res) => {
  const since = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
  let failed = listFailed();
  if (since) failed = failed.filter(g => (g.finishedAt || 0) >= since);
  res.json({ failed });
});

router.get('/api/escalated', (req, res) => {
  const since = req.query.sinceMs ? Number(req.query.sinceMs) : undefined;
  let records = listEscalated();
  if (since) records = records.filter(r => r.escalatedAt >= since);
  res.json({ records, stats: getEscalationStats() });
});

router.get('/api/regressions', (req, res) => {
  res.json(detectRegressions());
});

router.get('/api/aggregate', (req, res) => {
  res.json({ experiments: getExperimentStats() });
});

router.get('/api/retry-stats', (req, res) => {
  // 跟 CLI 同样算法 (P3 抽函数更好, 但 spec 跟 CLI 一致, 先复制)
  const all = listHistory();
  if (all.length === 0) return res.json({ empty: true });
  const perAttempt = { 1: 0, 2: 0, 3: 0 };
  for (const r of all) {
    if (r.classification?.category === 'transient') perAttempt[r.retryAttempt] = (perAttempt[r.retryAttempt] || 0) + 1;
  }
  const goalHistory = new Map();
  for (const r of all) {
    if (!goalHistory.has(r.goalId)) goalHistory.set(r.goalId, []);
    goalHistory.get(r.goalId).push(r);
  }
  let transientFails = 0, transientSucceeded = 0, transientExhausted = 0;
  for (const records of goalHistory.values()) {
    const hitTransient = records.some(r => r.classification?.category === 'transient');
    if (!hitTransient) continue;
    transientFails++;
    const last = records.sort((a, b) => a.finishedAt - b.finishedAt).pop();
    if (last.status === 'done') transientSucceeded++;
    else transientExhausted++;
  }
  const saveRate = transientFails > 0 ? transientSucceeded / transientFails : null;
  res.json({ transientFails, transientSucceeded, transientExhausted, saveRate, perAttempt });
});

// === HTML page ===

router.get('/', (req, res) => {
  res.set('Content-Security-Policy', "default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self' data:");
  res.set('Cache-Control', 'no-store');
  res.send(HTML_PAGE);
});

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Lab Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#e0e0e0;font:13px/1.5 -apple-system,monospace;padding:16px}
h1{color:#7c8aff;font-size:18px;margin-bottom:12px}
.bar{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
.bar .stat{background:#1a1a2e;padding:6px 12px;border-radius:4px;font-size:12px}
.bar .stat b{color:#7c8aff;margin-right:6px}
.tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid #333}
.tab{background:none;color:#888;border:none;padding:8px 16px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent}
.tab.active{color:#7c8aff;border-bottom-color:#7c8aff}
.tab:hover{color:#e0e0e0}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{text-align:left;color:#888;border-bottom:1px solid #333;padding:6px 8px;font-size:11px;font-weight:normal}
td{padding:6px 8px;border-bottom:1px solid #1a1a2e;font-size:12px}
tr:hover{background:#1a1a2e}
.status-done{color:#51cf66}
.status-failed{color:#ff6b6b}
.status-pending{color:#888}
.status-running{color:#ffd43b}
.cat-success{color:#51cf66}
.cat-transient{color:#ffd43b}
.cat-code{color:#ff6b6b}
.cat-config{color:#ff922b}
.cat-unknown{color:#888}
.empty{color:#666;padding:24px;text-align:center;font-style:italic}
.win-pick{background:#1a1a2e;color:#e0e0e0;border:1px solid #333;padding:4px 8px;border-radius:4px;font-size:12px}
.error{color:#ff6b6b;padding:8px}
.refresh{color:#666;font-size:11px;margin-left:auto}
.btn{background:#7c8aff;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px}
.btn:hover{opacity:.85}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:#1a1a2e;padding:12px;border-radius:4px;border:1px solid #333}
.card h3{color:#7c8aff;font-size:13px;margin-bottom:8px;font-weight:normal}
.kv{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}
.kv .k{color:#888}
.kv .v{color:#e0e0e0}
</style>
</head>
<body>
<h1>Lab Dashboard <span class="refresh" id="refresh">refresh in 5s</span></h1>
<div class="bar">
  <span class="stat" id="stat-total"><b>total</b>--</span>
  <span class="stat" id="stat-pending"><b>pending</b>--</span>
  <span class="stat" id="stat-running"><b>running</b>--</span>
  <span class="stat" id="stat-done"><b>done</b>--</span>
  <span class="stat" id="stat-failed"><b>failed</b>--</span>
  <select class="win-pick" id="win">
    <option value="3600000">last 1h</option>
    <option value="86400000" selected>last 24h</option>
    <option value="604800000">last 7d</option>
    <option value="0">all time</option>
  </select>
</div>
<div class="tabs">
  <button class="tab active" data-tab="queue">Queue</button>
  <button class="tab" data-tab="history">History</button>
  <button class="tab" data-tab="failures">Failures</button>
  <button class="tab" data-tab="escalated">Escalated</button>
  <button class="tab" data-tab="stats">Stats</button>
</div>
<div id="content"></div>
<script>
let _tab = 'queue';
let _sinceMs = 86400000;
const $ = (s) => document.querySelector(s);
const fmtTime = (ms) => ms ? new Date(ms).toISOString().slice(0,19).replace('T',' ') : '-';
const dur = (ms) => ms == null ? '-' : (ms/1000).toFixed(1)+'s';
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}

function sinceQuery() { return _sinceMs > 0 ? '?sinceMs='+(Date.now()-_sinceMs) : ''; }

async function refresh() {
  $('#refresh').textContent = 'refreshing...';
  try {
    const s = await fetchJson('/lab/api/status');
    $('#stat-total').innerHTML = '<b>total</b>'+s.total;
    $('#stat-pending').innerHTML = '<b>pending</b>'+s.pending;
    $('#stat-running').innerHTML = '<b>running</b>'+s.running;
    $('#stat-done').innerHTML = '<b>done</b>'+s.done;
    $('#stat-failed').innerHTML = '<b>failed</b>'+s.failed;
    await renderTab();
  } catch (e) { $('#content').innerHTML = '<div class="error">'+esc(e.message)+'</div>'; }
  $('#refresh').textContent = 'refresh in 5s';
}

async function renderTab() {
  const c = $('#content');
  if (_tab === 'queue') return c.innerHTML = await renderQueue();
  if (_tab === 'history') return c.innerHTML = await renderHistory();
  if (_tab === 'failures') return c.innerHTML = await renderFailures();
  if (_tab === 'escalated') return c.innerHTML = await renderEscalated();
  if (_tab === 'stats') return c.innerHTML = await renderStats();
}

async function renderQueue() {
  const d = await fetchJson('/lab/api/queue');
  if (!d.goals.length) return '<div class="empty">(empty queue)</div>';
  let h = '<table><thead><tr><th>STATUS</th><th>ID</th><th>ADDED</th><th>RETRY</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const g of d.goals) {
    h += '<tr><td class="status-'+g.status+'">'+g.status+'</td><td>'+esc(g.id)+'</td><td>'+fmtTime(g.addedAt)+'</td><td>'+(g.retryCount||0)+'</td><td>'+esc(g.description.slice(0,80))+'</td></tr>';
  }
  return h + '</tbody></table>';
}

async function renderHistory() {
  const d = await fetchJson('/lab/api/history'+sinceQuery());
  if (!d.runs.length) return '<div class="empty">(no history in window)</div>';
  const last = d.runs.slice(-50).reverse();
  let h = '<table><thead><tr><th>FINISHED</th><th>STATUS</th><th>DUR</th><th>CAT</th><th>RETRY</th><th>GOAL-ID</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const r of last) {
    const cat = r.classification?.category || '-';
    h += '<tr><td>'+fmtTime(r.finishedAt)+'</td><td class="status-'+r.status+'">'+r.status+'</td><td>'+dur(r.durationMs)+'</td><td class="cat-'+cat+'">'+cat+'</td><td>'+(r.retryAttempt||'-')+'</td><td>'+esc(r.goalId)+'</td><td>'+esc((r.description||'').slice(0,50))+'</td></tr>';
  }
  return h + '</tbody></table><div style="color:#666;font-size:11px;margin-top:8px">showing last '+last.length+' of '+d.runs.length+' (window: '+($('#win').selectedOptions[0].text)+')</div>';
}

async function renderFailures() {
  const d = await fetchJson('/lab/api/failures'+sinceQuery());
  if (!d.failed.length) return '<div class="empty">(no failures in window — clean run!)</div>';
  const byCat = {};
  for (const g of d.failed) {
    const c = g.classification?.category || 'unclassified';
    byCat[c] = (byCat[c]||0)+1;
  }
  let h = '<div class="grid2"><div class="card"><h3>By Category</h3>';
  for (const [c,n] of Object.entries(byCat).sort((a,b)=>b[1]-a[1])) {
    h += '<div class="kv"><span class="k cat-'+c+'">'+c+'</span><span class="v">'+n+'</span></div>';
  }
  h += '</div></div><table style="margin-top:16px"><thead><tr><th>ID</th><th>RETRY</th><th>CATEGORY</th><th>REASON</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const g of d.failed) {
    const cat = g.classification?.category || 'unclassified';
    h += '<tr><td>'+esc(g.id)+'</td><td>'+(g.retryCount||0)+'</td><td class="cat-'+cat+'">'+cat+'</td><td>'+esc(g.classification?.reason||'-')+'</td><td>'+esc(g.description.slice(0,60))+'</td></tr>';
  }
  return h + '</tbody></table>';
}

async function renderEscalated() {
  const d = await fetchJson('/lab/api/escalated'+sinceQuery());
  if (!d.records.length) return '<div class="empty">(no escalations in window)</div>';
  let h = '<div class="grid2"><div class="card"><h3>Stats</h3><div class="kv"><span class="k">total</span><span class="v">'+d.stats.total+'</span></div>';
  for (const [c,n] of Object.entries(d.stats.byCategory)) h += '<div class="kv"><span class="k cat-'+c+'">'+c+'</span><span class="v">'+n+'</span></div>';
  h += '</div><div class="card"><h3>Top</h3>';
  for (const t of (d.stats.byDescription||[]).slice(0,5)) h += '<div class="kv"><span class="k">'+esc(t.description.slice(0,40))+'</span><span class="v">'+t.count+'x</span></div>';
  h += '</div></div><table style="margin-top:16px"><thead><tr><th>ESCALATED</th><th>ATT</th><th>CAT</th><th>GOAL-ID</th><th>DESCRIPTION</th></tr></thead><tbody>';
  for (const r of d.records.slice(-20).reverse()) {
    const cat = r.classification?.category || 'unclassified';
    h += '<tr><td>'+fmtTime(r.escalatedAt)+'</td><td>'+r.attempts+'</td><td class="cat-'+cat+'">'+cat+'</td><td>'+esc(r.goalId)+'</td><td>'+esc(r.description.slice(0,50))+'</td></tr>';
  }
  return h + '</tbody></table>';
}

async function renderStats() {
  const [agg, reg, ret] = await Promise.all([
    fetchJson('/lab/api/aggregate'),
    fetchJson('/lab/api/regressions'),
    fetchJson('/lab/api/retry-stats'),
  ]);
  let h = '<div class="grid2">';
  h += '<div class="card"><h3>Retry Stats</h3>';
  if (ret.empty) h += '<div class="empty">(no data)</div>';
  else {
    h += '<div class="kv"><span class="k">transient goals</span><span class="v">'+ret.transientFails+'</span></div>';
    h += '<div class="kv"><span class="k">saved by retry</span><span class="v cat-success">'+ret.transientSucceeded+'</span></div>';
    h += '<div class="kv"><span class="k">exhausted</span><span class="v cat-code">'+ret.transientExhausted+'</span></div>';
    if (ret.saveRate != null) h += '<div class="kv"><span class="k">save rate</span><span class="v">'+(ret.saveRate*100).toFixed(0)+'%</span></div>';
  }
  h += '</div>';
  h += '<div class="card"><h3>Regressions</h3>';
  if (reg.message) h += '<div class="empty">'+esc(reg.message)+'</div>';
  else {
    h += '<div class="kv"><span class="k">regressions</span><span class="v cat-code">'+reg.regressions.length+'</span></div>';
    h += '<div class="kv"><span class="k">improvements</span><span class="v cat-success">'+reg.improvements.length+'</span></div>';
    for (const r of reg.regressions.slice(0,3)) h += '<div class="kv"><span class="k">'+esc(r.type)+'</span><span class="v">'+esc(r.message.slice(0,40))+'</span></div>';
  }
  h += '</div></div>';
  h += '<h3 style="margin-top:16px;color:#7c8aff">Per-Experiment</h3>';
  if (!agg.experiments.length) h += '<div class="empty">(no data)</div>';
  else {
    h += '<table><thead><tr><th>DESCRIPTION</th><th>RUNS</th><th>PASS</th><th>FAIL</th><th>RATE</th><th>AVG_DUR</th><th>LAST5</th></tr></thead><tbody>';
    for (const s of agg.experiments) {
      const rate = (s.successRate*100).toFixed(0)+'%';
      h += '<tr><td>'+esc(s.description.slice(0,50))+'</td><td>'+s.total+'</td><td class="cat-success">'+s.success+'</td><td class="cat-code">'+s.failed+'</td><td>'+rate+'</td><td>'+dur(s.avgDurationMs)+'</td><td>'+s.last5Success+'/5</td></tr>';
    }
    h += '</tbody></table>';
  }
  return h;
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  _tab = t.dataset.tab;
  renderTab();
}));
$('#win').addEventListener('change', e => { _sinceMs = Number(e.target.value); renderTab(); });
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

export default router;
