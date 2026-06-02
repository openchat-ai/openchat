// A1.1 self-check: encode a 24kHz sine wave → decode → verify PCM length
import { SkeletonCodec } from './skeleton-codec.mjs';

const SR = 24000;
const N = 96;
const codec = new SkeletonCodec();
await codec.initialize();

const freq = 440;
const durationSec = 0.1;
const totalSamples = Math.floor(SR * durationSec);
const pcm = Buffer.alloc(totalSamples * 2);
for (let i = 0; i < totalSamples; i++) {
  const t = i / SR;
  const val = Math.sin(2 * Math.PI * freq * t) * 0.5;
  pcm.writeInt16LE(Math.round(val * 32767), i * 2);
}

const encoded = await codec.encode(pcm);
const decoded = await codec.decode(encoded.data);

const diff = Math.abs(decoded.pcm.length - pcm.length);
const limit = N * 2;
const pass = diff <= limit;

console.log(`[A1.1] input=${pcm.length}B encoded=${encoded.data.length}B decoded=${decoded.pcm.length}B diff=${diff}B limit=${limit}B`);
console.log(`[A1.1] frameCount=${encoded.frameCount} score.len=${decoded.score.length}`);
console.log(`[A1.1] ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
