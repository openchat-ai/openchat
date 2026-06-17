import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { addGoal } from '../goal-queue.mjs';
import { addFinding } from '../findings.mjs';
import { PROJECT_ROOT, scanDir, relPath, isProcessed } from '../scout-shared.mjs';

export function scanSelf() {
  let count = 0;
  const labDirs = ['src/lab', 'src/lab/scouts'];
  const files = [];

  for (const d of labDirs) {
    const dir = join(PROJECT_ROOT, d);
    if (existsSync(dir)) files.push(...scanDir(dir));
  }

  for (const f of files) {
    try {
      const c = readFileSync(f, 'utf8');
      const rel = relPath(f);
      const lines = c.split('\n').length;

      // 1. Files > 100 lines missing invariants block
      if (lines > 100 && !c.includes('// === invariants ===')) {
        const key = `invariants:${rel}`;
        if (!isProcessed(key)) {
          addFinding('bridge', 'self', `${rel}: ${lines}L, 缺 invariants 块`);
          addGoal(`[lab-health] add invariants block to ${rel}`, { priority: 2 });
          count++;
        }
      }

      // 2. Files > 300 lines need splitting (skip — needs human)
      if (lines > 300) {
        addFinding('bridge', 'self', `${rel}: ${lines} 行, 建议手动拆分`);
      }

      // 3. Empty catch blocks (> 3 in a file = pattern, skip — needs human)
      const emptyCatches = c.match(/}\s*catch\s*\{\s*}/g);
      if (emptyCatches && emptyCatches.length > 3) {
        addFinding('bridge', 'self', `${rel}: ${emptyCatches.length} 个空 catch, 建议手动审查`);
      }

      // 4. Hardcoded path patterns (drive letters or absolute unix)
      const hardcoded = c.match(/['"][A-Z]:[\\/]/g);
      if (hardcoded) {
        const key = `extractPaths:${rel}`;
        if (!isProcessed(key)) {
          addFinding('bridge', 'self', `${rel}: ${hardcoded.length} 个硬编码路径`);
          addGoal(`[lab-health] extract hardcoded paths in ${rel}`, { priority: 1 });
          count++;
        }
      }

      // 5. Sync FS in lab code (just flag, no goal)
      const syncCalls = c.match(/\b(read|write|exists|stat|unlink|mkdir)FileSync\b/g);
      if (syncCalls && syncCalls.length > 5) {
        addFinding('bridge', 'self', `${rel}: ${syncCalls.length} 个同步 FS 调用`);
      }
    } catch {}
  }

  return count;
}
