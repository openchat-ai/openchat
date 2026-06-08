import { readFile } from 'fs/promises';
const d = JSON.parse(await readFile('./src/experiments/39-real-coding-task/live-3sample.json', 'utf8'));
for (let i = 0; i < d.runs.length; i++) {
  const r = d.runs[i];
  console.log('=== run ' + (i+1) + ' ===');
  if (r._error) console.log('  err:', r._error);
  if (r._debug?.source) {
    console.log('  source:');
    console.log('  ' + r._debug.source);
  }
  console.log('  allWrittenLength:', r._debug?.allWrittenLength);
  console.log('  packetsCount:', r._debug?.packetsCount);
  console.log('  sbErr:', r._debug?.sandboxError);
}
