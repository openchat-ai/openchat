import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const f = join(homedir(), '.openchat/lab/queue.jsonl');
const lines = readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
  .map(l => l.startsWith('"') ? JSON.parse(l) : JSON.parse(l));

let kept = [], removed = 0;
for (const g of lines) {
  if (g.status !== 'pending') { kept.push(g); continue; }
  const d = g.description;
  // 3 原则: 更快 / 更省 / 更高收益
  if (d.startsWith('register:')) { kept.push(g); continue; }
  if (d.startsWith('write test() for')) { kept.push(g); continue; }
  if (d.startsWith('add schema')) { kept.push(g); continue; }
  // 删: 重复/已修/太杂
  if (d.startsWith('add try/catch at')) { removed++; continue; }
  if (d.startsWith('adopt:')) { removed++; continue; }
  if (d.startsWith('deps-parity:')) { removed++; continue; }
  if (d.startsWith('fix syntax')) { removed++; continue; }
  if (d.startsWith('remove leftover')) { removed++; continue; }
  if (d.startsWith('remove unused')) { removed++; continue; }
  if (d.startsWith('cleanup')) { removed++; continue; }
  kept.push(g);
}
writeFileSync(f, kept.map(g => JSON.stringify(g)).join('\n') + '\n', 'utf8');
console.log(`removed ${removed} noise, kept ${kept.length}`);
