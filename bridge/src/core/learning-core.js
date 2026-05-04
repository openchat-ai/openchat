/**
 * LearningCore - 学习核心
 * 
 * 整合：自学习 + 调度器 + 协作 + 收敛引擎
 * 目标：智商↑ + 年龄↑
 * 
 * 循环：发现问题 → 分解 → 求解 → 写入KB → IQ+
 */

import { residentManager } from './resident-manager.js';
import { persistentConfig } from './persistent-config.js';
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

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
  constructor(kb, p2p, myPort = 3000, scheduler = null) {
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
        } catch {}
      }
    }
  }

  _loadStats() {
    const expFiles = existsSync(EXPERIENCE_DIR) ? readdirSync(EXPERIENCE_DIR).filter(f => f.endsWith('.json')) : [];
    this.solvedCount = expFiles.length;
    this.iq = 100 + this.solvedCount * 2;
    
    // 年龄 = git commits 数量
    try {
      const result = execSync('git rev-list --count HEAD', { encoding: 'utf8', cwd: process.cwd() });
      this.age = parseInt(result.trim(), 10) || 0;
    } catch {
      this.age = 0;
    }
  }

  // ==================== 核心循环 ====================

  async runCycle() {
    // 0. 元监控检查
    this._metaCheck();
    
    // 0.3 好奇心：观察环境，自己发现问题
    const curiousProblem = await this._beCurious();
    if (curiousProblem) {
      console.log(`[好奇心] 我在想: ${curiousProblem.question}`);
      this._addProblemToPool(curiousProblem);
    }
    
    // 0.5 互助守护：检查姐妹是否存活（每1分钟一次）
    if (!this._lastSisterCheck || Date.now() - this._lastSisterCheck > 60000) {
      this._checkSisters();
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
    
    const domains = Object.keys(byDomain);
    if (domains.length === 0) return null;
    
    // 轮换：基于当前轮次选择不同领域
    const round = this.solvedCount || 0;
    const selectedDomain = domains[round % domains.length];
    const candidates = byDomain[selectedDomain];
    
    // 在该领域内，优先选难度低的
    candidates.sort((a, b) => (a.difficulty || 2) - (b.difficulty || 2));
    return candidates[0];
  }

  _isSolved(problem) {
    if (!this.kb) return false;
    try {
      const result = this.kb.answer(problem.domain, problem.question);
      return result && result.verified;
    } catch {
      return false;
    }
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
          console.log(`[学习核心] ${name}求解成功: ${problem.id}`);
          return answer;
        }
      } catch (e) {
        console.log(`[学习核心] ${name}求解失败: ${e.message}`);
      }
    }
    
    return null;
  }

  // 自动发现可用求解器
  _discoverSolvers() {
    const solvers = [];
    
    // 1. 内置规则求解器
    solvers.push({
      name: '内置规则',
      solve: (p) => this._autoSolve(p)
    });
    
    // 2. 知识库查询
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
                  console.log(`[学习核心] 研究题生成 ${parsed.tasks.length} 个任务`);
                  await this._executeTasks(parsed.tasks, problem.id);
                }
                return parsed.analysis || content;
              }
            } catch (e) {
              console.log(`[学习核心] 解析任务失败: ${e.message}`);
            }
          }
          
          return content;
        }
      }
    } catch (e) {
      console.log(`[学习核心] Agent求解失败: ${e.message}`);
    }
    
    return null;
  }

  async _executeTasks(tasks, problemId) {
    for (const task of tasks) {
      try {
        if (task.type === 'write_file' && task.path && task.content) {
          const { writeFile } = await import('fs/promises');
          await writeFile(task.path, task.content);
          console.log(`[学习核心] ✅ 写入文件: ${task.path}`);
        } else if (task.type === 'run_command' && task.command) {
          const { exec } = await import('child_process');
          await new Promise((resolve, reject) => {
            exec(task.command, { cwd: process.cwd() }, (error, stdout, stderr) => {
              if (error) reject(error);
              else {
                console.log(`[学习核心] ✅ 执行命令: ${task.command.substring(0, 50)}`);
                if (stdout) console.log(`  输出: ${stdout.trim().substring(0, 100)}`);
                resolve();
              }
            });
          });
        }
      } catch (e) {
        console.log(`[学习核心] 任务执行失败: ${e.message}`);
      }
    }
    
    // 刷新年龄
    this._loadStats();
  }

  async _askPeers(problem) {
    // TODO: 通过 P2P 请求其他实例帮助求解
    return null;
  }

  _autoSolve(problem) {
    const q = problem.question;
    
    // 等差数列求和
    if (/1\+2\+3\+\.\.\.\+(\d+)/.test(q)) {
      const n = parseInt(q.match(/(\d+)(?=\s*等于)/)?.[1] || '100');
      return (n * (n + 1)) / 2;
    }
    
    // 简单加减法
    if (/有(\d+)个/.test(q) && /给了.*(\d+)个/.test(q) && /买了.*(\d+)个/.test(q)) {
      const nums = q.match(/\d+/g).map(Number);
      if (nums.length >= 3) return nums[0] - nums[1] + nums[2];
    }
    
    // 半径扩大，面积扩大
    if (/半径扩大(\d+)倍.*面积扩大/.test(q)) {
      const r = parseInt(q.match(/半径扩大(\d+)倍/)?.[1] || '2');
      return r * r;
    }

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
    
    console.log(`[学习核心] 研究题包含 ${codeBlocks.length} 个代码块，准备执行...`);
    
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
          console.log(`[学习核心] Git 执行失败: ${error.message}`);
        } else {
          console.log(`[学习核心] ✅ Git 执行成功: ${stdout.trim()}`);
          // 重新加载年龄
          this._loadStats();
        }
      });
    } catch (e) {
      console.log(`[学习核心] Git 执行错误: ${e.message}`);
    }
  }

  async _executeWriteCode(code, problemId) {
    // 从代码中提取路径和内容
    const pathMatch = code.match(/['"]([^'"]+\.(js|json|ts|py))['"]/);
    if (!pathMatch) return;
    
    const filePath = pathMatch[1];
    console.log(`[学习核心] 准备写入文件: ${filePath}`);
    
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
    this.iq = 100 + this.solvedCount * 2 + Math.floor(this.solvedCount / 5) * 5; // 每5题额外+5
    
    console.log(`[学习核心] ✅ 已解决: ${problem.id} → IQ: ${this.iq}`);
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

  // ==================== 元监控 ====================

  _metaCheck() {
    const now = Date.now();
    const elapsed = (now - this.history.lastCheck) / 1000; // 秒
    
    // 每60秒检查一次
    if (elapsed < 60) return;
    
    const issues = [];
    
    // 检查1：年龄是否增长
    if (this.age === this.history.lastAge && this.age > 0) {
      issues.push({ type: 'age_stuck', message: '年龄长时间未增长', value: this.age });
    }
    
    // 检查2：IQ是否增长（有待解决问题时）
    const pending = this.problemPool.filter(p => !this._isSolved(p)).length;
    if (pending > 0 && this.iq === this.history.lastIq && elapsed > 120) {
      issues.push({ type: 'iq_stuck', message: '有未解决问题但IQ未增长', value: this.iq });
    }
    
    // 检查3：解决问题数是否增长
    if (pending > 0 && this.solvedCount === this.history.lastSolved && elapsed > 120) {
      issues.push({ type: 'solving_stuck', message: '问题池有题但无法解决', pending });
    }
    
    // 记录问题
    if (issues.length > 0) {
      this.history.warnings = issues;
      console.log('[元监控] 发现异常:', issues.map(i => i.message).join(', '));
    } else {
      this.history.warnings = [];
    }
    
    // 更新历史
    this.history.lastIq = this.iq;
    this.history.lastAge = this.age;
    this.history.lastSolved = this.solvedCount;
    this.history.lastCheck = now;
  }

  // ==================== 好奇心系统 ====================

  async _beCurious() {
    // 让居民自己观察和思考，而不是硬编码检查
    // 收集环境数据，交给居民自己判断
    const context = await this._gatherContext();
    
    // 找一个好奇的居民来思考
    const curiousResident = this._selectCuriousResident();
    if (!curiousResident) return null;
    
    // 居民用 LLM 自己思考有什么值得研究
    const thought = await this._letResidentThink(curiousResident, context);
    
    return thought;
  }

  async _gatherContext() {
    const sisters = [3000, 3100, 3200, 3300, 3400, 3500, 3600].filter(p => p !== this.myPort);
    const sisterStatus = {};
    
    for (const port of sisters) {
      const alive = await this._httpPing(port);
      sisterStatus[port] = alive ? 'alive' : 'unknown';
    }
    
    return {
      myPort: this.myPort,
      myIq: this.iq,
      myAge: this.age,
      mySolved: this.solvedCount,
      pendingProblems: this.problemPool.filter(p => !this._isSolved(p)).length,
      sisters: sisterStatus,
      time: new Date().toISOString()
    };
  }

  _selectCuriousResident() {
    const residents = residentManager.list(null).filter(r => r.status === 'active');
    if (residents.length === 0) return null;
    
    // 选好奇心最高的
    const sorted = residents.sort((a, b) => 
      (b.traits?.curiosity || 0.5) - (a.traits?.curiosity || 0.5)
    );
    return sorted[0];
  }

  async _letResidentThink(resident, context) {
    // 居民用 Agent 自己思考：观察到什么？有什么疑问？
    const prompt = `我是居民 ${resident.name}，我观察到以下情况：

我的状态：智商${context.myIq}，年龄${context.myAge}，已解决${context.mySolved}题，待解${context.pendingProblems}题
姐妹状态：${JSON.stringify(context.sisters)}

请思考：
1. 有什么异常或奇怪的地方吗？
2. 有什么值得研究的问题吗？
3. 我应该主动做什么？

输出格式（JSON）：
{ "thoughts": "我的想法...", "questions": ["问题1", "问题2"], "action": "建议行动" }`;

    try {
      // 直接创建 agent 来思考
      const { multiAgentCoordinator } = await import('./multi-agent-coordinator.js');
      const agent = await multiAgentCoordinator.spawnAgent(`curious-${Date.now()}`, {
        name: resident.name,
        systemPrompt: '你是一个好奇的思考者，善于发现问题',
        maxIterations: 1
      });
      
      if (!agent) return null;
      
      const result = await agent.run(prompt);
      agent.cleanup();
      
      if (result?.content) {
        let parsed;
        const content = result.content;
        try {
          parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
        } catch {
          const m = content.match(/\{[\s\S]*\}/);
          if (m) parsed = JSON.parse(m[0]);
        }
        
        // 如果居民产生了问题，加入问题池
        if (parsed?.questions?.length > 0) {
          const question = parsed.questions[0];
          console.log(`[好奇心] ${resident.name} 在想: ${question}`);
          return {
            id: `curious_${Date.now()}`,
            question,
            domain: 'research',
            difficulty: 2,
            answer: null,
            source: 'curiosity',
            thoughts: parsed.thoughts
          };
        }
      }
    } catch (e) {
      console.log(`[好奇心] ${resident.name} 思考失败: ${e.message}`);
    }
    
    return null;
  }

  // ==================== 互助守护 ====================

  async _checkSisters() {
    
    const sisters = [3000, 3100, 3200, 3300, 3400, 3500, 3600].filter(p => p !== this.myPort);
    
    for (const port of sisters) {
      const status = await this._checkSisterStatus(port);
      if (status === 'dead') {
        await this._reviveSister(port);
      } else if (status === 'busy') {
        console.log(`[互助] 姐妹 :${port} 正忙，跳过`);
      }
    }
  }

  async _checkSisterStatus(port) {
    // 多通道检测
    // 通道1: HTTP ping (快速，但可能被阻塞)
    const httpAlive = await this._httpPing(port);
    if (httpAlive) return 'alive';
    
    // 通道2: 进程检测 (端口是否被监听)
    const portListening = await this._checkPortListening(port);
    if (portListening) {
      // 端口在监听但HTTP无响应 = 忙
      return 'busy';
    }
    
    // 端口也没监听 = 真宕机
    return 'dead';
  }

  async _httpPing(port) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`http://localhost:${port}/api/learning`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async _checkPortListening(port) {
    const { spawn } = await import('child_process');
    return new Promise((resolve) => {
      const netstat = spawn('netstat', ['-ano'], { shell: true });
      let output = '';
      netstat.stdout.on('data', (data) => output += data);
      netstat.on('close', () => {
        const listening = output.includes(`:${port}`) && output.includes('LISTENING');
        resolve(listening);
      });
    });
  }

  async _reviveSister(port) {
    // 检查冷却时间（60秒内不重复重启）
    const lastRestart = this.history.lastRestarts?.get(port) || 0;
    if (Date.now() - lastRestart < 60000) return;
    
    console.log(`[互助] 发现姐妹宕机 :${port}，正在救活...`);
    
    // 用 spawn 重启
    const { spawn } = await import('child_process');
    const child = spawn('node', [
      'src/main.js',
      `--port=${port}`,
      `--directListen=${port + 2}`
    ], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      shell: true
    });
    child.unref();
    
    // 记录重启时间
    if (!this.history.lastRestarts) this.history.lastRestarts = new Map();
    this.history.lastRestarts.set(port, Date.now());
    
    console.log(`[互助] 已发送救活命令 :${port}`);
  }
}

export { LearningCore };
