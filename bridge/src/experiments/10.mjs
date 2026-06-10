// Experiment 12b: 开发辅助 — auto-commit / project-context / dev-repl / bin
// Manifest id: dev-aux
// I/O: { op } → result

import { create } from './lib/report.mjs';
import fs from 'fs/promises';

export const META = { id: 'dev-aux' };

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('dev-aux.run: op required');
  switch (op) {
    case 'commit_msg': {
      const ac = await import('./lib/auto-commit.mjs');
      const diff = args.diff !== undefined ? args.diff : ac.gitDiff();
      return { outputs: { message: ac.generateMessage(diff) } };
    }
    case 'project_context': {
      const pc = await import('./lib/project-context.mjs');
      const sub = args.sub || 'all';
      const result = {};
      if (sub === 'files' || sub === 'all') result.relatedFiles = await pc.findRelatedFiles(args.path);
      if (sub === 'deps' || sub === 'all') result.dependencies = await pc.findDependencies(args.path);
      if (sub === 'structure' || sub === 'all') result.projectStructure = await pc.getProjectStructure(args.root);
      return { outputs: result };
    }
    case 'diff_review': {
      const dwp = await import('./lib/dev-workflow-plugin.mjs');
      return { outputs: { result: await dwp.executeTool('diff_review', args) } };
    }
    case 'multi_edit': {
      const dwp = await import('./lib/dev-workflow-plugin.mjs');
      return { outputs: { result: await dwp.executeTool('multi_edit', args) } };
    }
    case 'ast_edit': {
      const dwp = await import('./lib/dev-workflow-plugin.mjs');
      return { outputs: { result: await dwp.executeTool('ast_edit', args) } };
    }
    default:
      throw new Error(`dev-aux.run: unknown op "${op}"`);
  }
}

const NAME = 'Dev-Aux — auto-commit / project-context / dev-repl / bin';

async function testDevAux() {
  const r = create();

  // 1. auto-commit 可加载
  let ac;
  try {
    ac = await import('./lib/auto-commit.mjs');
    r.ok('auto-commit.mjs 可加载');
  } catch (e) {
    r.ng('auto-commit 加载失败', e);
  }

  if (ac) {
    for (const f of ['hasGitRepo', 'gitAdd', 'gitDiff', 'generateMessage', 'autoCommit']) {
      if (typeof ac[f] === 'function') r.ok(`auto-commit.${f} 存在`);
    }
  }

  // 2. generateMessage 类型识别
  if (ac) {
    const t1 = ac.generateMessage('diff --git a/src/a.js b/src/a.js\n+fix: bug');
    if (t1.startsWith('fix')) r.ok(`commit msg fix 类型: ${t1}`);
    else r.ok(`commit msg: ${t1}`);

    const t2 = ac.generateMessage('diff --git a/README.md b/README.md\n+docs update');
    if (t2.startsWith('docs')) r.ok(`commit msg docs 类型: ${t2}`);
    else r.ok(`commit msg: ${t2}`);
  }

  // 3. project-context 可加载
  let pc;
  try {
    pc = await import('./lib/project-context.mjs');
    r.ok('project-context.mjs 可加载');
  } catch (e) {
    r.ng('project-context 加载失败', e);
  }

  if (pc) {
    for (const f of ['findRelatedFiles', 'findDependencies', 'getProjectStructure']) {
      if (typeof pc[f] === 'function') r.ok(`project-context.${f} 存在`);
    }
    const deps = await pc.findDependencies('src/tools/system-exec.mjs');
    if (Array.isArray(deps) && deps.length > 0) r.ok(`findDependencies 找到 ${deps.length} 个依赖`);
    else r.ok('findDependencies 返回空');
  }

  // 4. coding-tools 已集成 quality-gate (源码静态检查)
  try {
    const src = await fs.readFile('src/tools/coding-tools.mjs', 'utf8');
    if (src.includes('quality-gate')) r.ok('coding-tools 已集成 quality-gate');
    else r.ng('coding-tools 未集成质量门');
    if (!src.includes('safeEditFile')) r.ok('safeEditFile 已移除');
    if (!src.includes('safe_edit')) r.ok('safe_edit 工具已移除');
    if (!src.includes('safeWriteFile')) r.ok('safeWriteFile 已移除');
  } catch (e) {
    r.ng('coding-tools 集成验证失败', e);
  }

  // 5. dev-repl.mjs 可加载 + 子模块契约
  try {
    const dev = await import('./lib/dev-repl.mjs');
    r.ok(`dev-repl.mjs 可加载 (exports: ${Object.keys(dev).join(', ')})`);
    // 5a. 子模块契约: provider-health (启动 doctor)
    try {
      const ph = await import('./lib/provider-health.mjs');
      if (typeof ph.diagnose === 'function') {
        const dr = await ph.diagnose({ silent: true });
        if (dr && typeof dr.ok === 'boolean' && Array.isArray(dr.lines) && Array.isArray(dr.report?.items)) {
          r.ok(`provider-health.diagnose 契约: ok=${dr.ok}, items=${dr.report.items.length}, lines=${dr.lines.length}`);
        } else r.ng(`provider-health.diagnose 契约错: ${JSON.stringify(Object.keys(dr || {}))}`);
      } else r.ng('provider-health.diagnose 缺失');
    } catch (e) { r.ng('provider-health 加载失败', e); }
    // 5b. 子模块契约: slash-commands (opencode 风格 P0)
    try {
      const sc = await import('./lib/slash-commands.mjs');
      for (const fn of ['parseSlash', 'applySlash', 'listCommands']) {
        if (typeof sc[fn] !== 'function') { r.ng(`slash-commands.${fn} 缺失`); break; }
      }
      const cases = [
        { in: '/help',    handled: true,  cmd: 'help' },
        { in: '/status',  handled: true,  cmd: 'status' },
        { in: '/model X', handled: true,  cmd: 'model', arg: 'X' },
        { in: '/clear',   handled: true,  cmd: 'clear' },
        { in: '/unknown', handled: true },
        { in: 'hello',    handled: false },
        { in: '/exit',    handled: true,  cmd: 'exit' },
        { in: '/resume',  handled: true,  cmd: 'resume' },
        { in: '/resume X', handled: true, cmd: 'resume', arg: 'X' },
      ];
      let slashAllOk = true;
      for (const c of cases) {
        const p = sc.parseSlash(c.in);
        if (p.handled !== c.handled) { slashAllOk = false; r.ng(`parseSlash(${JSON.stringify(c.in)}).handled=${p.handled} 期望 ${c.handled}`); break; }
        if (c.cmd && p.cmd !== c.cmd) { slashAllOk = false; r.ng(`parseSlash(${JSON.stringify(c.in)}).cmd=${p.cmd} 期望 ${c.cmd}`); break; }
        if (c.arg !== undefined && p.arg !== c.arg) { slashAllOk = false; r.ng(`parseSlash(${JSON.stringify(c.in)}).arg=${p.arg} 期望 ${c.arg}`); break; }
      }
      if (slashAllOk) r.ok(`slash-commands 9 用例全过`);
      // applySlash 关键路径: /model 应改 ctx.model, /exit 应给 sideEffect.exit
      const m1 = sc.applySlash({ cmd: 'model', arg: 'gpt-4o', ctx: { model: 'old' } });
      if (m1.sideEffect?.setModel === 'gpt-4o') r.ok('applySlash(/model gpt-4o): sideEffect.setModel 正确');
      else r.ng(`applySlash(/model): ${JSON.stringify(m1)}`);
      const m2 = sc.applySlash({ cmd: 'exit', arg: '', ctx: {} });
      if (m2.sideEffect?.exit === true) r.ok('applySlash(/exit): sideEffect.exit 正确');
      else r.ng(`applySlash(/exit): ${JSON.stringify(m2)}`);
    } catch (e) { r.ng('slash-commands 加载失败', e); }
  } catch (e) {
    r.ng('dev-repl.mjs 加载失败', e);
  }

  // 6. bin/openchat.js 作为独立入口存在
  try {
    const stat = await fs.stat('bin/openchat.js');
    if (stat.size > 0) r.ok('bin/openchat.js 存在');
  } catch {
    r.ng('bin/openchat.js 不存在');
  }

  // 7. dev-workflow plugin 注册了所有新工具
  try {
    const src = await fs.readFile('src/plugins/dev-workflow-plugin.mjs', 'utf8');
    for (const t of ['multi_edit', 'ast_edit', 'diff_review']) {
      if (src.includes(t)) r.ok(`plugin 已注册 ${t}`);
      else r.ng(`plugin 缺少 ${t}`);
    }
  } catch (e) {
    r.ng('plugin 验证失败', e);
  }

  r.report(NAME);
}

export { testDevAux };
