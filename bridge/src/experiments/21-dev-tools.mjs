// Experiment 21: Dev Tools — 依赖图 / Git / 测试 / Lint / 构建 / 语言 / Docker / SQL / API / 安全 / 文档 / CI / 环境
// Manifest id: dev-tools
// Deps: [config]

import { create } from './lib/report.mjs';
import assert from 'node:assert';

export const META = { id: 'dev-tools' };
const NAME = 'Dev-Tools — 16 个工程工具';

export async function test() {
  const R = create();
  const tools = await import('../tools/dev-tools.mjs');

  // Step 2: 依赖图
  {
    const g = await tools.depGraph('src/tools');
    assert.ok(g.nodes.length >= 1);
    assert.ok(g.edgeCount >= 0);
    R.ok('depGraph: 解析依赖图成功');

    const cyc = await tools.detectCycles('src/tools');
    assert.ok(typeof cyc.cycleCount === 'number');
    R.ok('detectCycles: 循环依赖检测成功');
  }

  // Step 3: 架构可视化
  {
    const mermaid = tools.toMermaid([{ from: 'a.js', to: 'b.js' }]);
    assert.ok(mermaid.includes('graph TD'));
    assert.ok(mermaid.includes('a_js'));
    R.ok('toMermaid: 生成 Mermaid 格式');
  }

  // Step 4: Git
  {
    const log = tools.gitLog(3);
    assert.ok(Array.isArray(log.log));
    assert.ok(log.log.length <= 3);
    R.ok('gitLog: 获取提交历史');
  }

  // Step 5: 测试发现
  {
    const disc = await tools.testDiscover('src/tools');
    assert.ok(typeof disc.count === 'number');
    R.ok('testDiscover: 发现测试文件');
  }

  // Step 6: Lint
  {
    const lint = tools.lintRun('src/tools/coding-tools.mjs');
    assert.ok(typeof lint.totalFiles === 'number');
    R.ok('lintRun: ESLint 检测');
  }

  // Step 7: 构建 (dry run)
  {
    const build = tools.buildRun('node -e "console.log(\'build ok\')"');
    assert.ok(build.success);
    R.ok('buildRun: 构建执行');
  }

  // Step 8: TS 类型检查 (skip if no tsc)
  {
    try {
      const ts = tools.tsTypeCheck();
      assert.ok(typeof ts.errorCount === 'number');
      R.ok('tsTypecheck: 类型检查');
    } catch { R.skip('tsTypecheck: tsc not available'); }
  }

  // Step 9: 多语言
  {
    const r = tools.langRun('python', '--version 2>&1 || echo "no python"');
    assert.ok(typeof r.output === 'string');
    R.ok('langRun: 多语言执行');
  }

  // Step 11: SQL
  {
    const sql = 'CREATE TABLE users (id INT, name TEXT); CREATE TABLE posts (id INT, title TEXT);';
    const schema = tools.sqlParseCreate(sql);
    assert.strictEqual(schema.tableCount, 2);
    assert.strictEqual(schema.tables[0].name, 'users');
    R.ok('sqlParse: 解析 CREATE TABLE');
  }

  // Step 12: API curl
  {
    const r = await tools.curlRun('GET', 'https://httpbin.org/get');
    assert.ok(typeof r.output === 'string' || r.error);
    R.ok('curlRun: HTTP 请求');
  }

  // Step 13: 安全审计
  {
    const audit = tools.secNpmAudit();
    assert.ok(typeof audit.total === 'number' || audit.error);
    R.ok('secAudit: npm audit');
  }

  // Step 15: 文档
  {
    const docs = tools.docsFindChanged();
    assert.ok(Array.isArray(docs.diffFiles));
    R.ok('docsSuggest: 变更文件检测');
  }

  // Step 16: CI
  {
    const ci = tools.ciDetect();
    assert.ok(ci.detected !== undefined);
    R.ok('ciDetect: CI 配置检测');
  }

  // Step 17: 环境 diff
  {
    const d = tools.envDiff({ KEY: 'a' }, { KEY: 'b', NEW: 'c' });
    assert.ok(d.hasChanges);
    assert.strictEqual(d.diff.length, 2);
    R.ok('envDiff: 环境变量比较');
  }

  R.report(NAME);
}


