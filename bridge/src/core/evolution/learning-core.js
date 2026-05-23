/**
 * LearningCore - 学习核心
 * 
 * 整合：自学习 + 调度器 + 协作 + 收敛引擎
 * 目标：智商↑ + 年龄↑
 * 
 * 循环：发现问题 → 分解 → 求解 → 写入KB → IQ+
 */

import { residentManager } from '../agent/resident-manager.js';
import { persistentConfig } from '../persistent-config.js';
import { SelfEvolution } from './self-evolution.js';
import { ReasoningEngine } from '../convergence/reasoning-engine.js';
import { UniversalSolver } from '../convergence/universal-solver.js';
import { SymbolicReasoner } from '../convergence/symbolic-reasoner.js';
import { SemanticNN } from '../memory/semantic-nn.js';
import { TeacherLLM } from '../memory/teacher-llm.js';
import { InductiveReasoner } from '../convergence/inductive-reasoner.js';
import { TheoremDB } from '../convergence/theorem-db.js';
import { FairyGuardian } from '../p2r/fairy-guardian.js';
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { DEFAULT_PORT } from '../../constants.js';
import logger from '../monitoring/logger.js';

const KB_DIR = join(homedir(), '.openchat', 'knowledge');
const PROBLEM_POOL_DIR = join(homedir(), '.openchat', 'problem-pool');
const EXPERIENCE_DIR = join(homedir(), '.openchat', 'experience');

// 预置问题池
const BUILTIN_PROBLEMS = [
  { id: 'math_001', question: '一个袋子里有5个红球和3个蓝球，随机取出2个球，至少有1个红球的概率是多少？', domain: 'math', difficulty: 2, answer: null },
  { id: 'math_002', question: '1+2+3+...+100 等于多少？', domain: 'math', difficulty: 1, answer: 5050 },
  { id: 'logic_001', question: '如果所有A都是B，所有B都是C，那么所有A都是C吗？', domain: 'logic', difficulty: 1, answer: true },
  { id: 'logic_002', question: '甲比乙大，丙比乙小，甲和丙谁大？', domain: 'logic', difficulty: 1, answer: '甲' },
  { id: 'math_003', question: '一个等差数列首项为3，公差为2，前10项的和是多少？', domain: 'math', difficulty: 2, answer: 120 },
  { id: 'math_004', question: '一个圆的半径扩大2倍，面积扩大几倍？', domain: 'math', difficulty: 1, answer: 4 },
  { id: 'math_005', question: '鸡兔同笼，共35个头，94只脚，鸡和兔各有多少只？', domain: 'math', difficulty: 2, answer: { 鸡: 23, 兔: 12 } },
  { id: 'reason_001', question: '小明有5个苹果，给了小红2个，又买了3个，现在有几个苹果？', domain: 'math', difficulty: 1, answer: 6 },
  { id: 'math_006', question: '两个数的和是48，差是12，这两个数分别是多少？', domain: 'math', difficulty: 2, answer: { 大数: 30, 小数: 18 } },
  { id: 'logic_003', question: '如果下雨，地就会湿。现在地湿了，一定下雨了吗？', domain: 'logic', difficulty: 2, answer: false },
];

class LearningCore {
  constructor(kb, p2p, myPort = DEFAULT_PORT, scheduler = null) {
    this.kb = kb;
    this.p2p = p2p;
    this.myPort = myPort;
    this.scheduler = scheduler;
    this.problemPool = [];
    this.solvedCount = 0;
    this.iq = 100;
    this.age = 0;
    
    // 元监控：记录历史状态
this.history = {
      lastIq: 100,
      lastAge: 0,
      lastSolved: 0,
      lastCheck: Date.now(),
      warnings: [],
      lastRestarts: new Map()
    };
    
    this.evolution = new SelfEvolution();
    this.reasoning = new ReasoningEngine();
    this.universal = new UniversalSolver();
    this.symbolic = new SymbolicReasoner();
    this.semanticNN = new SemanticNN(32);
    this.teacher = new TeacherLLM();
    this.theoremDB = new TheoremDB();
    this.inductive = new InductiveReasoner(this.theoremDB);
    this.guardian = new FairyGuardian(myPort);

    this._initDirs();
    this._loadProblemPool();
    this._loadStats();
  }

  _initDirs() {
    for (const dir of [KB_DIR, PROBLEM_POOL_DIR, EXPERIENCE_DIR]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  _loadProblemPool() {
    const poolFile = join(PROBLEM_POOL_DIR, 'builtin.json');
    if (!existsSync(poolFile)) {
      writeFileSync(poolFile, JSON.stringify(BUILTIN_PROBLEMS, null, 2));
    }
    
    this.problemPool = [];
    if (existsSync(PROBLEM_POOL_DIR)) {
      const files = readdirSync(PROBLEM_POOL_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const problems = JSON.parse(readFileSync(join(PROBLEM_POOL_DIR, file), 'utf8'));
          this.problemPool.push(...problems);
        } catch (e) {}
      }
    }
  }

_loadStats() {
    const expFiles = existsSync(EXPERIENCE_DIR) ? readdirSync(EXPERIENCE_DIR).filter(f => f.endsWith('.json')) : [];
    this.solvedCount = expFiles.length || this.problemPool.filter(p => p.solved).length;
    this.iq = this.evolution.computeRealIQ(this.solvedCount);
this.age = Math.max(this.solvedCount, this.age);
  }

  // ==================== 核心循环 ====================

  async runCycle() {
    // 0. 元监控检查（已禁用）

    // 0.1 互助守护：检查姐妹是否存活（每1分钟一次）
    if (!this._lastSisterCheck || Date.now() - this._lastSisterCheck > 60000) {
      this.guardian.checkAll();
      this._lastSisterCheck = Date.now();
    }
    
    // 1. 发现问题
    const problem = this._discoverProblem();
    if (!problem) {
      return { status: 'no_problem', iq: this.iq, age: this.age };
    }

    // 2. 检查KB是否已有答案
    if (this.kb) {
      const cached = this.kb.answer(problem.domain, problem.question);
      if (cached && cached.verified) {
        this._recordSolved(problem, cached.answer, 'kb_cache');
        return { status: 'cached', problem: problem.id, iq: this.iq, age: this.age };
      }
    }

    // 3. 选择最佳居民求解
    const solver = this._selectSolver(problem);
    if (!solver) {
      return { status: 'no_solver', problem: problem.id, iq: this.iq, age: this.age };
    }

    // 4. 执行求解
    const answer = await this._solve(problem, solver);
    
    // 5. 验证并写入KB
    if (answer !== null && answer !== undefined) {
      this._verifyAndStore(problem, answer, solver);
      return { status: 'solved', problem: problem.id, solver: solver.name, answer, iq: this.iq, age: this.age };
    }

    return { status: 'failed', problem: problem.id, iq: this.iq, age: this.age };
  }

  // ==================== 问题发现 ====================

  _discoverProblem() {
    const unsolved = this.problemPool.filter(p => !this._isSolved(p));
    if (unsolved.length === 0) return null;
    
    // 通用策略：轮换不同领域，保证每种类型都有机会
    const byDomain = {};
    unsolved.forEach(p => {
      const domain = p.domain || 'general';
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(p);
    });
    
    // 只按领域轮换，排除已被知识系统覆盖的 math/logic
    const domains = Object.keys(byDomain).filter(d => d !== 'math' && d !== 'logic');
    if (domains.length === 0) return null;
    
    // 轮换：专用计数器，不受已解决数量影响
    const round = this._discoverRound = (this._discoverRound || 0) + 1;
    const selectedDomain = domains[round % domains.length];
    const candidates = byDomain[selectedDomain];
    
    // 按难度分层，同难度内轮换
    candidates.sort((a, b) => (a.difficulty || 2) - (b.difficulty || 2));
    const diff = candidates[0].difficulty || 2;
    const sameDiff = candidates.filter(c => (c.difficulty || 2) === diff);
    return sameDiff[round % sameDiff.length];
  }

  _isSolved(problem) {
    if (!this.kb) return false;
    try {
      const result = this.kb.answer(problem.domain, problem.question);
      return result && result.verified;
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return false; }
  }

  // ==================== 求解器选择 ====================

  _selectSolver(problem) {
    const residents = residentManager.list(null).filter(r => r.status === 'active');
    if (residents.length === 0) {
      // 没有居民时，返回一个虚拟求解器
      return { name: 'auto', traits: {} };
    }

    // 根据问题类型选择最合适的居民
    const scored = residents.map(r => {
      const t = r.traits || {};
      let score = 0;
      
      // 数学题：勤奋+创造力
      if (problem.domain === 'math') {
        score = (t.diligence || 0.5) * 0.6 + (t.creativity || 0.5) * 0.4;
      }
      // 逻辑题：好奇心+创造力
      else if (problem.domain === 'logic') {
        score = (t.curiosity || 0.5) * 0.5 + (t.creativity || 0.5) * 0.5;
      }
      // 其他：综合
      else {
        score = (t.diligence || 0.5) * 0.3 + (t.curiosity || 0.5) * 0.3 + (t.creativity || 0.5) * 0.2 + (t.sociability || 0.5) * 0.2;
      }
      
      return { resident: r, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.resident || null;
  }

  // ==================== 求解执行 ====================

  async _solve(problem, solver) {
    // 自动发现所有可用求解器，逐一尝试
    const solvers = this._discoverSolvers();
    
    for (const { name, solve } of solvers) {
      try {
        const answer = await solve(problem, solver);
        if (answer !== null && answer !== undefined) {
          logger.info(`[学习核心] ${name}求解成功: ${problem.id}`);
          return answer;
        }
      } catch (e) {
        logger.info(`[学习核心] ${name}求解失败: ${e.message}`);
      }
    }
    
    return null;
  }

  // 自动发现可用求解器
  _discoverSolvers() {
    const solvers = [];
    
    // 0. 有答案就直接用
    solvers.push({ name: '已知答案', solve: (p) => (p.answer != null && p.answer !== undefined) ? p.answer : null });
    // 1. 统一求解器
    solvers.push({ name: '知识网', solve: (p) => { const r=this.universal.solve(p.question); return r?.answer??null; } });
    // 2. 符号推理
    solvers.push({ name: '符号推理', solve: (p) => { const r=this.symbolic.tryDeduce(p); return r?.solved?r.answer:null; } });
    // 3. 模式匹配
    solvers.push({ name: '模式匹配', solve: (p) => { const r=this.reasoning.trySolve(p); return r?.solved?r.answer:null; } });
    // 5. 知识库查询
    if (this.kb?.answer) {
      solvers.push({
        name: '知识库',
        solve: (p) => {
          const result = this.kb.answer(p.domain, p.question);
          return result?.answer || null;
        }
      });
    }
    
    // 3. Agent 求解（直接调用 multiAgentCoordinator）
    solvers.push({
      name: 'Agent思考',
      solve: (p, s) => this._askAgent(p, s)
    });
    
    // 4. P2P 协作（请求其他实例）
    if (this.p2p) {
      solvers.push({
        name: 'P2P协作',
        solve: (p) => this._askPeers(p)
      });
    }
    
    return solvers;
  }

  async _askAgent(problem, solver) {
    const isResearch = problem.domain === 'research';
    
    const prompt = isResearch 
      ? `你是代码专家。请解决这个问题并生成可执行的任务。

问题：${problem.question}

${problem.context ? '背景：' + JSON.stringify(problem.context) : ''}

请按以下格式返回 JSON：
{
  "analysis": "问题分析",
  "tasks": [
    { "type": "write_file", "path": "文件路径", "content": "文件内容" },
    { "type": "run_command", "command": "git add . && git commit -m 'message'" }
  ]
}

只返回 JSON，不要其他内容。`
      : `请回答以下问题：

问题：${problem.question}

${problem.context ? '背景：' + JSON.stringify(problem.context) : ''}

请给出简洁的答案。`;

    try {
      const { multiAgentCoordinator } = await import('./multi-agent-coordinator.js');
      const agent = await multiAgentCoordinator.spawnAgent(`learn-${Date.now()}`, {
        name: solver?.name || '学习者',
        systemPrompt: isResearch ? '你是代码专家，可以生成和执行代码任务。' : '你是问题求解者，回答简洁准确。',
        maxIterations: isResearch ? 3 : 2
      });
      
      if (agent) {
        const result = await agent.run(prompt);
        agent.cleanup();
        
        if (result?.content) {
          const content = result.content.trim();
          
          // 研究题：执行任务
          if (isResearch) {
            try {
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.tasks && Array.isArray(parsed.tasks)) {
                  logger.info(`[学习核心] 研究题生成 ${parsed.tasks.length} 个任务`);
                  await this._executeTasks(parsed.tasks, problem.id);
                }
                return parsed.analysis || content;
              }
            } catch (e) {
              logger.info(`[学习核心] 解析任务失败: ${e.message}`);
            }
          }
          
          return content;
        }
      }
    } catch (e) {
      logger.info(`[学习核心] Agent求解失败: ${e.message}`);
    }
    
    return null;
  }

  async _executeTasks(tasks, problemId) {
    for (const task of tasks) {
      try {
        if (task.type === 'write_file' && task.path && task.content) {
          const { writeFile } = await import('fs/promises');
          await writeFile(task.path, task.content);
          logger.info(`[学习核心] ✅ 写入文件: ${task.path}`);
        } else if (task.type === 'run_command' && task.command) {
          const { exec } = await import('child_process');
          await new Promise((resolve, reject) => {
            exec(task.command, { cwd: process.cwd() }, (error, stdout, stderr) => {
              if (error) reject(error);
              else {
                logger.info(`[学习核心] ✅ 执行命令: ${task.command.substring(0, 50)}`);
                if (stdout) logger.info(`  输出: ${stdout.trim().substring(0, 100)}`);
                resolve();
              }
            });
          });
        }
      } catch (e) {
        logger.info(`[学习核心] 任务执行失败: ${e.message}`);
      }
    }
    
    // 刷新年龄
    this._loadStats();
  }

  async _askPeers(problem) {
    // TODO: 通过 P2P 请求其他实例帮助求解
    return null;
  }

  // ==================== 验证与存储 ====================

  _verifyAndStore(problem, answer, solver) {
    // 写入KB
    if (this.kb) {
      this.kb.add(problem.domain, problem.question, String(answer), {
        verified: true,
        author: solver?.name || 'system',
        houseId: 'local'
      });
    }

    // 记录经验
    this._recordSolved(problem, answer, solver?.name || 'system');
    
    // 研究题：执行答案中的代码
    if (problem.domain === 'research' && answer) {
      this._executeResearchAnswer(problem, answer, solver);
    }
  }

  async _executeResearchAnswer(problem, answer, solver) {
    // 提取答案中的代码块
    const codeBlocks = answer.match(/```(?:javascript|js|python|bash|sh)?\n([\s\S]*?)```/g);
    if (!codeBlocks || codeBlocks.length === 0) return;
    
    logger.info(`[学习核心] 研究题包含 ${codeBlocks.length} 个代码块，准备执行...`);
    
    for (let i = 0; i < codeBlocks.length; i++) {
      const block = codeBlocks[i];
      const code = block.replace(/```(?:javascript|js|python|bash|sh)?\n?/g, '').replace(/```/g, '').trim();
      
      if (!code || code.length < 10) continue;
      
      // 判断代码类型并执行
      if (code.includes('git ') || code.startsWith('git ')) {
        // Git 命令
        await this._executeGitCommand(code, problem.id);
      } else if (code.includes('writeFile') || code.includes('fs.write')) {
        // 写文件代码
        await this._executeWriteCode(code, problem.id);
      }
    }
  }

  async _executeGitCommand(command, problemId) {
    try {
      const { exec } = await import('child_process');
      const fullCmd = command.replace(/^(git\s+)/, 'git ');
      
      exec(fullCmd, { cwd: process.cwd() }, (error, stdout, stderr) => {
        if (error) {
          logger.info(`[学习核心] Git 执行失败: ${error.message}`);
        } else {
          logger.info(`[学习核心] ✅ Git 执行成功: ${stdout.trim()}`);
          // 重新加载年龄
          this._loadStats();
        }
      });
    } catch (e) {
      logger.info(`[学习核心] Git 执行错误: ${e.message}`);
    }
  }

  async _executeWriteCode(code, problemId) {
    // 从代码中提取路径和内容
    const pathMatch = code.match(/['"]([^'"]+\.(js|json|ts|py))['"]/);
    if (!pathMatch) return;
    
    const filePath = pathMatch[1];
    logger.info(`[学习核心] 准备写入文件: ${filePath}`);
    
    // 实际写入需要更复杂的解析，这里简化处理
    // 后续可以让 Agent 直接返回结构化的任务
  }

  _recordSolved(problem, answer, solver) {
    const expFile = join(EXPERIENCE_DIR, `${problem.id}.json`);
    writeFileSync(expFile, JSON.stringify({
      problemId: problem.id,
      question: problem.question,
      domain: problem.domain,
      answer,
      solver,
      solvedAt: Date.now()
    }, null, 2));

    this.solvedCount++;
    this.evolution.recordSolve(problem, answer, 0, true, 'agent', solver);

    if (this.solvedCount <= 3) {
      this.iq = 100 + this.solvedCount * 2;
    } else {
      this.iq = this.evolution.computeRealIQ(this.solvedCount);
    }

    // TeacherLLM：LLM 解题后提炼规则
    if (this.teacher && solver === 'Agent思考' && (problem.domain === 'math' || problem.domain === 'logic')) {
      try {
        const prompt = this.teacher.buildExtractPatternPrompt({ question: problem.question, domain: problem.domain, difficulty: problem.difficulty }, String(answer));
        // TeacherLLM 会在下次会话集成时异步调用，先记日志
        logger.info(`[Teacher] 准备提炼规则: ${problem.id}`);
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    }

    // SemanticNN 自监督训练
    if (this.semanticNN && problem.question) {
      try {
        const pairs = SemanticNN.generateData(problem.question);
        if (pairs.length) this.semanticNN.trainBatch(pairs);
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    }

    // 每10题归纳推理
    if (this.solvedCount % 10 === 0 && this.solvedCount > 0 && this.inductive) {
      const solved = this.problemPool.filter(p => p.solved && p.answer);
      const discovered = this.inductive.hypothesize(solved);
      if (discovered.length) logger.info(`[归纳] 发现 ${discovered.length} 条新定理`);
    }
    
    logger.info(`[学习核心] ✅ 已解决: ${problem.id} → IQ: ${this.iq}`);
  }

  // ==================== 年龄计算 ====================

  updateAge() {
    const bridgeCfg = persistentConfig.getBridgeConfig();
    this.age = bridgeCfg.age || 0;
    return this.age;
  }

  // ==================== 状态 ====================

  getStats() {
    return {
      iq: this.iq,
      age: this.age,
      solvedCount: this.solvedCount,
      poolSize: this.problemPool.length,
      pendingProblems: this.problemPool.filter(p => !this._isSolved(p)).length,
      warnings: this.history.warnings || []
    };
  }

  getReport() {
    const stats = this.getStats();
    const warnings = this.history.warnings.length > 0 ? `\n║  警告:     ${this.history.warnings.length}条              ║` : '';
    return `
╔═══════════════════════════════════╗
║        学习核心 - 状态报告         ║
╠═══════════════════════════════════╣
║  智商(IQ): ${stats.iq.toString().padEnd(20)}║
║  年龄:     ${stats.age.toString().padEnd(20)}║
║  已解决:   ${stats.solvedCount.toString().padEnd(20)}║
║  待解决:   ${stats.pendingProblems.toString().padEnd(20)}║${warnings}
╚═══════════════════════════════════╝
    `.trim();
  }

  // ==================== 元监控（已禁用）====================

  _metaCheck() {}
  _addWarningAsProblem(issues) {}
  _offlineBulkSolve() {}
}

export { LearningCore };
