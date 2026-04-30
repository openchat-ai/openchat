/**
 * SelfLearner - 自学习慣模块
 * 
 * 居民主动发现问题、解决问题、积累经验
 * 
 * 三大模块：
 * 1. 问题发现器 - 从知识库缺口、问题池发现待解决问题
 * 2. 驱动机制 - curiosity 高的居民主动探索
 * 3. 验证闭环 - 解决后自动验证、记录模式
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const KB_DIR = join(homedir(), '.openchat', 'knowledge');
const PROBLEM_POOL_DIR = join(homedir(), '.openchat', 'problem-pool');
const LEARN_LOG = join(homedir(), '.openchat', 'learn-log.json');

// 预置问题池（数学/逻辑/推理）
const BUILTIN_PROBLEMS = [
  {
    id: 'math_001',
    question: '一个袋子里有5个红球和3个蓝球，随机取出2个球，至少有1个红球的概率是多少？',
    domain: 'math',
    difficulty: 2,
    answer: null, // 待求解
    tags: ['概率', '组合']
  },
  {
    id: 'math_002', 
    question: '1+2+3+...+100 等于多少？',
    domain: 'math',
    difficulty: 1,
    answer: 5050,
    tags: ['等差数列', '求和']
  },
  {
    id: 'logic_001',
    question: '如果所有A都是B，所有B都是C，那么所有A都是C吗？',
    domain: 'logic',
    difficulty: 1,
    answer: 1, // 是
    tags: ['三段论', '推理']
  },
  {
    id: 'math_003',
    question: '一个等差数列首项为3，公差为2，前10项的和是多少？',
    domain: 'math',
    difficulty: 2,
    answer: 120,
    tags: ['等差数列', '求和']
  },
  {
    id: 'logic_002',
    question: '甲比乙大，丙比乙小，甲和丙谁大？',
    domain: 'logic',
    difficulty: 1,
    answer: '甲',
    tags: ['比较', '推理']
  },
  {
    id: 'math_004',
    question: '一个圆的半径扩大2倍，面积扩大几倍？',
    domain: 'math',
    difficulty: 1,
    answer: 4,
    tags: ['几何', '比例']
  },
  {
    id: 'math_005',
    question: '鸡兔同笼，共35个头，94只脚，鸡和兔各有多少只？',
    domain: 'math',
    difficulty: 2,
    answer: { 鸡: 23, 兔: 12 },
    tags: ['方程', '应用题']
  },
  {
    id: 'reason_001',
    question: '小明有5个苹果，给了小红2个，又买了3个，现在有几个苹果？',
    domain: 'math',
    difficulty: 1,
    answer: 6,
    tags: ['加减法', '应用题']
  },
  {
    id: 'math_006',
    question: '两个数的和是48，差是12，这两个数分别是多少？',
    domain: 'math',
    difficulty: 2,
    answer: { 大数: 30, 小数: 18 },
    tags: ['方程', '应用题']
  },
  {
    id: 'logic_003',
    question: '如果下雨，地就会湿。现在地湿了，一定下雨了吗？',
    domain: 'logic',
    difficulty: 2,
    answer: 0, // 不一定
    tags: ['逻辑', '因果关系']
  }
];

class SelfLearner {
  constructor(options = {}) {
    this.scheduler = options.scheduler;
    this.minCuriosity = options.minCuriosity || 0.6;
    this.maxProblemsPerRound = options.maxProblemsPerRound || 3;
    this.learnHistory = [];
    this.problemPool = [];
    
    this._initProblemPool();
    this._loadHistory();
  }

  /**
   * 初始化问题池
   */
  _initProblemPool() {
    // 确保目录存在
    if (!existsSync(PROBLEM_POOL_DIR)) {
      const { mkdirSync } = require('fs');
      mkdirSync(PROBLEM_POOL_DIR, { recursive: true });
    }
    
    // 写入预置问题
    const poolFile = join(PROBLEM_POOL_DIR, 'builtin.json');
    if (!existsSync(poolFile)) {
      writeFileSync(poolFile, JSON.stringify(BUILTIN_PROBLEMS, null, 2));
    }
    
    // 加载所有问题
    this._loadProblemPool();
  }

  /**
   * 加载问题池
   */
  _loadProblemPool() {
    this.problemPool = [];
    
    if (!existsSync(PROBLEM_POOL_DIR)) return;
    
    const files = readdirSync(PROBLEM_POOL_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = readFileSync(join(PROBLEM_POOL_DIR, file), 'utf8');
        const problems = JSON.parse(content);
        this.problemPool.push(...problems);
      } catch {}
    }
    
    console.log(`[自学] 问题池已加载: ${this.problemPool.length} 题`);
  }

  /**
   * 加载学习历史
   */
  _loadHistory() {
    if (existsSync(LEARN_LOG)) {
      try {
        this.learnHistory = JSON.parse(readFileSync(LEARN_LOG, 'utf8'));
      } catch {
        this.learnHistory = [];
      }
    }
  }

  /**
   * 记录学习历史
   */
  _logLearning(entry) {
    this.learnHistory.push(entry);
    writeFileSync(LEARN_LOG, JSON.stringify(this.learnHistory, null, 2));
  }

  /**
   * 发现问题 - 核心方法
   * @returns {Array} 待解决问题列表
   */
  discoverProblems() {
    const problems = [];
    
    // 1. 从问题池找未解决的
    const unsolved = this.problemPool.filter(p => {
      // 检查知识库是否已有答案
      const solved = this._checkIfSolved(p);
      return !solved;
    });
    problems.push(...unsolved.map(p => ({
      source: 'problem_pool',
      problem: p,
      priority: p.difficulty || 2
    })));
    
    // 2. 检查知识库缺口（有domain但答案不完整）
    const kbGaps = this._findKBGaps();
    problems.push(...kbGaps);
    
    // 按优先级排序（简单题优先）
    problems.sort((a, b) => a.priority - b.priority);
    
    return problems.slice(0, this.maxProblemsPerRound);
  }

  /**
   * 检查问题是否已解决
   */
  _checkIfSolved(problem) {
    if (problem.answer === null || problem.answer === undefined) return false;
    
    // 检查知识库
    if (!existsSync(KB_DIR)) return false;
    
    const files = readdirSync(KB_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = readFileSync(join(KB_DIR, file), 'utf8');
        const data = JSON.parse(content);
        const entries = data.entries || [];
        for (const entry of entries) {
          if (entry.question && entry.question.includes(problem.question.substring(0, 20))) {
            return true;
          }
        }
      } catch {}
    }
    return false;
  }

  /**
   * 发现知识库缺口
   */
  _findKBGaps() {
    // 简化版：返回空，后续可扩展
    return [];
  }

  /**
   * 选择学习型居民
   * @returns {Array} curiosity 高的居民
   */
  selectLearners(residents) {
    return residents.filter(r => {
      const curiosity = r.traits?.curiosity || 0.5;
      return curiosity >= this.minCuriosity;
    });
  }

  /**
   * 执行一轮自学
   */
  async runLearningRound() {
    console.log('\n[自学] 开始新一轮学习...');
    
    // 1. 发现问题
    const problems = this.discoverProblems();
    if (problems.length === 0) {
      console.log('[自学] 没有发现新问题');
      return { learned: 0 };
    }
    
    console.log(`[自学] 发现 ${problems.length} 个待解决问题`);
    
    // 2. 选择学习者
    const learners = this.selectLearners(this.scheduler._residents || []);
    if (learners.length === 0) {
      console.log('[自学] 没有好奇心强的居民');
      return { learned: 0 };
    }
    
    console.log(`[自学] ${learners.length} 位居民参与学习`);
    
    // 3. 分配问题给学习者
    let learned = 0;
    for (let i = 0; i < problems.length && i < learners.length; i++) {
      const problem = problems[i];
      const learner = learners[i];
      
      console.log(`[自学] ${learner.name} 开始学习: ${problem.problem.question.substring(0, 30)}...`);
      
      // 4. 提交给调度器解决
      if (this.scheduler && this.scheduler.addProblem) {
        this.scheduler.addProblem({
          problemId: problem.problem.id,
          domain: problem.problem.domain,
          question: problem.problem.question,
          subQuestions: [],
          from: 'self_learning',
          expectedAnswer: problem.problem.answer
        });
        
        this._logLearning({
          time: Date.now(),
          resident: learner.name,
          problemId: problem.problem.id,
          question: problem.problem.question,
          status: 'submitted'
        });
        
        learned++;
      }
    }
    
    console.log(`[自学] 本轮提交 ${learned} 个问题`);
    return { learned, problems: problems.length };
  }

  /**
   * 获取学习统计
   */
  getStats() {
    return {
      totalProblems: this.problemPool.length,
      learned: this.learnHistory.filter(h => h.status === 'solved').length,
      pending: this.learnHistory.filter(h => h.status === 'submitted').length,
      history: this.learnHistory.slice(-10)
    };
  }
}

export { SelfLearner, BUILTIN_PROBLEMS };
