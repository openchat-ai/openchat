const fs = require('fs');
const content = fs.readFileSync('F:/openchat/bridge/src/core/learning-core.js', 'utf8');

const oldCode = `  _loadStats() {
    const expFiles = existsSync(EXPERIENCE_DIR) ? readdirSync(EXPERIENCE_DIR).filter(f => f.endsWith('.json')) : [];
    this.solvedCount = expFiles.length;
    this.iq = 100 + this.solvedCount * 2;
    
    const bridgeCfg = persistentConfig.getBridgeConfig();
    this.age = bridgeCfg.age || 0;
  }`;

const newCode = `  _loadStats() {
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

const newContent = content.replace(oldCode, newCode);
fs.writeFileSync('F:/openchat/bridge/src/core/learning-core.js', newContent);
console.log('Updated _loadStats to use git commits for age');
