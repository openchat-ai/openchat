/**
 * 清理多余的 .openchat-* 目录
 */
import { readdirSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const home = homedir();
const dirs = readdirSync(home);

let removed = 0;
for (const dir of dirs) {
  if (dir.startsWith('.openchat') && dir !== '.openchat') {
    const fullPath = join(home, dir);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        rmSync(fullPath, { recursive: true, force: true });
        console.log(`已删除: ${dir}`);
        removed++;
      }
    } catch (e) {
      console.log(`跳过: ${dir} (${e.message})`);
    }
  }
}

console.log(`\n清理完成，共删除 ${removed} 个目录`);