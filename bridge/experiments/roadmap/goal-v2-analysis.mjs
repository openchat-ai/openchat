import { GoalManager } from '../../src/core/goal-manager.mjs';
import { writeFileSync } from 'fs';

const gm = new GoalManager();
const goal = gm.createGoal('roadmap-v2', 'system', '万金油开发平台 v2 — 深度补齐 + 多语言覆盖 + 原生集成');

// Depth assessment of v1
const depth = {
  'code-search': { status: 'baseline', next: 'AST-level search, semantic indexing' },
  'dep-graph': { status: 'thin', next: 'AST-aware dep graph, tree-shake analysis, bundle impact' },
  'visualize': { status: 'thin', next: 'Interactive dependency explorer, diff overlay' },
  'git': { status: 'thin', next: 'PR create/review, rebase assistant, merge conflict solver, blame annotation' },
  'test': { status: 'thin', next: 'Parallel runner, coverage merge, flaky detection, watch mode' },
  'lint': { status: 'thin', next: 'Multi-language (ruff/clippy/eslint), auto-fix chains, rule suggestion' },
  'build': { status: 'thin', next: 'Incremental cache, build graph, module federation analysis' },
  'ts-type': { status: 'thin', next: 'Type query, auto-type inference, refactor rename, codemod engine' },
  'lang-run': { status: 'wrapper', next: 'Per-language AST adapter API, package management, test framework' },
  'docker': { status: 'wrapper', next: 'Dockerfile optimization, multi-stage lint, compose generation' },
  'sql': { status: 'toy', next: 'ORM schema sync, migration generation, EXPLAIN analyzer, query rewrite' },
  'api': { status: 'toy', next: 'OpenAPI 3.1 parser, mock server with state, diff changelog' },
  'security': { status: 'toy', next: 'SAST engine, dependency graph audit, IaC scanning' },
  'perf': { status: 'toy', next: 'Flamegraph parser, memory leak detector, bundle analyzer' },
  'docs': { status: 'toy', next: 'API doc generation, changelog from git log, diagram-from-code' },
  'ci': { status: 'toy', next: 'Multi-platform CI gen, matrix optimization, cache key derivation' },
  'env': { status: 'toy', next: 'Migration script gen, secret rotation, multi-env diff' },
};

goal.steps = [];
const categories = [
  {
    phase: 'P0. 核心深度 (必须)',
    items: [
      { action: 'code-search 升级 AST 级 — 语义索引 + 跨文件 rename + 查找引用', expected: 'esprima/typescript AST 解析，symbol 索引 persist 到 EvolutionMemory' },
      { action: 'Git 深度集成 — PR review / rebase / merge conflict solver', expected: 'git_apply / git_merge / git_rebase 工具，冲突标记解析' },
      { action: '测试深度 — 并行运行 + coverage 聚合 + flaky 检测', expected: 'test_parallel / test_coverage / test_flaky_detect' },
      { action: '多语言 AST 适配器 (ts/py/rs/go) — 统一语法树接口', expected: '每个语言一个 ast-{lang}.mjs，统一 query/replace 接口' },
    ],
  },
  {
    phase: 'P0. 语言覆盖 (必须)',
    items: [
      { action: 'TypeScript 深度 — codemod 引擎 + type inference + refactor', expected: 'ts_codemod / ts_infer / ts_refactor 工具' },
      { action: 'Python 适配器 — pyright 封装 + pip 管理 + pytest 集成', expected: 'py_analyze / py_install / py_test 工具' },
      { action: 'Rust 适配器 — cargo 封装 + clippy 集成 + test 运行', expected: 'rs_build / rs_lint / rs_test 工具' },
      { action: 'Go 适配器 — go build/test/lint 封装 + 模块分析', expected: 'go_build / go_test / go_lint 工具' },
    ],
  },
  {
    phase: 'P1. 工程自动化 (重要)',
    items: [
      { action: 'Docker compose 生成 + 多阶段构建优化', expected: 'docker_compose / docker_optimize 工具' },
      { action: 'SQL Migration 生成 + EXPLAIN 分析 + ORM schema sync', expected: 'sql_migrate / sql_explain / sql_orm_sync 工具' },
      { action: 'OpenAPI 3.1 深度解析 + mock server + changelog diff', expected: 'openapi_parse / openapi_mock / openapi_diff 工具' },
      { action: 'SAST 扫描 + 依赖供应链审计 + IaC 安全检测', expected: 'sast_scan / audit_chain / iac_check 工具' },
    ],
  },
  {
    phase: 'P1. 质量体系 (重要)',
    items: [
      { action: '性能火焰图解析 + 内存泄漏检测 + Bundle 分析', expected: 'flamegraph_parse / mem_leak_detect / bundle_analyze 工具' },
      { action: '文档自动生成 — API doc / changelog / 架构图', expected: 'doc_api / doc_changelog / doc_diagram 工具' },
      { action: 'Lint 多语言统一接口 + auto-fix 链', expected: 'lint_all / lint_chain / lint_rule_suggest 工具' },
    ],
  },
  {
    phase: 'P2. 部署运维 (锦上添花)',
    items: [
      { action: 'CI 多平台矩阵生成 + 缓存 key 优化', expected: 'ci_matrix / ci_cache_key 工具' },
      { action: '环境迁移脚本生成 + secret 轮换 + 多环境 diff', expected: 'env_migrate / env_secret_rotate 工具' },
      { action: 'K8s manifest 分析 + Helm chart 生成', expected: 'k8s_analyze / helm_generate 工具' },
    ],
  },
];

let stepId = 18;
for (const cat of categories) {
  for (const item of cat.items) {
    goal.steps.push({ id: stepId++, action: item.action, expected: item.expected, status: 'pending', result: null, error: null });
  }
}

goal.updatedAt = Date.now();

// Output
console.log('===== v1 回顾 =====');
const thinCount = Object.values(depth).filter(d => d.status !== 'baseline').length;
console.log('v1 深度评价:', Object.entries(depth).map(([k, v]) => `${k}=${v.status}`).join(', '));
console.log('其中 thin/wrapper/toy: %d/15', thinCount);

console.log('\n===== v2 计划 =====');
const s = gm.getStatus(goal.id);
console.log(`Goal: ${goal.description}`);
console.log(`Status: ${goal.status}, Steps: ${s.total}`);
console.log('Phases:');
const count = [0, ...categories.map(c => { const n = c.items.length; console.log(`  ${c.phase}: ${n} steps`); return n; })];
console.log(`Total: ${s.total} steps`);

writeFileSync('experiments/roadmap/goal-v2-plan.json', JSON.stringify(goal, null, 2));
console.log('\n评: 当前 v1 15/15 工具存在但 11/15 处于 thin/wrapper/toy 状态。');
console.log('v2 需补 22 个深度步骤 + 4 个多语言适配器 = 约 26 实验。');
console.log('加已有 22 实验，完整平台约 48 实验。');
