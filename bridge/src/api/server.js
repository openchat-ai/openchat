/**
 * OpenChat API Server
 * 统一的 REST API 框架
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import http from 'http';
import net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import swaggerUi from 'swagger-ui-express';

import { errorHandler } from './middleware/error-handler.js';
import requestValidator from './middleware/request-validator.js';
import { securityMiddleware } from './middleware/security.js';
import { DEFAULT_PORT } from '../constants.js';
import { qiniuSignaling } from '../core/qiniu-signaling.js';
import { SignalRelay } from '../core/signal-relay.js';

// 路由
import feedbackRouter from './routes/feedback.js';
import { createP2PRouter } from './routes/p2p.js';
import updatesRouter from './routes/updates.js';
import skillsRouter from './routes/skills.js';
import versionsRouter from './routes/versions.js';
import resourcesRouter from './routes/resources.js';
    import legacyRouter from './routes/legacy.js';
    import devRouter from './routes/dev/index.js';
import metricsRouter from './routes/metrics.js';
import healthRouter from './routes/health.js';
import voiceRouter from './routes/voice.js';
import signalingRouter from './routes/signaling.js';
import labDashboardRouter from './routes/lab-dashboard.mjs';

class APIServer {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.swarm = options.swarm || null;
    this.deployEnabled = options.deployEnabled !== false;
    // [L1.5] 多桥身份 — /identity 返回用
    this.name = options.name || 'unnamed';
    this.workdir = options.workdir || process.cwd();
    this.token = options.token || null;
    this.app = express();
    this.server = null;
    this.wss = null;
    this.signalingWss = null;
    this._signalingRooms = new Map();
    this._onWSMessage = null;
    this._signalRelay = null;

    this.setupMiddlewares();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setWSMessageHandler(handler) {
    this._onWSMessage = handler;
  }

  setupMiddlewares() {
    // 安全头
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: true,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: { maxAge: 31536000, includeSubDomains: true },
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: true,
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true
    }));

    // CORS - 根据环境配置
    const corsOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
      : process.env.NODE_ENV === 'production'
        ? ['https://localhost:3800']
        : '*';

    this.app.use(cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
      credentials: true,
      maxAge: 86400 // 24 hours
    }));

    // 请求日志（开发环境精简输出）
    if (process.env.NODE_ENV === 'production') this.app.use(morgan('combined'));

    // 请求体解析 - 限制大小
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // 请求验证
    this.app.use(requestValidator);

    // 安全中间件（限流 + 黑名单）
    this.app.use(securityMiddleware);
  }

  setupRoutes() {
    // 健康检查 + 公开端点（无需认证）
    this.app.use('/health', healthRouter);

    // [L1.5] 桥身份 (手机列表用, 不需鉴权 — token 校验留 L3)
    this.app.get('/identity', (req, res) => {
      res.json({
        name: this.name,
        port: this.port,
        workdir: this.workdir,
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        version: '0.1.0',
        hasToken: !!this.token,
      });
    });
    this.app.get('/favicon.ico', (req, res) => {
      res.setHeader('Content-Type', 'image/gif');
      res.send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
    });
    this.app.get('/peers', (req, res) => {
      const p2p = this.swarm;
      const connected = p2p ? p2p.getConnectedPeers() : [];
      res.json({ peers: connected.map(id => ({ peerId: id.slice(0, 8) })) });
    });

    // List all registered users (via TopicRegistry)
    this.app.get('/users', (req, res) => {
      if (!this.swarm) return res.json({ users: [] });
      const topic = req.query.topic || 'users';
      const users = this.swarm.topicRegistry.getPeers(topic);
      res.json({ users: Array.isArray(users) ? users : [] });
    });

    // OpenAPI docs (no auth required)
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const openApiPath = path.resolve(__dirname, 'openapi.json');
    if (fs.existsSync(openApiPath)) {
      const openApiDoc = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));
      this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDoc, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'OpenChat API Docs',
      }));
    }

    // Qiniu 对象存储浏览器（诊断工具）
    this.app.get('/qiniu-browser', (req, res) => {
      res.set('Content-Security-Policy', "default-src 'self';script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';connect-src 'self';img-src 'self' data:");
      res.send(`<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>Qiniu Browser</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#e0e0e0;font:13px/1.5 monospace;padding:20px}
h1{color:#7c8aff;font-size:18px;margin-bottom:16px}
.bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.bar input{flex:1;min-width:200px;background:#1a1a2e;border:1px solid #333;color:#e0e0e0;padding:8px 12px;border-radius:4px}
.bar button{background:#7c8aff;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer}
.bar button.danger{background:#e04848}
.bar button:hover{opacity:.85}
table{width:100%;border-collapse:collapse}
th{text-align:left;color:#888;border-bottom:1px solid #333;padding:6px 8px;font-size:11px}
td{padding:6px 8px;border-bottom:1px solid #1a1a2e}
tr:hover{background:#1a1a2e}
tr.selected{background:#2a2a4e!important}
td.name{color:#7c8aff;cursor:pointer}
td.name.dir{color:#ffa502}
td.name.dir::before{content:"\\1F4C1 ";font-size:11px}
td.name.file::before{content:"\\1F4C4 ";font-size:11px}
td.size{color:#888;text-align:right}
td.time{color:#666}
td.cb{width:24px;text-align:center}
td.cb input{cursor:pointer}
.loading{color:#666;padding:20px;text-align:center}
#content{background:#1a1a2e;border:1px solid #333;border-radius:4px;padding:16px;margin-top:16px;white-space:pre-wrap;display:none;max-height:60vh;overflow:auto;font-size:12px}
#content.show{display:block}
#content textarea{width:100%;min-height:200px;background:#0a0a1a;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:8px;font:12px/1.5 monospace;resize:vertical}
#content .btn-row{margin-top:8px;display:flex;gap:8px}
.breadcrumb{color:#888;margin-bottom:12px;font-size:12px}
.breadcrumb a{color:#7c8aff;cursor:pointer;text-decoration:none;margin:0 2px}
.toast{position:fixed;bottom:20px;right:20px;background:#333;color:#e0e0e0;padding:8px 16px;border-radius:4px;font-size:12px;opacity:0;transition:opacity .3s}
.toast.show{opacity:1}
</style></head>
<body>
<h1>Qiniu Browser</h1>
<div class="bar">
  <input id="path" value="oc/" placeholder="prefix" spellcheck="false">
  <button id="browseBtn">Browse</button>
   <button id="delBtn" class="danger" style="display:none">Delete Selected</button>
   <button id="cleanTestBtn" class="danger">Clean Test Files</button>
</div>
<div class="breadcrumb" id="bc"></div>
<table id="tbl"><thead><tr><th class="cb"><input type="checkbox" id="selectAll"></th><th>Name</th><th>Size</th><th>Modified</th></tr></thead><tbody id="body"><tr><td class="loading" colspan="4">Enter a prefix and click Browse</td></tr></tbody></table>
<div id="content"></div>
<div id="toast" class="toast"></div>
<script>
let _prefix = '';

document.getElementById('browseBtn').addEventListener('click', () => browse());
document.getElementById('path').addEventListener('keydown', e => { if(e.key==='Enter') browse(); });
document.getElementById('delBtn').addEventListener('click', deleteSelected);
document.getElementById('cleanTestBtn').addEventListener('click', cleanTestFiles);
document.getElementById('selectAll').addEventListener('change', e => {
  document.querySelectorAll('#body input[type=checkbox]').forEach(cb => {cb.checked=e.target.checked});
  updateDelBtn();
});
document.getElementById('tbl').addEventListener('click', e => {
  if(e.target.type==='checkbox'){
    updateDelBtn();
    return;
  }
  const td = e.target.closest('td.name');
  if(!td) return;
  const key = td.dataset.key;
  if(!key) return;
  if(td.classList.contains('dir')) browse(key);
  else viewFile(key);
});
document.getElementById('bc').addEventListener('click', e => {
  const a = e.target.closest('a');
  if(a) browse(a.dataset.prefix);
});
function updateDelBtn(){
  const n = document.querySelectorAll('#body input[type=checkbox]:checked').length;
  document.getElementById('delBtn').style.display = n ? '' : 'none';
  document.getElementById('delBtn').textContent = 'Delete ('+n+')';
}

let _selectedKeys = new Set();

function browse(pfx){
  const prefix = pfx ?? document.getElementById('path').value.trim();
  if(!prefix) return;
  _prefix = prefix;
  _selectedKeys.clear();
  document.getElementById('delBtn').style.display='none';
  const c=document.getElementById('content');c.classList.remove('show');c.textContent='';
  document.getElementById('body').innerHTML = '<tr><td class="loading" colspan="4">Loading...</td></tr>';
  document.getElementById('selectAll').checked=false;
  fetch('/api/v1/qiniu/list?prefix='+encodeURIComponent(prefix))
    .then(r=>r.json()).then(d=>{
      if(!d.success){document.getElementById('body').innerHTML='<tr><td colspan="4" style="color:#ff6b6b">Error: '+escHtml(d.error)+'</td></tr>';return}
      render(prefix,d.items||[]);
    }).catch(e=>{document.getElementById('body').innerHTML='<tr><td colspan="4" style="color:#ff6b6b">'+escHtml(e)+'</td></tr>'});
}

function render(prefix, items){
  const parts = prefix.split('/').filter(Boolean);
  let bc = '<a data-prefix="">root</a>';
  let acc = '';
  for(const p of parts){
    acc += p+'/';
    bc += ' / <a data-prefix="'+escAttr(acc)+'">'+escHtml(p)+'</a>';
  }
  document.getElementById('bc').innerHTML = bc;
  if(!items.length){
    document.getElementById('body').innerHTML='<tr><td colspan="4" style="color:#666;padding:20px">(empty)</td></tr>';
    return;
  }
  let html = '';
  for(const it of items){
    const isDir = it.key.endsWith('/') || it.size===0;
    const name = it.key.replace(prefix, '') || '(this folder)';
    const sz = isDir ? '-' : fmtSize(it.size);
    const tm = it.lastModified ? new Date(it.lastModified).toLocaleString() : '-';
    const cls = isDir ? 'name dir' : 'name file';
    html += '<tr><td class="cb"><input type="checkbox" data-key="'+escAttr(it.key)+'" '+(it.size===0?'disabled':'')+'></td>';
    html += '<td class="'+cls+'" data-key="'+escAttr(it.key)+'">'+escHtml(name)+'</td><td class="size">'+sz+'</td><td class="time">'+tm+'</td></tr>';
  }
  document.getElementById('body').innerHTML = html;
}

let _editingKey = null;

function viewFile(key){
  _editingKey = key;
  document.querySelectorAll('#body tr').forEach(r=>r.style.background='');
  const c=document.getElementById('content');c.classList.add('show');c.textContent='Loading...';
  fetch('/api/v1/qiniu/get?key='+encodeURIComponent(key))
    .then(r=>r.json()).then(d=>{
      if(!d.success){c.textContent='Error: '+d.error;return}
      fetch(d.url).then(r=>r.text()).then(t=>{
        let pretty;
        try{pretty=JSON.stringify(JSON.parse(t),null,2)}catch(e){pretty=t}
        c.innerHTML = '<textarea id="editor">'+escHtml(pretty)+'</textarea>'
          +'<div class="btn-row">'
          +'<button onclick="saveFile()">Save</button>'
          +'<button class="danger" onclick="deleteFile(this.dataset.key)" data-key="'+escAttr(key)+'">Delete</button>'
          +'</div>';
      }).catch(e=>c.textContent='Fetch error: '+e.message);
    }).catch(e=>c.textContent='Error: '+e.message);
}

function saveFile(){
  const content = document.getElementById('editor').value;
  if(!_editingKey) return;
  const c=document.getElementById('content');
  c.innerHTML = 'Saving...';
  fetch('/api/v1/qiniu/put?key='+encodeURIComponent(_editingKey), {method:'PUT', body:content})
    .then(r=>r.json()).then(d=>{
      if(d.success){toast('Saved');c.classList.remove('show')}
      else toast('Error: '+d.error);
    }).catch(e=>toast('Error: '+e.message));
}

function deleteFile(key){
  if(!confirm('Delete '+key+'?')) return;
  fetch('/api/v1/qiniu/delete?key='+encodeURIComponent(key), {method:'DELETE'})
    .then(r=>r.json()).then(d=>{
      if(d.success){toast('Deleted');document.getElementById('content').classList.remove('show');browse(_prefix)}
      else toast('Error: '+d.error);
    }).catch(e=>toast('Error: '+e.message));
}

function deleteSelected(){
  const keys = [...document.querySelectorAll('#body input[type=checkbox]:checked')].map(cb=>cb.dataset.key).filter(Boolean);
  if(!keys.length) return;
  if(!confirm('Delete '+keys.length+' files?')) return;
  fetch('/api/v1/qiniu/batch-delete', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({keys})})
    .then(r=>r.json()).then(d=>{
      if(d.success){toast('Deleted '+d.results.filter(r=>r.ok).length+' files');browse(_prefix)}
      else toast('Error: '+d.error);
    }).catch(e=>toast('Error: '+e.message));
}

function cleanTestFiles(){
  if(!confirm('Delete test artifacts (latency-test, _test, flutter_test, token-test, e2e-test)?')) return;
  fetch('/api/v1/qiniu/clean-test', {method:'POST'})
    .then(r=>r.json()).then(d=>{
      if(d.success) toast('Deleted '+d.deleted+' test files');
      else toast('Error: '+d.error);
      browse(_prefix);
    }).catch(e=>toast('Error: '+e.message));
}

function toast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
}

function fmtSize(b){if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB'}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
</script></body></html>`);
    });

    // Qiniu API: list objects
    this.app.get('/api/v1/qiniu/list', async (req, res) => {
      try {
        const prefix = req.query.prefix || '';
        const items = await qiniuSignaling.listObjects(prefix);
        res.json({ success: true, items });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Qiniu API: get presigned URL
    this.app.get('/api/v1/qiniu/get', async (req, res) => {
      try {
        const key = req.query.key;
        if (!key) return res.status(400).json({ success: false, error: 'Missing key' });
        const url = qiniuSignaling.getSignedUrl(key, 3600);
        res.json({ success: true, url, key });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Qiniu API: put (create/update) file
    this.app.put('/api/v1/qiniu/put', express.text({limit:'10mb'}), async (req, res) => {
      try {
        const key = req.query.key;
        if (!key) return res.status(400).json({ success: false, error: 'Missing key' });
        const data = Buffer.from(req.body || '', 'utf8');
        await qiniuSignaling.putObject(key, data);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Qiniu API: delete file
    this.app.delete('/api/v1/qiniu/delete', async (req, res) => {
      try {
        const key = req.query.key;
        if (!key) return res.status(400).json({ success: false, error: 'Missing key' });
        await qiniuSignaling.deleteObject(key);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Qiniu API: clean test artifacts
    this.app.post('/api/v1/qiniu/clean-test', async (req, res) => {
      try {
        const items = await qiniuSignaling.listObjects('');
        const testPatterns = ['latency-test', '/_test/', 'flutter_test', 'token-test', 'e2e-test', '/poll-one-test/', '/call_recordings/', '/calls/demo_', '/debug/'];
        const toDelete = items.filter(f => testPatterns.some(p => f.key.includes(p)));
        for (const f of toDelete) {
          await qiniuSignaling.deleteObject(f.key).catch(() => {});
        }
        res.json({ success: true, deleted: toDelete.length });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Qiniu API: batch delete
    this.app.post('/api/v1/qiniu/batch-delete', express.json({limit:'1mb'}), async (req, res) => {
      try {
        const { keys } = req.body;
        if (!Array.isArray(keys) || keys.length === 0) return res.status(400).json({ success: false, error: 'Missing keys array' });
        const results = [];
        for (const key of keys) {
          try { await qiniuSignaling.deleteObject(key); results.push({ key, ok: true }); }
          catch (e) { results.push({ key, ok: false, error: e.message }); }
        }
        res.json({ success: true, results });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // 根路径 HTML Dashboard
    this.app.get('/', (req, res) => {
      res.send(`<html lang="zh"><head><meta charset="utf-8"><title>OpenChat</title></head>
<body style="background:#0a0a1a;color:#e0e0e0;font-family:monospace;padding:20px">
<h1 style="color:#7c8aff">OpenChat Bridge</h1>
<p style="color:#888">运行中. <a href="/qiniu-browser" style="color:#7c8aff">Qiniu Browser</a></p>
</body></html>`);
    });

    // API 信息
    this.app.get('/api/v1', (req, res) => {
      res.json({
        version: '1.0',
        endpoints: '/api/v1/p2p, /api/v1/updates, /api/v1/skills, /api/v1/versions, /api/v1/resources, /api/v1/voice, /api/v1/signaling, /api/v1/feedback'
      });
    });

    // Legacy Compatibility Layer
    this.app.use('/api', legacyRouter);
    this.app.use('/dev', devRouter);

    // Feedback
    this.app.use('/api/v1/feedback', feedbackRouter);

    // P2P 通信 API
    this.app.use('/api/v1/p2p', createP2PRouter(this.swarm));

    // 热更新 API
    this.app.use('/api/v1/updates', updatesRouter);

    // 版本管理和 Skill 市场 API
    this.app.use('/api/v1/skills', skillsRouter);
    this.app.use('/api/v1/versions', versionsRouter);

    // 资源优化 API
    this.app.use('/api/v1/resources', resourcesRouter);

    // Voice API (语音房间管理)
    this.app.use('/api/v1/voice', voiceRouter);
    this.app.use('/api/v1/signaling', signalingRouter);

    // Lab Dashboard (P3) — /lab HTML + 8 JSON API endpoints
    this.app.use('/lab', labDashboardRouter);

    // Chat Session API
    this.app.delete('/api/v1/chat/:chatId', async (req, res) => {
      try {
        const { chatId } = req.params;
        const { deleteSession } = await import('../core/session-tree.mjs');
        const result = await deleteSession(chatId);
        res.json({ success: true, deleted: result.length, details: result });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

    // Metrics API
    this.app.use('/api/v1/metrics', metricsRouter);

    // Deploy 站点（Bridge 自带 — 可配 bridge.deployServerEnabled=false 关闭）
    if (this.deployEnabled) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const deployDir = path.resolve(__dirname, '..', '..', '..', 'deploy');
      this.app.use('/deploy', express.static(deployDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.zip')) res.set('Content-Type', 'application/zip');
          if (filePath.endsWith('.tar.gz')) res.set('Content-Type', 'application/gzip');
        }
      }));
    }

    // 404 处理
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not Found', path: req.path });
    });
  }

  setupErrorHandling() {
    this.app.use(errorHandler);
  }

  setupWebSocket(server) {

    // Track connected clients (used by route-handlers for P2P forwarding)
    this.clients = new Set();

    // === L3-fix: 全部用 noServer=true, 走中央 upgrade 派发 ===
    // 原 {server} 模式多个 WSS 会冲突 (第一个绑的会 abort 别人)
    // 现在 _wsUpgraders 收 path→WSS, 由 _wsDispatchUpgrade 中央分发
    this._wsUpgraders = new Map();

    // Chat WebSocket
    this.wss = new WebSocketServer({ noServer: true });
    this._wsUpgraders.set('/ws', this.wss);
    this.wss.on('connection', (ws) => {
      console.debug('[WS] client connected');
      ws._peerId = 'ws-' + Date.now().toString(36);
      this.clients.add(ws);
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (this._onWSMessage) this._onWSMessage(ws, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', data: { message: e.message } }));
        }
      });
      ws.on('close', () => {
        this.clients.delete(ws);
        console.debug('[WS] client disconnected');
      });
      ws.send(JSON.stringify({ type: 'bridge_handshake', data: { version: 2, peerId: ws._peerId } }));
    });

    // WebRTC 信令 WebSocket
    this.signalingWss = new WebSocketServer({ noServer: true });
    this._wsUpgraders.set('/signaling', this.signalingWss);
    this.signalingWss.on('connection', (ws) => {
      let registeredPeerId = null;
      console.debug('[Signaling] 客户端已连接 via Express');
      ws.on('message', (data) => {
        // Binary frame → forward to target peer as-is
        if (Buffer.isBuffer(data)) {
          if (data.length < 3) return;
          // Relay binary to target peer extracted from frame header
          const frameType = data[2];
          if (frameType === 0x01 || frameType === 0x03) {
            // Audio/ACK frames relay to registered peerId
            if (registeredPeerId && this.swarm) {
              this._relayToNetwork({ raw: true, data: data }, ws);
            }
          }
          // Forward binary frame to all peers on this bridge (for 1-to-1)
          const targetWs = this._signalingRooms.get(registeredPeerId);
          if (targetWs && targetWs.readyState === 1 && targetWs !== ws) {
            targetWs.send(data);
          }
          return;
        }

        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'signaling_message' && msg.data) {
            const d = msg.data;
            if (d.action === 'register') {
              registeredPeerId = d.peerId;
              this._signalingRooms.set(registeredPeerId, ws);
              ws.send(JSON.stringify({ type: 'signaling_message', data: { action: 'registered', peerId: registeredPeerId } }));
              return;
            }
            if (d.action === 'audio-data' || d.action === 'route-gossip' || d.action === 'route-update') {
              this._routeSignaling(d, ws);
              return;
            }
            if (d.toPeerId) {
              const target = this._signalingRooms.get(d.toPeerId);
              if (target && target.readyState === 1) {
                target.send(JSON.stringify(msg));
              } else {
                // Target not on this Bridge — forward via P2P network
                this._relayToNetwork(d, ws);
              }
              return;
            }
          }
        } catch (e) { console.error('[Signaling] error:', e.message); }
      });
      ws.on('close', () => {
        if (registeredPeerId) this._signalingRooms.delete(registeredPeerId);
        // Notify P2P network that this peer left
        if (this.swarm && registeredPeerId) {
          this.swarm.broadcast({ type: 'peer_left', peerId: registeredPeerId });
        }
      });
    });
  }

  /**
   * L3: 注册新 WSS 到中央 upgrade 派发器
   * 外部模块 (e.g. ws-lab.mjs) 调这个
   */
  registerWebSocket(path, wss) {
    if (!this._wsUpgraders) {
      throw new Error('setupWebSocket() must be called first');
    }
    if (this._wsUpgraders.has(path)) {
      throw new Error(`path "${path}" already registered`);
    }
    this._wsUpgraders.set(path, wss);
  }

  /**
   * L3: 启动中央 upgrade 派发
   * 绑 httpServer.on('upgrade', ...) 一次, 按 path 找 WSS handleUpgrade
   */
  startWSDispatch(httpServer) {
    if (!this._wsUpgraders) {
      throw new Error('setupWebSocket() must be called first');
    }
    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url || '';
      const path = url.split('?')[0];
      const wss = this._wsUpgraders.get(path);
      if (!wss) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  }

  /** Route audio/gossip messages — try local first, then P2P network */
  _routeSignaling(data, ws) {
    const toPeerId = data['toPeerId'];
    if (!toPeerId) return;

    const target = this._signalingRooms.get(toPeerId);
    if (target && target.readyState === 1) {
      target.send(JSON.stringify({ type: 'signaling_message', data: data }));
      return;
    }

    // Forward via P2P network to the Bridge that has this peer
    this._relayToNetwork(data, ws);
  }

  /** Forward signaling data through P2P network to remote Bridges */
  _relayToNetwork(data, ws) {
    if (!this.swarm) return;
    this.swarm.broadcast({
      type: 'signaling_relay',
      fromBridge: this.swarm._peerId || 'unknown',
      data: data,
    });
  }

  /** When phone notifies new Qiniu data, fetch and forward to peers */
  _fetchQiniuData(peerId, socket) {
    setImmediate(async () => {
      try {
        // Read the latest audio frame from Qiniu
        const data = await this._signalRelay.read(`audio-${peerId}-latest`);
        if (data) {
          for (const [id, s] of this._signalingRooms) {
            if (id !== peerId) {
              try { s.write(data); } catch (e) { console.error('[C0]', e); }
            }
          }
        }
      } catch (e) { console.error('[C0]', e); }
    });
  }

  async start() {
    // Start raw TCP signaling server
    this._tcpServer = net.createServer((socket) => {
      let registeredPeerId = null;
      let buf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);

        // Process complete RFID-style frames
        while (buf.length >= 7) {
          if (buf[0] !== 0xBB) { buf = buf.subarray(1); continue; }
          const endIdx = buf.indexOf(0x7E, 1);
          if (endIdx < 0) break; // Wait for more data
          const frameLen = endIdx + 1;
          const frame = buf.subarray(0, frameLen);
          buf = buf.subarray(frameLen);

          if (frame.length < 7) continue;
          const type = frame[1];
          const cmd = frame[2];
          const pl = (frame[3] << 8) | frame[4];
          if (frame.length < 7 + pl) continue;

          const param = frame.subarray(5, 5 + pl);
          const body = [type, cmd, pl >> 8, pl & 0xFF, ...param];
          const cksum = frame[5 + pl];
          const expected = body.reduce((s, b) => (s + b) & 0xFF, 0);
          if (cksum !== expected) continue;

          // Parse command
          if (type === 0x00 && cmd === 0x02 && param.length > 0) {
            // Register: param = peerId (UTF-8)
            registeredPeerId = param.toString('utf8').replace(/\0/g, '');
            this._signalingRooms.set(registeredPeerId, socket);
            // Register in TopicRegistry so other peers can find this user
            if (this.swarm && this.swarm.topicRegistry) {
              this.swarm.topicRegistry.announce('users', registeredPeerId, { connected: true, ts: Date.now() });
            }
            socket.write(Buffer.from([0xBB, 0x01, 0x02, 0x00, 0x00, 0x03, 0x7E]));
            console.debug('[TCP] Peer:', registeredPeerId?.slice(0, 8));
            continue;
          }

          // Audio/signal forward
          if ((cmd === 0x01 || cmd === 0x02) && registeredPeerId) {
            for (const [id, s] of this._signalingRooms) {
              if (id !== registeredPeerId) {
                try { s.write(frame); } catch (e) { console.error('[C0]', e); }
              }
            }
            if (this.swarm) {
              this.swarm.broadcast({ type: 'signaling_relay', fromBridge: this.swarm._peerId, raw: frame.toString('base64') });
            }
            continue;
          }

          // Qiniu data notification: new data available in room, go read
          if (cmd === 0x05 && registeredPeerId) {
            this._fetchQiniuData(registeredPeerId, socket);
            continue;
          }
        }
      });

      socket.on('close', () => {
        if (registeredPeerId) {
          this._signalingRooms.delete(registeredPeerId);
          if (this.swarm && this.swarm.topicRegistry) {
            this.swarm.topicRegistry.leave('users', registeredPeerId);
          }
          console.debug('[TCP] Peer left:', registeredPeerId?.slice(0, 8));
        }
      });

      socket.on('error', () => {});
    });

    const tcpPort = this.port + 1;
    this._tcpServer.listen(tcpPort, () => {
      console.debug(`[Signaling] TCP server on port ${tcpPort}`);
    });
    this._tcpServer.once('error', (err) => {
      console.debug(`[Signaling] TCP server port ${tcpPort} ${err.code === 'EADDRINUSE' ? '被占用，跳过' : err.message}`);
    });

    // Init signal relay for Qiniu-based address exchange
    this._signalRelay = new SignalRelay(qiniuSignaling, 'bridge-' + (this.port || 3800));
    this._signalRelay.init();

    // Inject shared rooms + relay into signaling routes
    const { setSignalingContext } = await import('./routes/signaling.js');
    setSignalingContext(this._signalingRooms, this._signalRelay);

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port);
      this.server.once('listening', () => {
        console.debug(`[API] Server running on port ${this.port}`);
        console.debug(`[API] Dev UI:    http://localhost:${this.port}/dev`);
        resolve(this.server);
      });
      this.server.once('error', (err) => {
        reject(err);
      });
    });
  }

  async stop() {
    if (this.server) {
      if (this.wss) this.wss.close();
      if (this.signalingWss) this.signalingWss.close();
      if (this._tcpServer) this._tcpServer.close();
      return new Promise((resolve) => {
        this.server.close(() => {
          console.debug('[API] Server stopped');
          resolve();
        });
      });
    }
  }
}

import { setBridgeContext } from './routes/legacy.js';
export { setBridgeContext };
export default APIServer;
