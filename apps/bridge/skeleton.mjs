// Bridge side skeleton: polls oc/chat/ for new .enc, processes, uploads reply
// Usage: node apps/bridge/skeleton.mjs
import { SkeletonCodec } from './skeleton-codec.mjs';
import { qiniuList, qiniuGet, qiniuPut } from './skeleton-qiniu.mjs';
import { tts } from './skeleton-tts.mjs';
import { processText } from './skeleton-agent.mjs';

const SEEN_KEYS = new Set();
const CHAT_PREFIX = 'oc/chat/';
const POLL_INTERVAL_MS = 2000;

async function processChatEnc(key) {
  console.log(`[C13] downloaded ${key}`);

  const encData = await qiniuGet(key);
  if (encData.length === 0) {
    console.warn('[C13] skip 0-byte enc');
    return;
  }

  if (encData[0] !== 0xBB || encData[1] !== 0x01 || encData[2] !== 0xCC) {
    console.error('[C13] invalid EPC header, skip');
    return;
  }

  const codec = new SkeletonCodec();
  await codec.initialize();

  const decoded = await codec.decode(Buffer.from(encData));
  console.log(`[C13b] decoded ${decoded.pcm.length} bytes, score.len=${decoded.score.length}`);

  const text = '你好';
  console.log(`[C13c] text=${text}`);

  const { response, toolCalls } = await processText(text);
  console.log(`[C13e] reply=${response.substring(0, 50)}`);

  const replyPcm = await tts(response);
  console.log(`[C13e] tts pcm=${replyPcm.length} bytes`);

  const encoded = await codec.encode(replyPcm);

  const ts = Date.now();
  const chatId = key.split('/')[2] || 'default';
  const replyKey = `oc/chat/${chatId}/${ts}-reply.enc`;

  await qiniuPut(replyKey, encoded.data);
  console.log(`[C13f] uploaded ${replyKey}`);
}

async function pollLoop() {
  console.log('[skeleton] starting poll loop...');

  while (true) {
    try {
      const keys = await qiniuList(CHAT_PREFIX);
      for (const key of keys) {
        if (SEEN_KEYS.has(key)) continue;
        if (key.includes('-reply')) continue;
        SEEN_KEYS.add(key);

        try {
          await processChatEnc(key);
        } catch (err) {
          console.error(`[skeleton] process error for ${key}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[skeleton] poll error:', err.message);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

pollLoop().catch(console.error);
