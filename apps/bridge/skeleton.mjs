// Bridge side skeleton: WebSocket server on /ws (port 3800)
// Receives voice_msg → lmdn decode → agent → reply via chat_response
//
// Usage: node apps/bridge/skeleton.mjs
//   ⚠️ Must stop main Bridge first (it also binds port 3800)
//
// See docs/WALKING-SKELETON-SPEC.md for full data flow.

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { SkeletonCodec } from './skeleton-codec.mjs';
import { qiniuGet } from './skeleton-qiniu.mjs';
import { processText } from './skeleton-agent.mjs';

const PORT = parseInt(process.env.SKELETON_PORT || '3800', 10);
const WS_PATH = '/ws';

// === invariants ===
// - Shared codec instance (avoid re-init per request)
// - voice_msg.data.key must point to oc/chat/$chatId/$ts.enc
// - chat_response.data.sessionId must echo back so App routes to correct chat
// - No TTS, no reply.enc upload — reply is text via WS only

const codec = new SkeletonCodec();
await codec.initialize();
console.log('[skeleton] codec ready @ 24kHz');

async function handleVoiceMsg(ws, msg) {
  const { key, sessionId } = msg.data || {};
  if (!key) {
    console.error('[skeleton] voice_msg missing key');
    return;
  }
  console.log(`[C13] received voice_msg key=${key} session=${sessionId}`);

  const encData = await qiniuGet(key);
  if (!encData || encData.length === 0) {
    console.warn(`[C13] empty enc, skip ${key}`);
    return;
  }
  if (encData[0] !== 0xBB || encData[1] !== 0x01 || encData[2] !== 0xCC) {
    console.error(`[C13] invalid EPC header in ${key}`);
    return;
  }

  const decoded = await codec.decode(Buffer.from(encData));
  console.log(`[C13b] decoded pcm=${decoded.pcm.length}B score=${decoded.score.length}`);

  const text = '你好'; // v0: hard-code STT
  console.log(`[C13c] text=${text}`);

  const { response, toolCalls } = await processText(text);
  const reply = response || '(empty reply)';
  console.log(`[C13d] toolCalls=${toolCalls.length}`);
  console.log(`[C13e] reply="${reply.substring(0, 80)}"`);

  ws.send(JSON.stringify({
    type: 'chat_response',
    data: { content: reply, sessionId },
    sessionId,
  }));
  console.log('[C13e] sent chat_response');
}

async function handleTextChat(ws, msg) {
  const text = msg.data?.message || '';
  if (!text) return;
  console.log(`[skeleton] text chat: ${text}`);
  const { response } = await processText(text);
  ws.send(JSON.stringify({
    type: 'chat_response',
    data: { content: response || '(empty)', sessionId: msg.sessionId },
    sessionId: msg.sessionId,
  }));
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'skeleton', codec: 'lmdn-24k' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

wss.on('connection', (ws, req) => {
  console.log(`[skeleton] ws client connected from ${req.socket.remoteAddress}`);
  ws.send(JSON.stringify({
    type: 'bridge_handshake',
    data: { peerId: 'skeleton-bridge', service: 'skeleton' },
  }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) {
      console.error('[skeleton] invalid json:', e.message);
      return;
    }

    try {
      if (msg.type === 'voice_msg') await handleVoiceMsg(ws, msg);
      else if (msg.type === 'chat') await handleTextChat(ws, msg);
      else if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', data: {} }));
    } catch (err) {
      console.error(`[skeleton] handler error (${msg.type}):`, err.message);
      ws.send(JSON.stringify({
        type: 'chat_response',
        data: { content: `❌ Error: ${err.message}`, sessionId: msg.sessionId },
        sessionId: msg.sessionId,
      }));
    }
  });

  ws.on('close', () => console.log('[skeleton] ws client disconnected'));
  ws.on('error', (err) => console.error('[skeleton] ws error:', err.message));
});

httpServer.listen(PORT, () => {
  console.log(`[skeleton] WS server listening on :${PORT}${WS_PATH}`);
  console.log(`[skeleton] HTTP health at :${PORT}/health`);
  console.log('[skeleton] waiting for voice_msg...');
});
