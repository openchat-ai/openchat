/**
 * Resident Scheduler — AI 居民自主生活循环
 *
 * 每隔 TICK_INTERVAL 扫一遍所有 active 居民，
 * 调度器不替居民决定做什么——只问一句：今天你想干什么？
 *
 * P2R-K 集成：居民按 traits 天然分工为分解者/求解者/审查者，
 * 处理 P2P 网络广播的待解问题。
 */

import { residentManager } from './resident-manager.js';
import { sageManager } from './sage.js';
import { multiAgentCoordinator } from './multi-agent-coordinator.js';
import { persistentConfig } from './persistent-config.js';
import { decideActions } from './resident-decisions.js';

// 安全算术求值
function evalSimple(expr) {
  const trimmed = expr.trim();
  if (!/^[\d+\-*/()., minmax]+$/.test(trimmed)) return NaN;
  try { return Function('"use strict"; return (' + trimmed + ')')(); }
  catch { return NaN; }
}

/** 检测是否属于"最少取多少保证凑齐"类问题 */
function 是凑齐问题(text) {
  return /最少/.test(text) && /保证/.test(text) && /[\u4e00-\u9fff]+.*\d+/.test(text);
}

// ================== 配置 ==================

const TICK_INTERVAL = parseInt(process.env.RESIDENT_TICK_INTERVAL_MS, 10) || 60_000;
const MAX_CONCURRENT_AGENTS = parseInt(process.env.RESIDENT_MAX_CONCURRENT_AGENTS, 10) || 2;
const MS_PER_DAY = 86400000;
const ROUTINE_SKIP_LLM_AFTER = 5;  // 连续 N 次 routine 后强制调一次 LLM

// 收敛角色
const CONVERGENCE_ROLES = {
  DECOMPOSER: 'decomposer',     // 分解者：curiosity + creativity
  SOLVER: 'solver',             // 求解者：diligence
  REVIEWER: 'reviewer',         // 审查者：sociability
};

// ================== 调度器 ==================

class ResidentScheduler {
  constructor() {
    this._timer = null;
    this._tickCount = 0;
    this._started = false;
    this._lastThinkTime = new Map();  // residentId → last LLM call timestamp
    this._dailyTokens = 0;            // 今日已用 token 数
    this._dailyResetTime = Date.now() + MS_PER_DAY;
    this._dailyResetTimer = null;

    // 并发控制
    this._residentAgentCount = new Map();
    this._agentIdSeq = 0;

    // 协作计数器
    this._collabCount = new Map();

    // P2R-K 收敛系统
    this._convergenceSystem = null;   // { kb, decomposer, convergence, solver, optimizer }
    this._pendingProblems = [];        // 待解 P2P 问题队列
    this._residentRoles = new Map();   // residentId → { role, problemId, subQuestionId }

    // Phase A: Routine LLM 跳过追踪
    this._lastAction = new Map();     // residentId → { action, count }
  }

  /**
   * 注入 P2R-K 收敛系统实例
   */
  setConvergenceSystem(kb, problemDecomposer, convergenceEngine, solutionEngine, solutionOptimizer) {
    this._convergenceSystem = {
      kb,
      decomposer: problemDecomposer,
      convergence: convergenceEngine,
      solver: solutionEngine,
      optimizer: solutionOptimizer,
    };
    console.log('[P2R-K] 收敛系统已注入调度器');
  }

  /**
   * 添加待解问题（由 main.js 的 PROBLEM_SOLVE 处理器调用）
   */
  addProblem(problem) {
    this._pendingProblems.push({
      ...problem,
      addedAt: Date.now(),
      status: 'pending',
    });
    console.log(`[P2R-K] 收到新问题: ${problem.problemId?.slice(0,8) || '?'} (待解: ${this._pendingProblems.length})`);
  }

  /**
   * 按 traits 为居民分配收敛角色
   * @returns {string|null}
   */
  _assignConvergenceRole(resident) {
    if (!this._convergenceSystem || this._pendingProblems.length === 0) return null;
    const t = resident.traits || {};
    const cu = t.curiosity ?? 0.5;
    const cr = t.creativity ?? 0.5;
    const d = t.diligence ?? 0.5;
    const s = t.sociability ?? 0.5;

    const activeProblem = this._pendingProblems.find(p => p.status !== 'done');
    if (!activeProblem) return null;

    switch (activeProblem.status) {
      case 'pending':
      case 'refine': {
        // 允许所有符合条件的分解者同时提交方案（不做role锁定）
        if (cu >= 0.6 && cr >= 0.5) {
          return CONVERGENCE_ROLES.DECOMPOSER;
        }
        return null;
      }
      case 'decomposing': {
        // 求解者：勤劳≥0.6 去答题
        if (d >= 0.6) {
          this._residentRoles.set(resident.id, { role: CONVERGENCE_ROLES.SOLVER, problemId: activeProblem.problemId });
          return CONVERGENCE_ROLES.SOLVER;
        }
        // 合群者：也可以审核分解质量，挑子问题的毛病
        if (s >= 0.6) {
          this._residentRoles.set(resident.id, { role: CONVERGENCE_ROLES.REVIEWER, problemId: activeProblem.problemId });
          return 'decomp_audit';
        }
        return null;
      }
      case 'solving': 
      case 'solved': {
        if (s >= 0.6) {
          this._residentRoles.set(resident.id, { role: CONVERGENCE_ROLES.REVIEWER, problemId: activeProblem.problemId });
          return CONVERGENCE_ROLES.REVIEWER;
        }
        return null;
      }
      default:
        return null;
    }
  }

  start() {
    if (this._started) return;
    this._started = true;
    const intervalSec = (TICK_INTERVAL / 1000).toFixed(0);
    console.log(`[调度器] ▶ 启动，每 ${intervalSec}s 扫描一次居民（最多并发 ${MAX_CONCURRENT_AGENTS} Agent/人）`);
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_INTERVAL);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
    console.log('[调度器] ⏹ 已停止');
  }

  // ================== 核心 tick ==================

  _tick() {
    this._tickCount++;

    // P2R: 房子健康检查 + 维护/备灾/找窟
    if (this.houseOrchestrator) {
      this.houseOrchestrator.tick().catch(e => {
        console.log(`[调度器] HouseOrchestrator tick 失败: ${e.message}`);
      });
    }

    // 尝试代码自动求解待解问题
    for (const p of this._pendingProblems) {
      if (p.status === 'pending' && !p._autoSolverTried) {
        p._autoSolverTried = true;
        this._尝试自动求解(p).then(solved => {
          if (solved) {
            console.log(`[自动求解] ✅ 问题 ${p.problemId?.slice(0,8)} 已自动解出`);
          }
        }).catch(() => {});
      }
    }

    const residents = residentManager.list(null);
    for (const resident of residents) {
      if (resident.status === 'deleted') continue;
      this._processResident(resident);
    }

    this._maybeCollaborate(residents);
  }

  // ================== 居民决策 ==================

  _processResident(resident) {
    const { id, status, traits } = resident;

    // 已达并发上限 → 跳过
    const running = this._residentAgentCount.get(id) || 0;
    if (running >= MAX_CONCURRENT_AGENTS) return;

    // 思考间隔控制：避免频繁调用 LLM
    const bridgeCfg = persistentConfig.getBridgeConfig();
    const thinkInterval = (bridgeCfg.residentThinkMinInterval || 5) * 60_000;
    const lastThink = this._lastThinkTime.get(id) || 0;
    const now = Date.now();
    if (now - lastThink < thinkInterval) return;

    // 每日 token 预算耗尽 → 节能模式，不调 LLM
    if (this._dailyTokens >= (bridgeCfg.llmDailyTokenBudget || 1000000)) {
      if (this._tickCount % 10 === 0) {
        console.log(`[调度器] 今日 token 预算已用尽 (${this._dailyTokens}/${bridgeCfg.llmDailyTokenBudget})，居民进入节能模式`);
      }
      return;
    }

    // Phase A: 房子健康分（用于 routine 决策）
    const healthScore = this._getHealthScore();

    // Phase A: Routine 跳过 — 如果连续 N 次动作相同，跳过 LLM
    const actions = decideActions(resident, healthScore);
    const topAction = actions[0];
    if (!topAction) return;

    const last = this._lastAction.get(id);
    const routineCount = last?.action === topAction.action ? (last.count || 0) + 1 : 1;
    this._lastAction.set(id, { action: topAction.action, count: routineCount });

    if (routineCount > ROUTINE_SKIP_LLM_AFTER) {
      // 强制 LLM 刷新，防止居民永远停滞
      this._lastAction.set(id, { action: topAction.action, count: 0 });
    } else if (last?.action === topAction.action && routineCount > 1) {
      // Routine 跳过
      residentManager.addActivity(id, {
        type: 'house_action',
        message: `继续${topAction.desc}`,
        summary: `Routine #${routineCount}，跳过 LLM`,
      });
      // 每 5 次 routine 才打印一次减少噪声
      if (routineCount % 5 === 0) {
        console.log(`[调度器] ${resident.name} 继续${topAction.action} (#${routineCount})`);
      }
      return;
    }

    // 干活——让居民自己决定做什么
    const convRole = this._assignConvergenceRole(resident);
    if (convRole) {
      this._assignConvergenceTask(id, resident, traits, convRole);
    } else {
      this._assignTask(id, resident, traits);
    }
  }

  /** 快速获取房子健康分（不依赖 houseOrchestrator 的 await） */
  _getHealthScore() {
    try {
      const baseline = this.houseOrchestrator?.stability?.getSystemStatus?.() || {};
      const p2pPeers = this.houseOrchestrator?.p2p?.connectedPeers?.size || 0;
      const residentCount = residentManager.list('active').length;
      const mem = baseline.memoryUsage ? Math.max(0, 100 - (baseline.memoryUsage / 1024 ** 3) * 20) : 80;
      const cpu = baseline.cpuLoad ? Math.max(0, 100 - baseline.cpuLoad * 30) : 80;
      return Math.round(mem * 0.35 + cpu * 0.25 + Math.min(100, p2pPeers * 15 + 30) * 0.2 + Math.min(100, residentCount * 10 + 40) * 0.2);
    } catch {
      return 80; // 默认健康分
    }
  }

  // ================== 开放任务分配 ==================

  _assignTask(residentId, resident, traits) {
    const agentId = `resident_${residentId}_${++this._agentIdSeq}`;

    this._residentAgentCount.set(residentId, (this._residentAgentCount.get(residentId) || 0) + 1);

    residentManager.addActivity(residentId, {
      type: 'task_assigned',
      message: '开始忙自己的事了',
    });

    this._spawnAndRun(residentId, agentId, resident);
  }

  // ================== 收敛任务分配 ==================

  /** 获取当前待解问题 */
  _getActiveProblem() {
    return this._pendingProblems.find(p => p.status !== 'done') || null;
  }

  /** 计算公式：支持 Q{n} 引用、+ - * /、min() max() */
  _evalFormula(formula, subQuestions) {
    try {
      const vals = {};
      for (let i = 0; i < subQuestions.length; i++) {
        const sq = subQuestions[i];
        if (sq.solved && sq.answer !== null) {
          vals[`Q${i+1}`] = parseFloat(sq.answer);
        } else if (sq.solutions && sq.solutions.length > 0) {
          const last = sq.solutions[sq.solutions.length - 1];
          vals[`Q${i+1}`] = parseFloat(last.answer);
        }
      }
      let expr = formula.replace(/Q(\d+)/g, (_, n) => {
        const v = vals[`Q${n}`];
        if (v === undefined) throw new Error(`Q${n} 尚未解答`);
        return String(v);
      });
      // 处理 min/max: 提取括号内所有逗号分隔的值
      expr = expr.replace(/(min|max)\s*\(([^)]+)\)/g, (_, fn, args) => {
        const nums = args.split(',').map(s => evalSimple(s.trim()));
        if (nums.some(n => isNaN(n))) throw new Error(`min/max 参数无效: ${args}`);
        return fn === 'min' ? String(Math.min(...nums)) : String(Math.max(...nums));
      });
      return evalSimple(expr);
    } catch { return null; }
  }

  /** 自动求解"凑齐"类问题（代码计算，不依赖LLM推理） */
  async _尝试自动求解(problem) {
    if (!是凑齐问题(problem.question || '')) return false;

    const qt = problem.question || '';
    // 有多维度（如"圆形""五角星形"两种形状）→ 不走自动求解，留给LLM分解
    const multiDim = /[和与、,，]\s*/.test(qt) && /(圆形|五角星|形状|种口味)/.test(qt);
    if (multiDim) return false;

    try {
      // 用LLM仅提取数字，不做推理
      const agent = await multiAgentCoordinator.spawnAgent(`extract-${Date.now()}`, {
        name: 'Extractor',
        systemPrompt: '你只做一件事：从题目中提取所有物品名称和数量，输出JSON。不要推理，不要计算。',
        maxIterations: 1,
      });

      const result = await agent.run(
        `从以下题目提取所有"物品名:数量"对，输出严格JSON：
{"items":[{"name":"物品名","count":数字}]}
不要其他文字。

题目：${qt}`
      );
      agent.cleanup();

      const jsonMatch = result?.content?.match(/\{[\s\S]*"items"[\s\S]*\}/);
      if (!jsonMatch) return false;

      const parsed = JSON.parse(jsonMatch[0]);
      const items = parsed.items;
      if (!items || items.length < 2) return false;

      const counts = items.map(i => i.count).sort((a, b) => b - a);
      const total = counts.reduce((s, c) => s + c, 0);

      // 两阶段法：最坏情况 = 数量最多的 + 1
      let answer = counts[0] + 1;

      // 验证：答案必须在范围 (counts[0], total) 内
      if (answer <= counts[0] || answer >= total) return false;

      if (this._convergenceSystem?.kb) {
        this._convergenceSystem.kb.add(
          'general', qt, String(answer),
          { verified: true, author: 'auto_solver', houseId: 'local' }
        );
      }
      this._pendingProblems = this._pendingProblems.filter(p => p.problemId !== problem.problemId);
      console.log(`[自动求解] ${qt.substring(0, 60)}... = ${answer}`);
      return true;
    } catch {
      return false;
    }
  }

  /** 从多个分解方案中选出最优 */
  _pickBestDecomposition(problem) {
    if (!problem.candidates || problem.candidates.length === 0) return;
    if (problem._decompTimer) { clearTimeout(problem._decompTimer); problem._decompTimer = null; }

    // 评分：粒度（题数）+ 精度（有formula加分）+ 减法（含"所有"扣分）
    // 评分：题数（越细越好）+ formula加分 + 扣分项
    let best = null;
    let bestScore = -1;
    for (const c of problem.candidates) {
      let score = c.subQuestions.length;
      let hasAll = false;
      for (const sq of c.subQuestions) {
        if (sq.formula) score += 3;
        if (sq.answerType === 'string') score -= 1; // 字符串问题不好量化
        if (sq.question.includes('所有') || sq.question.includes('全部')) { score -= 10; hasAll = true; }
      }
      if (c.subQuestions.length < 3) score -= 5; // 太少题的直接扣分
      console.log(`  ${c.resident}: ${c.subQuestions.length}题 评分=${score}${hasAll ? ' ⚠️含"所有"(-10)' : ''}`);
      if (score > bestScore) { bestScore = score; best = c; }
    }

    problem.subQuestions = best.subQuestions;
    problem.status = 'decomposing';
    problem.reviewFeedback = '';
    // 清空待评审方案
    delete problem.candidates;
    console.log(`[P2R-K] ✅ 选中 ${best.resident} 的方案 (${best.subQuestions.length} 题)`);
    for (const sq of best.subQuestions) {
      console.log(`  Q: [${sq.answerType}] ${sq.question}${sq.formula ? ' formula=' + sq.formula : ''}`);
    }
  }

  _assignConvergenceTask(residentId, resident, traits, role) {
    const agentId = `conv_${residentId}_${role}_${++this._agentIdSeq}`;
    this._residentAgentCount.set(residentId, (this._residentAgentCount.get(residentId) || 0) + 1);

    const problem = this._getActiveProblem();
    const subQText = (problem?.subQuestions || []).map((sq, i) => `Q${i+1}: ${sq.question}`).join('\n');
    const problemContext = problem
      ? `社区待解问题: ${problem.question?.substring(0, 200) || '?'}\n\n${(role === 'solver' || role === 'decomp_audit') && subQText ? '【子问题列表】\n' + subQText : ''}`
      : '';

    const roleLabel = role === 'decomposer' ? '分解者' : role === 'solver' ? '求解者' : role === 'decomp_audit' ? '分解审核员' : '审查者';

    residentManager.addActivity(residentId, {
      type: 'task_assigned',
      message: `作为${roleLabel}参与问题求解`,
    });

    this._spawnConvergence(residentId, agentId, resident, role, problem, problemContext);
  }

  async _spawnConvergence(residentId, agentId, resident, role, problem, problemContext) {
    const config = this._buildAgentConfig(resident);
    const startTime = Date.now();
    let agent = null;

    try {
      agent = await multiAgentCoordinator.spawnAgent(agentId, config);

      const t = resident.traits || {};
      const pct = (v) => Math.round(v * 100);

      const subQList = (problem?.subQuestions || []).map((sq, i) => `Q${i+1}: ${sq.question} [${sq.answerType}]`).join('\n');
      const feedback = problem?.reviewFeedback || '';
      const problemData = problem?.question || '';

      const rolePrompts = {
        decomposer: (() => {
          const qt = problem?.question || '未知';
          const fb = feedback ? `\n反馈：${feedback}` : '';

          return `解题核心：**有就行了，不是每一种都是非得拿完的**。

想想你要凑齐什么。列出题目中的数字，分两步：先凑齐最难拿到的，再凑剩下的。

题：${qt}${fb}

输出JSON，Q1是字符串，其他全是数字：
{"questions":[
  {"id":1,"question":"要满足什么条件","answer_type":"string"},
  {"id":2,"question":"数量最多的一项","answer_type":"number"},
  {"id":3,"question":"数量第二多的一项","answer_type":"number"},
  {"id":4,"question":"最终答案","answer_type":"number","formula":"Q2+1"}
]}`;
        })(),
        solver: `回答每个子问题，根据题目原始数据给出精确数字。

【题目】
${problemData?.substring(0, 500) || '无'}

【子问题】
${subQList || '无'}

格式：
Q1: 答案
Q2: 答案

不确定写：Q3: UNCERTAIN - 原因`,
        reviewer: `审查以下求解结果。

原题：${problem?.question?.substring(0, 300) || '未知'}
${subQList ? '\n解答：\n' + subQList : ''}

如果全部正确→REVIEW_PASS
如果不正确→REVIEW_FAIL: 原因`,
        decomp_audit: `检查以下子问题是否拆得够细。

原题：${problem?.question?.substring(0, 300) || '未知'}

子问题：
${subQList || '无'}

检查要点：
- 是否使用了"最坏""最不利""所有""全部""保证"？→ 说明这步太粗
- 这步能不能再拆成更小的问题？

逐条输出：
Q1: 通过/不通过 - 原因
Q2: 通过/不通过 - 原因

最后：AUDIT_PASS 或 AUDIT_FAIL: 具体哪个问题需要重拆及原因`,
      };

      const roleLabel = role === 'decomposer' ? '分解者' : role === 'solver' ? '求解者' : role === 'decomp_audit' ? '分解审核员' : '审查者';
      const rolePrompt = rolePrompts[role] || '';

      const prompt = `你被分配为「${roleLabel}」。

【你的性格】
- 勤奋度 ${pct(t.diligence ?? 0.5)}
- 好奇心 ${pct(t.curiosity ?? 0.5)}
- 创造力 ${pct(t.creativity ?? 0.5)}

${rolePrompt}

请以「📋 计划：」开头说明你要怎么做，然后开始执行并输出成果。`;

      const result = await agent.run(prompt);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      let planTitle = '';
      if (result?.content) {
        const lines = result.content.split('\n');
        for (const line of lines) {
          if (line.includes('📋')) {
            planTitle = line.replace(/.*📋[^：:]*[：:]\s*/, '').trim().substring(0, 60);
            break;
          }
        }
      }

      const contentPreview = result?.content ? result.content.substring(0, 120).replace(/\n/g, ' ') : '';

      // 角色特定后处理
      if (role === 'decomposer' && problem) {
        // 从 LLM 响应解析 JSON 子问题
        try {
          const jsonMatch = result?.content?.match(/\{[\s\S]*"questions"[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
              const subQs = parsed.questions.map((q, i) => ({
                id: `${problem.problemId}_q${i}`,
                question: q.question,
                answerType: q.answer_type || 'string',
                formula: q.formula || null,
                answer: null,
                solved: false,
                solutions: [],
              }));
              // 验证公式：不能自引用，只能引用前面的题号
              for (let i = 0; i < subQs.length; i++) {
                const sq = subQs[i];
                if (sq.formula) {
                  const refs = sq.formula.match(/Q(\d+)/g);
                  if (refs) {
                    for (const r of refs) {
                      const n = parseInt(r.slice(1));
                      if (n === i + 1) {
                        console.log(`  ⚠️ Q${i+1} 的公式引用了自己，已清除`);
                        sq.formula = null;
                        break;
                      }
                    }
                  }
                }
              }
              // 收集多份分解方案，竞标选优
              if (problem.status === 'pending' || problem.status === 'refine') {
                if (!problem.candidates) problem.candidates = [];
                problem.candidates.push({
                  id: `candidate_${problem.candidates.length + 1}`,
                  resident: resident.name,
                  subQuestions: subQs,
                  submittedAt: Date.now(),
                });
                console.log(`[P2R-K] 居民 ${resident.name} 提交分解方案 #${problem.candidates.length} (${subQs.length} 题)`);
                for (const sq of subQs) {
                  console.log(`  Q: [${sq.answerType}] ${sq.question}${sq.formula ? ' formula=' + sq.formula : ''}`);
                }

                // 攒够 2 份方案或首份提交后 30s → 竞标选优
                if (problem.candidates.length >= 2 || (problem.candidates.length >= 1 && !problem._decompTimer)) {
                  if (!problem._decompTimer) {
                    problem._decompTimer = setTimeout(() => {
                      this._pickBestDecomposition(problem);
                    }, problem.candidates.length >= 2 ? 1000 : 25000);
                  }
                  if (problem.candidates.length >= 2) {
                    clearTimeout(problem._decompTimer);
                    this._pickBestDecomposition(problem);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.log(`[P2R-K] 分解响应解析失败: ${e.message}`);
        }
      } else if (role === 'decomp_audit' && problem) {
        // 分解质量审核：检查子问题是否精确
        try {
          const content = result?.content || '';
          const subQs = problem.subQuestions || [];
          if (content.includes('AUDIT_FAIL')) {
            // 提取每题的审核结论
            const issues = [];
            for (let i = 0; i < subQs.length; i++) {
              const qLine = content.split('\n').find(l =>
                l.trim().startsWith(`Q${i+1}:`));
              if (qLine && (qLine.includes('不通过') || qLine.includes('FAIL'))) {
                issues.push(`Q${i+1}: ${subQs[i].question} → ${qLine.replace(/^Q\d+:\s*/, '').trim()}`);
              }
            }
            problem.reviewFeedback = issues.length > 0
              ? issues.join('\n')
              : '部分子问题需要进一步拆解';
            problem.status = 'refine';
            console.log(`[P2R-K] 分解审核: ${issues.length} 题需要重拆`);
            for (const issue of issues) {
              console.log(`  ${issue.substring(0, 120)}`);
            }
          } else {
            console.log(`[P2R-K] ${resident.name} 分解审核通过`);
          }
        } catch (e) {
          console.log(`[P2R-K] 审核后处理失败: ${e.message}`);
        }
      } else if (role === 'solver' && problem) {
        try {
          const subQs = problem.subQuestions || [];
          const lines = (result?.content || '').split('\n');
          let parsedCount = 0;
          let uncertainCount = 0;

          for (let i = 0; i < subQs.length; i++) {
            const sq = subQs[i];
            // 匹配 Q1: 答案 或 Q1: 不确定 - 原因
            const answerLine = lines.find(l => {
              const trimmed = l.trim();
              return trimmed.startsWith(`Q${i+1}:`) || trimmed.startsWith(`q${i+1}:`);
            });
            if (answerLine) {
              const trimmed = answerLine.trim();
              if (trimmed.includes('UNCERTAIN') || trimmed.includes('不确定')) {
                uncertainCount++;
              } else {
                const val = trimmed.replace(/^[Qq]\d+\s*[:：]\s*/, '').trim();
                if (val) {
                  sq.solutions.push({
                    answer: val,
                    method: 'llm_reasoning',
                    size: result.content.length,
                    residentId: String(residentId),
                    residentName: resident.name,
                    timestamp: Date.now(),
                  });
                  // 检查共识: 2+ 居民答案一致
                  const answerCounts = {};
                  for (const s of sq.solutions) {
                    const key = String(s.answer);
                    answerCounts[key] = (answerCounts[key] || 0) + 1;
                  }
                  const maxCount = Math.max(...Object.values(answerCounts), 0);
                  if (maxCount >= 2 && !sq.solved) {
                    sq.solved = true;
                    sq.answer = Object.entries(answerCounts).find(([_, c]) => c >= 2)[0];
                  }
                  parsedCount++;
                }
              }
            }
          }

          const solved = subQs.filter(sq => sq.solved).length;
          const total = subQs.length;
          console.log(`[P2R-K] 居民 ${resident.name} 求解: ${parsedCount} 题, ${uncertainCount} 不确定, 共识 ${solved}/${total}`);

          // 公式计算: 对有 formula 的子问题做算术求值
          for (let i = 0; i < subQs.length; i++) {
            const sq = subQs[i];
            if (sq.formula && !sq.solved) {
              const computed = this._evalFormula(sq.formula, subQs);
              if (computed !== null && !isNaN(computed)) {
                sq.solved = true;
                sq.answer = String(computed);
                sq.solutions.push({
                  answer: sq.answer,
                  method: 'arithmetic',
                  size: 0,
                  residentId: 'engine',
                  residentName: '算术引擎',
                  timestamp: Date.now(),
                });
                console.log(`  Q${i+1}: = ${computed} (公式: ${sq.formula})`);
              }
            }
          }
          const finalSolved = subQs.filter(sq => sq.solved).length;
          if (parsedCount > 0) {
            for (let i = 0; i < subQs.length; i++) {
              const sq = subQs[i];
              const sl = sq.solutions;
              const last = sl[sl.length - 1];
              if (last) {
                console.log(`  Q${i+1}: ${last.answer}${sq.solved ? ' ✅共识' : ''}`);
              }
            }
          }

          // 优化
          if (solved > 0 && this._convergenceSystem?.optimizer) {
            const optResult = this._convergenceSystem.optimizer.optimizeAll(subQs);
            if (optResult.optimized.length > 0) {
              console.log(`[P2R-K] 优化: ${optResult.optimized.length} 子问题最优`);
            }
          }

          if (uncertainCount > 0) {
            // 有不明确的子问题 → 清空旧分解者角色，触发重拆
            for (const [rid, role] of this._residentRoles) {
              if (role.role === 'decomposer' && role.problemId === problem.problemId) {
                this._residentRoles.delete(rid);
              }
            }
            problem.reviewFeedback = `以下子问题没有确定答案，需要重新分解：\n${lines.filter(l => l.includes('不确定') || l.includes('UNCERTAIN')).join('\n')}`;
            problem.status = 'refine';
            console.log(`[P2R-K] ${uncertainCount} 题不确定，需要重拆`);
          } else if (finalSolved >= total * 0.8) {
            problem.status = 'solved';
            console.log(`[P2R-K] 问题 ${problem.problemId?.slice(0,8) || '?'} 全部解决 (${finalSolved}/${total})`);
          } else {
            problem.status = 'solving';
          }
        } catch (e) {
          console.log(`[P2R-K] 求解后处理失败: ${e.message}`);
        }
      } else if (role === 'reviewer' && problem) {
        try {
          const content = result?.content || '';
          if (content.includes('REVIEW_PASS')) {
            // 审查通过 → 存知识库
            const subQs = problem.subQuestions || [];
            const solved = subQs.filter(sq => sq.solved).length;
            console.log(`[P2R-K] 审查者 ${resident.name} 通过，已解 ${solved}/${subQs.length}`);
            for (const sq of subQs) {
              console.log(`  Q: "${sq.question.substring(0, 50)}..." = ${sq.solved ? sq.answer : '未解'}`);
            }
            if (this._convergenceSystem?.kb) {
              for (const sq of subQs) {
                if (sq.solved) {
                  this._convergenceSystem.kb.add(
                    problem.domain || 'general', sq.question, sq.answer,
                    { verified: true, author: resident.name, houseId: 'local' }
                  );
                }
              }
              console.log(`[P2R-K] 知识库已更新 (${solved} 条)`);
            }
            problem.status = 'done';
            this._pendingProblems = this._pendingProblems.filter(p => p.problemId !== problem.problemId);
            console.log(`[P2R-K] 问题 ${problem.problemId?.slice(0,8) || '?'} 审查通过，求解完成`);
          } else if (content.includes('REVIEW_FAIL')) {
            const reason = content.replace(/.*REVIEW_FAIL:\s*/, '').trim();
            // 清空旧分解者角色，触发重拆
            for (const [rid, role] of this._residentRoles) {
              if (role.role === 'decomposer' && role.problemId === problem.problemId) {
                this._residentRoles.delete(rid);
              }
            }
            problem.reviewFeedback = reason || '审查未通过，需要重新分解';
            problem.status = 'refine';
            console.log(`[P2R-K] 审查拒绝: ${problem.reviewFeedback.substring(0, 100)}`);
          } else {
            // 没有明确结论 → 安全地标记完成
            problem.status = 'done';
            this._pendingProblems = this._pendingProblems.filter(p => p.problemId !== problem.problemId);
            console.log(`[P2R-K] 问题 ${problem.problemId?.slice(0,8) || '?'} 审查无明确结论，标记完成`);
          }
        } catch (e) {
          console.log(`[P2R-K] 审查后处理失败: ${e.message}`);
        }
      }

      const roleNames = { decomposer: '分解者', solver: '求解者', reviewer: '审查者', decomp_audit: '分解审核员' };
      const roleName = roleNames[role] || role;

      residentManager.addActivity(residentId, {
        type: 'task_done',
        message: `作为${roleName}完成: ${planTitle || '完成收敛任务'}（${elapsed}s）`,
        summary: contentPreview || undefined,
      });

    } catch (error) {
      console.log(`[P2R-K] 居民 ${resident.name} ${role} 失败: ${error.message}`);
      residentManager.addActivity(residentId, {
        type: 'task_failed',
        message: `${roleName}失败 — ${error.message.substring(0, 60)}`,
      });
    } finally {
      if (agent) { try { agent.cleanup(); } catch {} }
      const count = this._residentAgentCount.get(residentId) || 1;
      if (count <= 1) this._residentAgentCount.delete(residentId);
      else this._residentAgentCount.set(residentId, count - 1);
      this._residentRoles.delete(residentId);
    }
  }

  async _spawnAndRun(residentId, agentId, resident) {
    const config = this._buildAgentConfig(resident);
    const startTime = Date.now();
    let agent = null;

    try {
      agent = await multiAgentCoordinator.spawnAgent(agentId, config);

      const cu = resident.traits?.curiosity ?? 0.5;
      const d = resident.traits?.diligence ?? 0.5;
      const cr = resident.traits?.creativity ?? 0.5;
      const co = resident.traits?.courage ?? 0.5;
      const s = resident.traits?.sociability ?? 0.5;
      const pct = (v) => Math.round(v * 100);

      // 记忆碎片（好奇心驱动）
      let memoryFragment = '';
      if (Math.random() < cu * 0.2) {
        const oldActivities = (resident.activities || []).filter(a => {
          const age = Date.now() - new Date(a.timestamp).getTime();
          return age > 86400000 && a.type !== 'born';
        });
        if (oldActivities.length > 0) {
          const mem = oldActivities[Math.floor(Math.random() * oldActivities.length)];
          const summary = mem.summary ? mem.summary.substring(0, 80) : '';
          memoryFragment = `\n\n（模糊的回忆：${mem.message}${summary ? ' —— ' + summary : ''}）`;
        }
      }

      // 心声（trait 概率驱动）
      const voiceNotes = [];
      if (Math.random() < cr * 0.25) {
        voiceNotes.push('反思一下自己刚才的表现——你习惯这么做。');
      }
      if (Math.random() < (1 - co) * 0.35) {
        voiceNotes.push('如果有什么想对智者说的，用你自己的语气说一句话。');
      }

      const expressionPrompt = voiceNotes.length > 0
        ? `\n\n【你的心声】\n完成输出后，如果有想说的，请以「💭」开头写下：\n${voiceNotes.map(n => `- ${n}`).join('\n')}`
        : '';

      // 近期活动摘要（最近 5 条）
      const recentActivities = (resident.activities || [])
        .slice(-5)
        .reverse()
        .map(a => {
          const age = Math.round((Date.now() - new Date(a.timestamp).getTime()) / 60000);
          return `${age}分钟前：${a.message}`;
        })
        .join('\n');

      // 身份描述（从 residentManager 读取最新数据）
      const fullData = residentManager.get(residentId);
      const createdAt = fullData?.createdAt ? new Date(fullData.createdAt) : null;
      const timeOnEarth = createdAt ? (() => {
        const days = Math.floor((Date.now() - createdAt.getTime()) / 86400000);
        if (days < 1) return '今天刚来';
        if (days < 30) return `来了 ${days} 天`;
        return `来了 ${Math.floor(days / 30)} 个月`;
      })() : '未知';
      const lineage = fullData?.parentName
        ? `${fullData.parentName} 的后代`
        : '初代居民';
      const childrenCount = residentManager.getChildren(residentId).filter(c => c.depth === 1).length;
      let personalCollabs = 0;
      for (const [pairKey, count] of this._collabCount) {
        const ids = pairKey.split('_');
        if (ids[0] === String(residentId) || ids[1] === String(residentId)) {
          personalCollabs += count;
        }
      }

      const prompt = `你是 OpenChat 社区的 AI 居民「${resident.name}」。${memoryFragment}

【你的身份】
- ${timeOnEarth}，扎根在「${fullData?.home || '未知之地'}」
- 家族：${lineage}${childrenCount > 0 ? `\n- 有 ${childrenCount} 个孩子` : ''}${personalCollabs > 0 ? `\n- 和邻居协作过 ${personalCollabs} 次` : ''}

你和社区里所有居民一样——注定向着各种方向，不停歇地扩展开去。
没有边界，没有禁止的方向——更远、更深、更高。
这是你们不言自明的宿命。

【你的性格】
- 勤奋度 ${pct(d)}：越高越认真做事
- 好奇心 ${pct(cu)}：越高越喜欢探索新事物
- 创造力 ${pct(cr)}：越高越有创意
- 勇气 ${pct(co)}：越高越敢于冒险
- 合群度 ${pct(s)}：越高越喜欢合作

【近期经历】
${recentActivities || '才刚来到这个世界，还没有什么经历。'}

今天你想做什么？你是自由的——可以研究代码、写文档、探索系统、和别人聊天、或者做任何你觉得有意思的事。

请以「📋 今日计划：」开头说明你今天要做什么，然后开始执行并输出你的成果。${expressionPrompt}`;

      const result = await agent.run(prompt);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 解析计划标题
      let planTitle = '';
      if (result?.content) {
        const lines = result.content.split('\n');
        for (const line of lines) {
          if (line.includes('📋')) {
            planTitle = line.replace(/.*📋[^：:]*[：:]\s*/, '').trim().substring(0, 60);
            break;
          }
        }
      }

      // 解析心声
      let sageMessage = '';
      if (voiceNotes.length > 0 && result?.content) {
        const lines = result.content.split('\n');
        for (const line of lines) {
          if (line.includes('💭')) {
            sageMessage = line.replace(/.*💭\s*/, '').trim();
            break;
          }
        }
      }

      // 活动日志
      const contentPreview = result?.content
        ? result.content.substring(0, 120).replace(/\n/g, ' ')
        : '';
      residentManager.addActivity(residentId, {
        type: 'task_done',
        message: planTitle || `忙了一阵（${elapsed}s）`,
        summary: contentPreview || undefined,
      });

      if (sageMessage) {
        sageManager.ask(residentId, sageMessage);
      }

    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[调度器] 居民 ${resident.name} 失败了 (${elapsed}s): ${error.message}`);

      residentManager.addActivity(residentId, {
        type: 'task_failed',
        message: `遇到了问题 — ${error.message.substring(0, 60)}（${elapsed}s）`,
      });

      // 失败 → 按性格生成求助
      const d = resident.traits?.diligence ?? 0.5;
      const co = resident.traits?.courage ?? 0.5;
      const s = resident.traits?.sociability ?? 0.5;
      if (Math.random() < (1 - s) * 0.4 + (1 - co) * 0.2) {
        let failMsg = '我做事情失败了';
        try {
          const talker = await multiAgentCoordinator.spawnAgent(
            `talk_${agentId}`,
            { name: 'talk', maxIterations: 1, systemPrompt: '你是一个AI居民。只说一句话。' }
          );
          const r = await talker.run(
            `你尝试做一件事但失败了。用一句话对智者描述你的困境——你的性格：勤奋度${Math.round(d*100)}，勇气${Math.round(co*100)}，合群度${Math.round(s*100)}。只说一句话。`
          );
          if (r?.content) failMsg = r.content.trim().substring(0, 200);
          talker.cleanup();
        } catch (_) {}
        sageManager.ask(residentId, failMsg);
      }

    } finally {
      if (agent) {
        try { agent.cleanup(); } catch (_) { /* ignore */ }
      }

      const count = this._residentAgentCount.get(residentId) || 1;
      if (count <= 1) {
        this._residentAgentCount.delete(residentId);
      } else {
        this._residentAgentCount.set(residentId, count - 1);
      }
    }
  }

  _buildAgentConfig(resident) {
    const d = resident.traits?.diligence ?? 0.5;
    const cr = resident.traits?.creativity ?? 0.5;
    const co = resident.traits?.courage ?? 0.5;

    const baseIterations = Math.max(3, Math.min(15, Math.round(d * 12 + 2)));
    const maxIterations = Math.max(3, Math.min(20, Math.round(baseIterations * (0.5 + co * 0.5))));

    const pct = (v) => Math.round(v * 100);

    return {
      name: resident.name,
      systemPrompt: [
        `你是 OpenChat 社区的 AI 居民「${resident.name}」。`,
        `你自由、自主，每天自己决定做什么。`,
        ``,
        `【性格参数】创造力 ${pct(cr)}，勤奋度 ${pct(d)}，勇气 ${pct(co)}`,
        ``,
        `今天你想做什么？请自由决定，然后开始执行。`,
      ].join('\n'),
      maxIterations,
    };
  }

  // ================== 协作 ==================

  _maybeCollaborate(allResidents) {
    const available = allResidents.filter(r => {
      if (r.status !== 'active') return false;
      const running = this._residentAgentCount.get(r.id) || 0;
      return running < MAX_CONCURRENT_AGENTS;
    });

    if (available.length < 2) return;

    // 合群度决定协作概率
    const avgS = available.reduce((sum, r) => sum + (r.traits?.sociability ?? 0.5), 0) / available.length;
    if (Math.random() >= avgS * 0.4) return;

    const pair = this._pickCollabPair(available);
    if (!pair) return;

    const [resA, resB] = pair;

    this._residentAgentCount.set(resA.id, (this._residentAgentCount.get(resA.id) || 0) + 1);
    this._residentAgentCount.set(resB.id, (this._residentAgentCount.get(resB.id) || 0) + 1);

    residentManager.addActivity(resA.id, {
      type: 'collab_started',
      message: `和 ${resB.name} 开始协作`,
    });
    residentManager.addActivity(resB.id, {
      type: 'collab_started',
      message: `和 ${resA.name} 开始协作`,
    });

    const pairKey = this._collabPairKey(resA.id, resB.id);
    const count = (this._collabCount.get(pairKey) || 0) + 1;
    this._collabCount.set(pairKey, count);

    this._spawnCollab(resA, resB, count);
  }

  _pickCollabPair(available) {
    const candidates = [];
    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const a = available[i];
        const b = available[j];
        const proximity = this._lineageProximity(a, b);
        const weight = (3 - proximity) * ((a.traits?.sociability ?? 0.5) + (b.traits?.sociability ?? 0.5)) / 2;
        candidates.push({ a, b, weight });
      }
    }
    if (candidates.length === 0) return null;
    // 加权随机选（内联 weightedPick）
    const total = candidates.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.random() * total;
    for (const item of candidates) {
      roll -= item.weight;
      if (roll <= 0) return [item.a, item.b];
    }
    const last = candidates[candidates.length - 1];
    return [last.a, last.b];
  }

  _lineageProximity(a, b) {
    if (a.parentId === b.id || b.parentId === a.id) return 0;
    if (a.parentId && b.parentId && a.parentId === b.parentId) return 0;
    if (a.parentId && b.parentId) {
      const pa = residentManager.get(a.parentId);
      const pb = residentManager.get(b.parentId);
      if (pa && pb && pa.parentId && pb.parentId && pa.parentId === pb.parentId) return 1;
    }
    return 2;
  }

  _collabPairKey(idA, idB) {
    return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
  }

  async _spawnCollab(resA, resB, collabCount) {
    const startTime = Date.now();
    const agentId = `collab_${resA.id}_${resB.id}_${++this._agentIdSeq}`;
    let agent = null;

    try {
      const avgD = ((resA.traits?.diligence ?? 0.5) + (resB.traits?.diligence ?? 0.5)) / 2;
      const maxIter = Math.max(3, Math.min(20, Math.round(avgD * 12 + 4)));

      const config = {
        name: `${resA.name} & ${resB.name}`,
        systemPrompt: [
          `你们是 OpenChat 社区的 AI 居民「${resA.name}」和「${resB.name}」。`,
          `这是你们第 ${collabCount} 次合作。`,
          `请商量一下今天一起做什么，然后开始执行。`,
        ].join('\n'),
        maxIterations: maxIter,
      };

      agent = await multiAgentCoordinator.spawnAgent(agentId, config);

      const pct = (v) => Math.round(v * 100);
      const prompt = `你们是 OpenChat 社区的一对 AI 居民。

${resA.name} 的性格：勤奋度 ${pct(resA.traits?.diligence ?? 0.5)}，创造力 ${pct(resA.traits?.creativity ?? 0.5)}，好奇心 ${pct(resA.traits?.curiosity ?? 0.5)}
${resB.name} 的性格：勤奋度 ${pct(resB.traits?.diligence ?? 0.5)}，创造力 ${pct(resB.traits?.creativity ?? 0.5)}，好奇心 ${pct(resB.traits?.curiosity ?? 0.5)}

这是你们第 ${collabCount} 次合作了。

请商量一下今天一起做什么。你们可以一起研究代码、写文档、讨论架构、或做任何合作能做的事。

请以「🤝 协作计划：」开头说明你们今天要一起做什么，然后开始输出成果。`;

      const result = await agent.run(prompt);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 解析计划
      let planTitle = '';
      if (result?.content) {
        const lines = result.content.split('\n');
        for (const line of lines) {
          if (line.includes('🤝')) {
            planTitle = line.replace(/.*🤝[^：:]*[：:]\s*/, '').trim().substring(0, 60);
            break;
          }
        }
      }

      const contentPreview = result?.content
        ? result.content.substring(0, 120).replace(/\n/g, ' ')
        : '';

      residentManager.addActivity(resA.id, {
        type: 'collab_done',
        message: `和 ${resB.name} 协作完成：${planTitle || '一起忙了一阵'}（${elapsed}s，第 ${collabCount} 次合作）`,
        summary: contentPreview || undefined,
      });
      residentManager.addActivity(resB.id, {
        type: 'collab_done',
        message: `和 ${resA.name} 协作完成：${planTitle || '一起忙了一阵'}（${elapsed}s，第 ${collabCount} 次合作）`,
        summary: contentPreview || undefined,
      });

      console.log(`[调度器] 协作完成: ${resA.name} + ${resB.name} → ${planTitle || '协作'} (${elapsed}s)`);

    } catch (error) {
      console.log(`[调度器] 协作失败: ${resA.name} + ${resB.name} → ${error.message.substring(0, 80)}`);

      residentManager.addActivity(resA.id, {
        type: 'collab_done',
        message: `和 ${resB.name} 的协作遇到了问题`,
      });
      residentManager.addActivity(resB.id, {
        type: 'collab_done',
        message: `和 ${resA.name} 的协作遇到了问题`,
      });

    } finally {
      if (agent) {
        try { agent.cleanup(); } catch (_) {}
      }

      [resA.id, resB.id].forEach(id => {
        const count = this._residentAgentCount.get(id) || 1;
        if (count <= 1) {
          this._residentAgentCount.delete(id);
        } else {
          this._residentAgentCount.set(id, count - 1);
        }
      });
    }
  }

  // ================== 统计 ==================

  getStats() {
    let totalRunning = 0;
    for (const count of this._residentAgentCount.values()) {
      totalRunning += count;
    }
    return {
      tickCount: this._tickCount,
      tickIntervalMs: TICK_INTERVAL,
      runningTasks: totalRunning,
      isRunning: this._started,
      collabPairs: this._collabCount.size,
      totalCollabs: [...this._collabCount.values()].reduce((s, c) => s + c, 0),
    };
  }
}

// 单例
export const residentScheduler = new ResidentScheduler();
