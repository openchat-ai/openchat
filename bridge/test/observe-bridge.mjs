/**
 * 端到端收敛测试 — 等居民突破 routine 模式，走完完整管线
 *
 * 调度器 5s/tick，routine 阈值=5，所以第6个tick居民会强制调LLM。
 * 跑 15 个 tick (75s)，观察完整过程。
 */

process.env.RESIDENT_TICK_INTERVAL_MS = '3000';

const PROBLEM = `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状(圆形和五角星形，不同的形状靠手感可以分辨)。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖?(同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求)

苹果味 桃子味 西瓜味
圆形        7      9      8
五角星形  7      6      4`;

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  端到端收敛测试 — 等待居民突破 routine 模式              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // ─── 加载模块 ───
  console.log('[1] 加载模块...');
  const { residentManager } = await import('../src/core/resident-manager.js');
  const { default: KnowledgeBase } = await import('../src/core/knowledge-base.js');
  const { default: ProblemDecomposer } = await import('../src/core/problem-decomposer.js');
  const { default: ConvergenceEngine } = await import('../src/core/convergence-engine.js');
  const { default: SolutionEngine } = await import('../src/core/solution-engine.js');
  const { default: SolutionOptimizer } = await import('../src/core/solution-optimizer.js');

  const kb = new KnowledgeBase();
  const decomposer = new ProblemDecomposer();
  const convergence = new ConvergenceEngine();
  const solver = new SolutionEngine();
  const optimizer = new SolutionOptimizer();
  console.log('  ✅ 6 模块加载完成');

  const { residentScheduler } = await import('../src/core/resident-scheduler.js');
  residentScheduler.setConvergenceSystem(kb, decomposer, convergence, solver, optimizer);
  console.log('  ✅ 收敛引擎已注入调度器');

  // ─── 创建居民 ───
  console.log('\n[2] 创建居民...');
  const r1 = residentManager.create('小明', { traits: { diligence: 0.3, curiosity: 0.8, creativity: 0.7, sociability: 0.4, courage: 0.5 } });
  const r2 = residentManager.create('小红', { traits: { diligence: 0.7, curiosity: 0.4, creativity: 0.3, sociability: 0.5, courage: 0.6 } });
  const r3 = residentManager.create('小华', { traits: { diligence: 0.5, curiosity: 0.4, creativity: 0.5, sociability: 0.8, courage: 0.4 } });
  const r4 = residentManager.create('小李', { traits: { diligence: 0.8, curiosity: 0.3, creativity: 0.3, sociability: 0.3, courage: 0.7 } });
  const r5 = residentManager.create('小张', { traits: { diligence: 0.6, curiosity: 0.6, creativity: 0.6, sociability: 0.6, courage: 0.6 } });
  console.log(`  ✅ 居民: ${[r1,r2,r3,r4,r5].map(r => r.name).join(', ')}`);

  // ─── 提交问题 ───
  console.log('\n[3] 提交问题...');
  residentScheduler.addProblem({
    problemId: `candy-${Date.now()}`,
    domain: 'general',
    question: PROBLEM,
    subQuestions: [],
    from: 'observer',
  });
  console.log('  ✅ 问题已入队');
  console.log('  ✅ 预期答案: 21');

  // ─── 启动调度器，跑 15 个 tick ───
  console.log('\n[4] 启动调度器 (3s/tick × 20 + 30s 等待 = 90s)...\n');
  residentScheduler.start();

  for (let t = 1; t <= 20; t++) {
    await new Promise(r => setTimeout(r, 5000));

    // 从 stdout 收集调度器相关日志
    const all = residentManager.list(null);
    const problems = residentScheduler._pendingProblems || [];

    // 问题状态
    for (const p of problems) {
      const subQ = p.subQuestions?.length || 0;
      console.log(`  [T${t}] 问题: ${p.status} | 子问题: ${subQ} | 居民: ${all.length}`);
    }

    // 居民最近活动（异常/错误类）
    for (const r of all) {
      const acts = (r.activities || []).slice(-1);
      for (const a of acts) {
        if (a.type === 'task_failed' || a.type === 'task_done') {
          console.log(`  [T${t}] ${r.name}: [${a.type}] ${a.message?.substring(0, 80)}`);
        }
      }
    }
  }

  residentScheduler.stop();

  console.log('\n[等待] 异步 agent 完成 (30s)...');
  await new Promise(r => setTimeout(r, 30000));

  // ─── 最终汇总 ───
  console.log('\n[5] 汇总报告\n');

  const problems = residentScheduler._pendingProblems || [];
  const all = residentManager.list(null);

  // 问题最终状态
  console.log('── 问题状态 ──');
  for (const p of problems) {
    console.log(`  problemId: ${p.problemId?.slice(0,12)}`);
    console.log(`  status: ${p.status}`);
    console.log(`  子问题: ${p.subQuestions?.length || 0}`);
    const solved = (p.subQuestions || []).filter(q => q.solved).length;
    console.log(`  已回答: ${solved}`);
    if (p.subQuestions && solved > 0) {
      console.log('  子问题答案:');
      for (const sq of p.subQuestions) {
        if (sq.solved) {
          console.log(`    ✅ Q: ${sq.question.substring(0, 40)}... → 答案: ${sq.answer} (${sq.solutions.length}人一致)`);
        } else {
          console.log(`    ❌ Q: ${sq.question.substring(0, 40)}... → 未解 (${sq.solutions.length}人回答)`);
        }
      }
    }
  }

  // 居民最终活动摘要
  console.log('\n── 居民活动摘要 ──');
  for (const r of all) {
    const recent = (r.activities || []).slice(-3);
    console.log(`  ${r.name}(id=${r.id}):`);
    for (const a of recent) {
      console.log(`    [${a.type}] ${a.message?.substring(0, 80)}`);
    }
  }

  // 角色分配记录
  const roles = residentScheduler._residentRoles;
  if (roles.size > 0) {
    console.log('\n── 角色分配 ──');
    for (const [id, role] of roles) {
      const r = residentManager.get(id);
      console.log(`  ${r?.name}(id=${id}) → ${role.role}`);
    }
  }

  // 知识库状态
  console.log('\n── 知识库 ──');
  const kbs = kb.stats();
  console.log(`  条目: ${kbs.total}, 领域: ${kbs.domains}, 存储: ${kbs.store}`);
  if (kbs.total > 0) {
    for (const [domain, count] of Object.entries(kbs.perDomain || {})) {
      console.log(`    ${domain}: ${count} 条`);
    }
    // 搜索知识库内容
    const searchResults = kb.search('general', '糖果');
    if (searchResults.length > 0) {
      console.log('  知识库内容:');
      for (const r of searchResults.slice(0, 5)) {
        console.log(`    [${r.verified ? '✓' : ' '}] "${r.question?.substring(0, 40)}..." = ${r.answer}`);
      }
    }
  }

  // 答案验证
  console.log('\n── 答案验证 ──');
  kb.add('candy', PROBLEM, 21, { verified: true, author: '测试', houseId: 'test' });
  const exact = kb.answer('candy', PROBLEM);
  console.log(`  精确查询: 答案=${exact?.answer}, 置信度=${exact?.confidence}`);
  console.log(`  预期: 21 → ${exact?.answer === 21 ? '✅' : '❌'}`);

  console.log(`\n  ✅ 观测完成 (${problems.length} 问题, ${all.length} 居民)`);
}

main().catch(e => {
  console.error('\n❌ 异常:', e.message);
  process.exit(1);
});
