const { execSync } = require('child_process');
const patterns = [
  'bridge/src/core/research-*.cjs',
  'bridge/src/core/research-*.json',
  'bridge/src/core/analysis-*.cjs',
  'bridge/src/core/auto_age_stuck*.cjs',
  'bridge/src/core/*.backup*',
];
let n = 0;
for (const p of patterns) {
  try {
    const out = execSync('git ls-files --cached ' + p, { encoding: 'utf8' });
    const files = out.trim().split('\n').filter(Boolean);
    for (const f of files) {
      execSync('git rm --cached --quiet "' + f + '"', { stdio: 'ignore' });
      n++;
    }
  } catch (e) {}
}
console.log('Removed ' + n + ' junk files');
