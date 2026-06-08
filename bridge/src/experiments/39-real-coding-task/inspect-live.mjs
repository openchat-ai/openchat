// driver: 跑 runLive + 写 live artifact (不修改 index.mjs)
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { runLive } from './index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const live = await runLive({ repeats: 3 });
const out = resolve(__dirname, 'live-3sample.json');
await writeFile(out, JSON.stringify(live, null, 2));
console.log('saved:', out);
console.log('aggregate:', JSON.stringify(live.aggregate));
for (let i = 0; i < live.runs.length; i++) {
  const s = live.runs[i];
  console.log(`\n=== run ${i+1} ===`);
  console.log('  ext=', s.sourceExtracted, 'shape=', s.functionShapeOk);
  console.log('  rcArgs=', s.renderConnectArgsOk, 'rsArgs=', s.renderSubscribeArgsOk);
  console.log('  sandbox=', s.sandboxRan, 'pkts=', s.packetsSentCorrect);
  console.log('  err=', s._debug?.sandboxError || s._error || 'none');
  if (s._debug?.source) {
    console.log('  --- source (head) ---');
    console.log(s._debug.source.slice(0, 400));
    console.log('  ...');
  } else {
    console.log('  --- (no source) ---');
  }
}
