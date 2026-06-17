import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { addGoal } from '../goal-queue.mjs';
import { addFinding } from '../findings.mjs';
import { SRC_DIR, EXP_DIR, MANIFEST_FILE, scanDir, relPath } from '../scout-shared.mjs';

export function scanLLMVision() {
  const files = scanDir(SRC_DIR);
  let hasExpress = false, hasWs = false;
  const syncFsFiles = [], largeFiles = [];

  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf8');
      const rel = relPath(f);
      if (rel.startsWith('src/experiments/') || rel.startsWith('src/lab/')) continue;

      if (/\bexpress\(\)/.test(content)) hasExpress = true;
      if (/from\s+['"]ws['"]/.test(content)) hasWs = true;

      const syncCalls = content.match(/\b(read|write|exists|stat|unlink|mkdir)FileSync\b/g);
      if (syncCalls && syncCalls.length >= 2) syncFsFiles.push(`${rel}(${syncCalls.length})`);

      const lines = content.split('\n').length;
      if (lines > 300) largeFiles.push(`${rel}(${lines}L)`);
    } catch {}
  }

  let count = 0;
  if (hasExpress) { addFinding('bridge', 'llmVision', 'Express.js detected, Fastify is 5x faster'); addGoal('evaluate switching from express to fastify (5.0x)', { priority: 1 }); count++; }
  if (hasWs) { addFinding('bridge', 'llmVision', 'ws detected, @sockudo/ws is 3x faster with SIMD'); addGoal('evaluate switching from ws to @sockudo/ws (3.0x)', { priority: 1 }); count++; }
  if (syncFsFiles.length >= 3) { addFinding('bridge', 'llmVision', `${syncFsFiles.length} files with sync FS: ${syncFsFiles.slice(0,5).join(', ')}`); addGoal('evaluate sync FS refactor: async conversion for event loop', { priority: 2 }); count++; }
  if (largeFiles.length >= 3) { addFinding('bridge', 'llmVision', `${largeFiles.length} files > 300 lines: ${largeFiles.slice(0,3).join(', ')}`); addGoal('evaluate large file splitting: maintainability refactor', { priority: 3 }); count++; }

  return count;
}
