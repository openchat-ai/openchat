const fs = require('fs');
let c = fs.readFileSync('src/core/learning-core.js', 'utf8');

// Fix 1: add fileURLToPath import
if (!c.includes('fileURLToPath')) {
  c = c.replace("import { join } from 'path';", "import { join, dirname } from 'path';\nimport { fileURLToPath } from 'url';");
}

// Fix 2: age calculation
c = c.replace(
  "const result = execSync('git rev-list --count HEAD', { encoding: 'utf8', cwd: process.cwd() });",
  "let gitDir = dirname(fileURLToPath(import.meta.url));\n      while (gitDir !== dirname(gitDir)) { if (existsSync(join(gitDir, '.git'))) break; gitDir = dirname(gitDir); }\n      const result = execSync('git rev-list --count HEAD', { encoding: 'utf8', cwd: gitDir });"
);

// Fix 3: use solved flag instead of KB check
c = c.replace(
  'const unsolved = this.problemPool.filter(p => !this._isSolved(p));',
  'const unsolved = this.problemPool.filter(p => !p.solved);'
);

// Fix 4: add _lastWarningAdded to constructor
if (!c.includes('_lastWarningAdded')) {
  c = c.replace('this._initDirs();', 'this._lastWarningAdded = {};\n    this._initDirs();');
}

// Fix 5: add cooldown to _addWarningAsProblem
c = c.replace(
  '_addWarningAsProblem(issues) {\n    for (const issue of issues) {\n      // \u907f\u514d\u91cd\u590d\u6dfb\u52a0\n      const exists = this.problemPool.some(p => \n        p.id.startsWith(\'auto_\' + issue.type) && !this._isSolved(p)\n      );',
  '_addWarningAsProblem(issues) {\n    const now = Date.now();\n    for (const issue of issues) {\n      const lastAdded = this._lastWarningAdded[issue.type] || 0;\n      if (now - lastAdded < 5 * 60 * 1000) continue;\n      const exists = this.problemPool.some(p => p.id.startsWith(\'auto_\' + issue.type));'
);

// Fix 6: update lastWarningAdded when adding
c = c.replace(
  "this.problemPool.push(problem);\n          console.log(`[\u5143\u76d1\u63a7] \u5df2\u52a0\u5165\u95ee\u9898\u6c60: ${issue.type}`);",
  "this.problemPool.push(problem);\n          this._lastWarningAdded[issue.type] = now;\n          console.log(`[\u5143\u76d1\u63a7] \u5df2\u52a0\u5165\u95ee\u9898\u6c60: ${issue.type}`);"
);

// Fix 7: mark solved in _verifyAndStore
if (!c.includes('problem.solved = true')) {
  c = c.replace(
    '// \u8bb0\u5f55\u7ecf\u9a8c\n    this._recordSolved',
    'problem.solved = true;\n    // \u8bb0\u5f55\u7ecf\u9a8c\n    this._recordSolved'
  );
}

fs.writeFileSync('src/core/learning-core.js', c, 'utf8');
console.log('All fixes applied');
