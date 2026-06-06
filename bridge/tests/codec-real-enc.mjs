// A1.2: Pull real .enc from Qiniu and test skeleton-codec decode
// Usage: node tests/codec-real-enc.mjs
import SkeletonCodec from '../src/core/audio/lmdn-codec.mjs';
import { qiniuList, qiniuGet } from '../scripts/qiniu-s3.mjs';

const CHAT_PREFIX = 'oc/chat/';

async function main() {
  const codec = new SkeletonCodec();
  await codec.initialize();

  const keys = await qiniuList(CHAT_PREFIX);
  const encKeys = keys.filter(k => k.endsWith('.enc') && !k.includes('-reply'));
  console.log(`[A1.2] found ${encKeys.length} .enc files in ${CHAT_PREFIX}`);

  if (encKeys.length === 0) {
    console.log('[A1.2] no .enc files found, skipping real enc test');
    console.log('[A1.2] NOTE: need real phone upload to oc/chat/ first');
    return;
  }

  for (const key of encKeys.slice(0, 3)) {
    console.log(`[A1.2] testing ${key}`);
    const data = await qiniuGet(key);
    console.log(`[A1.2]   size=${data.length}B`);

    if (data[0] !== 0xBB || data[1] !== 0x01 || data[2] !== 0xCC) {
      console.log('[A1.2]   invalid EPC header, skip');
      continue;
    }

    try {
      const decoded = await codec.decode(Buffer.from(data));
      console.log(`[A1.2]   decoded pcm=${decoded.pcm.length}B score.len=${decoded.score.length}`);
      console.log(`[A1.2]   PASS: real .enc decode works`);
    } catch (err) {
      console.error(`[A1.2]   FAIL: ${err.message}`);
    }
  }
}

main().catch(console.error);
