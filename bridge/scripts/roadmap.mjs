import { GoalManager } from '../src/core/goal-manager.mjs';
import { writeFileSync } from 'fs';

const gm = new GoalManager();
const goal = gm.createGoal('roadmap', 'system', '万金油开发平台：覆盖任何语言/框架/场景的辅助能力');

// 手动分解（模拟 LLM decompose，保存为 goal-manager 可 Load 的格式）
goal.steps = [
  // === Phase 1: 代码理解（P0） ===
  {
    id: 1, action: '语义搜索 — AST grep + 跨文件引用追踪',
    expected: 'read_file/hashEdit 增强 AST 搜索，支持跨文件 symbol 导航',
    status: 'pending', result: null, error: null,
  },
  {
    id: 2, action: '依赖图分析 — import/require 树 + 循环依赖检测',
    expected: '分析项目入口，生成依赖图 JSON，标识循环依赖',
    status: 'pending', result: null, error: null,
  },
  {
    id: 3, action: '架构可视化 — 模块关系 → Mermaid/Graphviz',
    expected: '依赖图输出可渲染的 Mermaid 或 DOT 格式',
    status: 'pending', result: null, error: null,
  },
  // === Phase 2: 工程自动化（P0） ===
  {
    id: 4, action: 'Git 工作流 — commit/PR/rebase + 自动 commit message',
    expected: 'coding-tools 增加 git_commit 工具，基于 diff 生成 message',
    status: 'pending', result: null, error: null,
  },
  {
    id: 5, action: '测试调度 — 发现测试 → 运行 → 解析 → bisect',
    expected: 'test_runner 工具：自动发现、执行、解析 TAP/jUnit、二分定位失败',
    status: 'pending', result: null, error: null,
  },
  {
    id: 6, action: 'Lint 集成 — 自动检测 → 修复 → 规则自定义',
    expected: 'lint 工具：eslint/ruff/clippy 等 wrapper，修复建议',
    status: 'pending', result: null, error: null,
  },
  {
    id: 7, action: '构建管道 — 编译 → 打包 → 缓存 → 增量 build',
    expected: 'build 工具：缓存上次结果，增量执行，失败回退',
    status: 'pending', result: null, error: null,
  },
  // === Phase 3: 语言覆盖（P1） ===
  {
    id: 8, action: 'JS/TS 深度支持 — 类型分析、refactor、codemod',
    expected: 'TS AST 操作（rename/replace_body）、类型查询',
    status: 'pending', result: null, error: null,
  },
  {
    id: 9, action: 'Rust/Python/Go 适配器 — 语法树 + 包管理 + 构建',
    expected: 'pyright/rust-analyzer/gopls 封装，cargo/pip/go build',
    status: 'pending', result: null, error: null,
  },
  {
    id: 10, action: 'Docker/K8s 操作 — Dockerfile + compose + kubectl',
    expected: 'docker 工具：Dockerfile 生成、compose 编排、kubectl apply',
    status: 'pending', result: null, error: null,
  },
  {
    id: 11, action: 'SQL 工具 — schema 分析、migration 生成、查询优化',
    expected: 'sql_schema 工具：ER 图、migration 模板、EXPLAIN 解析',
    status: 'pending', result: null, error: null,
  },
  {
    id: 12, action: 'API 调试 — OpenAPI 解析、mock server、curl 封装',
    expected: 'api 工具：从 OpenAPI 生成 mock、命令行 curl 助手',
    status: 'pending', result: null, error: null,
  },
  // === Phase 4: 质量体系（P1） ===
  {
    id: 13, action: '安全审计 — 依赖漏洞扫描、secret 检测、SAST',
    expected: 'security 工具：npm audit/trivy/gitleaks wrapper',
    status: 'pending', result: null, error: null,
  },
  {
    id: 14, action: '性能分析 — profiling 数据解析、瓶颈定位',
    expected: 'perf 工具：解析 clinic/flamegraph、定位热点函数',
    status: 'pending', result: null, error: null,
  },
  {
    id: 15, action: '文档自动同步 — 代码变更触发 doc/README 更新提案',
    expected: 'docsync 工具：diff → 影响文档列表 → 更新提案',
    status: 'pending', result: null, error: null,
  },
  // === Phase 5: 部署运维（P2） ===
  {
    id: 16, action: 'CI 配置生成 — GitHub Actions / GitLab CI / 本地 runner',
    expected: 'ci 工具：分析项目生成 workflow 模板',
    status: 'pending', result: null, error: null,
  },
  {
    id: 17, action: '环境管理 — dev/staging/prod 变量、迁移、回滚',
    expected: 'env 工具：环境变量 diff、迁移脚本、回滚开关',
    status: 'pending', result: null, error: null,
  },
];

goal.updatedAt = Date.now();

// Output
const s = gm.getStatus(goal.id);
const active = goal.steps.filter(s => s.status === 'pending').length;
console.log(`Goal: ${goal.description}`);
console.log(`Status: ${goal.status} (${s.done}/${s.total} steps done, ${active} pending)`);
console.log('\nPhases:');
const phases = [
  { label: 'P0. 代码理解', ids: [1,2,3] },
  { label: 'P0. 工程自动化', ids: [4,5,6,7] },
  { label: 'P1. 语言覆盖', ids: [8,9,10,11,12] },
  { label: 'P1. 质量体系', ids: [13,14,15] },
  { label: 'P2. 部署运维', ids: [16,17] },
];
for (const ph of phases) {
  const steps = ph.ids.map(id => goal.steps.find(s => s.id === id));
  const done = steps.filter(s => s.status === 'done').length;
  console.log(`  ${ph.label}: ${done}/${steps.length}`);
}

// Save as JSON for future GoalManager.load
writeFileSync('experiments/roadmap/goal-roadmap.json', JSON.stringify(goal, null, 2));
console.log('\nSaved to experiments/roadmap/goal-roadmap.json');
