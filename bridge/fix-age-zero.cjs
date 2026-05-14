const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/core/learning-core.js');
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Use __dirname to find git root
const oldLoadStats = `_loadStats() {
    const expFiles = existsSync(EXPERIENCE_DIR) ? readdirSync(EXPERIENCE_DIR).filter(f => f.endsWith('.json')) : [];
    this.solvedCount = expFiles.length;
    this.iq = 100 + this.solvedCount * 2;
    
    // 年龄 = git commits 数量
    try {
      const result = execSync('git rev-list --count HEAD', { encoding: 'utf8', cwd: process.cwd() });
      this.age = parseInt(result.trim(), 10) || 0;
    } catch {
      this.age = 0;
    }
  }`;

const newLoadStats = `_loadStats() {
    const expFiles = existsSync(EXPERIENCE_DIR) ? readdirSync(EXPERIENCE_DIR).filter(f => f.endsWith('.json')) : [];
    this.solvedCount = expFiles.length;
    this.iq = 100 + this.solvedCount * 2;
    
    // 年龄 = git commits 数量
    try {
      // 从当前文件目录向上查找 git 根目录
      let gitDir = path.dirname(fileURLToPath(import.meta.url));
      while (gitDir !== path.dirname(gitDir)) {
        if (existsSync(path.join(gitDir, '.git'))) break;
        gitDir = path.dirname(gitDir);
      }
      const result = execSync('git rev-list --count HEAD', { encoding: 'utf8', cwd: gitDir });
      this.age = parseInt(result.trim(), 10) || 0;
    } catch {
      this.age = 0;
    }
  }`;

if (content.includes(oldLoadStats)) {
  content = content.replace(oldLoadStats, newLoadStats);
  console.log('✅ Fixed _loadStats to use git root directory');
} else {
  console.log('⚠️ Could not find _loadStats pattern');
}

// Fix 2: Add fileURLToPath import
if (!content.includes('fileURLToPath')) {
  content = content.replace(
    "import { homedir } from 'os';",
    "import { homedir } from 'os';\nimport { fileURLToPath } from 'url';"
  );
  console.log('✅ Added fileURLToPath import');
}

fs.writeFileSync(filePath, content);
console.log('Done!');
