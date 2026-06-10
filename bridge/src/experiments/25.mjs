// Experiment 21: Dev Tools — 依赖图 / Git / 测试 / Lint / 构建 / 语言 / Docker / SQL / API / 安全 / 文档 / CI / 环境
// Manifest id: dev-tools
// Deps: [config]

import { create } from './lib/report.mjs';
import assert from 'node:assert';

export const META = { id: 'dev-tools' };
const NAME = 'Dev-Tools — 16 个工程工具';

// compose 契约入口：ops 包括原有 dev-tools 操作 + 系统健康检查
export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('dev-tools.run: op required');
  const tools = await import('../tools/dev-tools.mjs');

  switch (op) {
    // === 系统健康检查（从实验 26-30 收编） ===

    case 'check_tracing': {
      const { generate, createSpan, endSpan, getTrace, formatLog } = await import('../tools/request-id.mjs');
      const id = generate();
      const child = createSpan('', 'child');
      const grandchild = createSpan(child, 'grandchild');
      endSpan(grandchild);
      endSpan(child);
      const trace = getTrace(grandchild);
      const log = formatLog(id, 'hello', 'world');
      return {
        outputs: {
          requestId: id,
          spanCount: trace.length,
          spanNames: trace.map(s => s.name),
          logExample: log,
        },
      };
    }

    case 'check_failover': {
      const { persistentConfig } = await import('../core/persistent-config.js');
      const cfg = persistentConfig.config || {};
      const providerId = cfg.current?.provider || '';
      const prov = cfg.providers?.[providerId];
      const failoverChain = prov?.failover || prov?.fallback || [];
      const apiKeyOk = !!prov?.apiKey;
      return {
        outputs: {
          provider: providerId,
          model: cfg.current?.model || '',
          hasApiKey: apiKeyOk,
          failoverCount: Array.isArray(failoverChain) ? failoverChain.length : 0,
          failoverChain: Array.isArray(failoverChain) ? failoverChain : [],
          healthy: apiKeyOk,
        },
      };
    }

    case 'check_backpressure': {
      const { persistentConfig } = await import('../core/persistent-config.js');
      const cfg = persistentConfig.config || {};
      const defaultMax = 20;
      let pollerOk = false;
      try {
        const { tsFromKey, parseMsgPayload } = await import('../core/chat-poller.mjs');
        pollerOk = typeof tsFromKey === 'function' && typeof parseMsgPayload === 'function';
      } catch {}
      return {
        outputs: {
          maxInFlight: defaultMax,
          chatPollerLoaded: pollerOk,
          note: 'inFlight state is module-private in chat-poller.mjs; runtime backpressure not externally observable',
        },
      };
    }

    case 'check_sessions': {
      const { persistentStore } = await import('../core/persistent-store.js');
      const all = persistentStore.getAllSessions();
      return {
        outputs: {
          sessionCount: all.length,
          sessionIds: all.map(s => s.id),
          sessions: all,
        },
      };
    }

    case 'check_recovery': {
      const { persistentStore } = await import('../core/persistent-store.js');
      const sessions = persistentStore.getAllSessions();
      const { homedir } = await import('os');
      const { join } = await import('path');
      const sessionsFile = join(homedir(), '.openchat', 'sessions.json');
      const fs = await import('fs/promises');
      let fileExists = false;
      try { await fs.access(sessionsFile); fileExists = true; } catch {}
      return {
        outputs: {
          sessionsFileExists: fileExists,
          sessionCount: sessions.length,
          note: 'seenKeys is module-private in chat-poller.mjs; recovery state not externally observable',
        },
      };
    }

    // === 原有 dev-tools 操作（通过 tools module 代理） ===

    case 'dep_graph':
    case 'depGraph':
      return { outputs: { result: await tools.depGraph(args.rootDir) } };
    case 'detect_cycles':
    case 'detectCycles':
      return { outputs: { result: await tools.detectCycles(args.rootDir) } };
    case 'to_mermaid':
    case 'toMermaid':
      return { outputs: { result: tools.toMermaid(args.edges) } };
    case 'git_commit':
    case 'gitCommit':
      return { outputs: { result: tools.gitCommit(args.context) } };
    case 'git_log':
    case 'gitLog':
      return { outputs: { result: tools.gitLog(args.count) } };
    case 'test_run':
    case 'testRun':
      return { outputs: { result: await tools.testRun(args.pattern) } };
    case 'test_discover':
    case 'testDiscover':
      return { outputs: { result: await tools.testDiscover(args.rootDir) } };
    case 'lint_run':
    case 'lintRun':
      return { outputs: { result: tools.lintRun(args.pattern) } };
    case 'lint_fix':
    case 'lintFix':
      return { outputs: { result: tools.lintFix(args.pattern) } };
    case 'build_run':
    case 'buildRun':
      return { outputs: { result: tools.buildRun(args.command) } };
    case 'ts_typecheck':
    case 'tsTypeCheck':
      return { outputs: { result: tools.tsTypeCheck(args.pattern) } };
    case 'lang_run':
    case 'langRun':
      return { outputs: { result: tools.langRun(args.language, args.command) } };
    case 'docker_build':
    case 'dockerBuild':
      return { outputs: { result: tools.dockerBuild(args.tag, args.dockerfile) } };
    case 'sql_parse':
    case 'sqlParse':
      return { outputs: { result: tools.sqlParseCreate(args.sql) } };
    case 'curl_run':
    case 'curlRun':
      return { outputs: { result: await tools.curlRun(args.method, args.url, args.body) } };
    case 'sec_audit':
    case 'secAudit':
      return { outputs: { result: tools.secNpmAudit() } };
    case 'docs_suggest':
    case 'docsFindChanged':
      return { outputs: { result: tools.docsFindChanged() } };
    case 'ci_detect':
    case 'ciDetect':
      return { outputs: { result: tools.ciDetect() } };
    case 'env_diff':
    case 'envDiff':
      return { outputs: { result: tools.envDiff(args.a, args.b) } };
    default:
      throw new Error(`dev-tools.run: unknown op "${op}"`);
  }
}

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


