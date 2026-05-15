import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const WISDOM_DIR = join(homedir(), '.openchat', 'wisdom');
const PATHS_FILE = join(WISDOM_DIR, 'thinking-paths.json');
const DEAD_ENDS_FILE = join(WISDOM_DIR, 'dead-ends.json');

const THINKING_STYLES = {
  curiosity: {
    name: '联想式',
    nameEn: 'Associative',
    icon: '🔍',
    description: '从问题联想到已知，用类比推导',
    steps: ['联想相似问题', '提取可迁移规律', '应用到当前问题'],
    trait: 'curiosity',
    preferredStrategies: ['analogy', 'pattern_match', 'backward_reasoning']
  },
  courage: {
    name: '冲击式',
    nameEn: 'Aggressive',
    icon: '⚡',
    description: '直接上手，先试再说',
    steps: ['选择最直接的解法', '快速计算', '检验结果'],
    trait: 'courage',
    preferredStrategies: ['direct_formula', 'equation_method', 'enumeration']
  },
  creativity: {
    name: '逆向式',
    nameEn: 'Reverse',
    icon: '🔄',
    description: '反过来想，从结果推原因',
    steps: ['假设答案已知', '逆推必要条件', '验证充分性'],
    trait: 'creativity',
    preferredStrategies: ['backward_reasoning', 'logic_deduction', 'analogy']
  },
  diligence: {
    name: '分解式',
    nameEn: 'Decomposition',
    icon: '🔧',
    description: '拆成小问题，逐步解决',
    steps: ['识别子问题', '逐个击破', '组合结果'],
    trait: 'diligence',
    preferredStrategies: ['equation_method', 'number_theory', 'enumeration']
  },
  sociability: {
    name: '借鉴式',
    nameEn: 'Borrowing',
    icon: '🤝',
    description: '先看别人怎么解的，站在前人肩膀上',
    steps: ['搜索社区智慧', '选择最佳路径', '融合适配'],
    trait: 'sociability',
    preferredStrategies: ['pattern_match', 'analogy']
  }
};

export class ThinkingPath {
  constructor(port = 0) {
    this.paths = [];
    this.deadEnds = [];
    this.port = port;
    this._syncTimer = null;
    if (port) {
      this._pathsFile = join(WISDOM_DIR, 'thinking-paths-' + port + '.json');
      this._deadEndsFile = join(WISDOM_DIR, 'dead-ends-' + port + '.json');
    } else {
      this._pathsFile = PATHS_FILE;
      this._deadEndsFile = DEAD_ENDS_FILE;
    }
    this._load();
    this._startCrossBridgeSync();
  }

  create({ residentId, residentTraits, problem, steps, answer, strategyId, verified }) {
    const path = {
      id: 'path_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      residentId,
      residentTraits: residentTraits || {},
      problemId: problem.id,
      problemQuestion: problem.question,
      domain: problem.domain,
      thinkingStyle: this._determineStyle(residentTraits),
      steps: steps || [],
      answer: answer,
      strategyId: strategyId || null,
      verified: verified || false,
      verifications: [],
      adoptedBy: [],
      createdAt: Date.now()
    };
    this.paths.push(path);
    this._save();
    return path;
  }

  _determineStyle(traits) {
    if (!traits) return 'courage';
    const entries = Object.entries(traits);
    entries.sort((a, b) => b[1] - a[1]);
    const dominant = entries[0][0];
    return THINKING_STYLES[dominant] ? dominant : 'courage';
  }

  getThinkingStyle(traits) {
    const key = this._determineStyle(traits);
    return THINKING_STYLES[key];
  }

  getPreferredStrategies(traits) {
    const style = this.getThinkingStyle(traits);
    return style.preferredStrategies;
  }

  generateSteps(traits, problem, strategyId) {
    const style = this.getThinkingStyle(traits);
    const steps = [];

    steps.push({
      type: 'think',
      style: style.name,
      thought: style.steps[0] + '：' + problem.question.substring(0, 30) + '...'
    });

    if (strategyId) {
      const strategyNames = {
        direct_formula: '公式法', equation_method: '方程法', number_theory: '数论法',
        backward_reasoning: '逆推法', analogy: '类比法', logic_deduction: '逻辑推演法',
        enumeration: '穷举法', pattern_match: '模式匹配法'
      };
      steps.push({
        type: 'execute',
        strategy: strategyId,
        thought: '选用' + (strategyNames[strategyId] || strategyId) + '求解'
      });
    }

    steps.push({
      type: 'verify',
      thought: style.steps[style.steps.length - 1]
    });

    return steps;
  }

  verify(pathId, verifierId, agreed, alternativeAnswer) {
    const path = this.paths.find(p => p.id === pathId);
    if (!path) return null;

    path.verifications.push({
      verifierId,
      agreed,
      alternativeAnswer: alternativeAnswer || null,
      timestamp: Date.now()
    });

    if (!agreed) {
      path.verified = false;
    } else {
      const agreeCount = path.verifications.filter(v => v.agreed).length;
      const disagreeCount = path.verifications.filter(v => !v.agreed).length;
      path.verified = agreeCount > disagreeCount;
    }

    this._save();
    return path;
  }

  markAsDeadEnd(pathId, reason) {
    const path = this.paths.find(p => p.id === pathId);
    if (!path) return;

    this.deadEnds.push({
      originalPathId: pathId,
      problemId: path.problemId,
      domain: path.domain,
      thinkingStyle: path.thinkingStyle,
      failedSteps: path.steps,
      failureReason: reason,
      residentId: path.residentId,
      createdAt: Date.now()
    });

    path.verified = false;
    this._save();
  }

  searchWisdom(problem, domain) {
    const q = problem.question || problem;
    const results = [];

    for (const p of this.paths) {
      if (domain && p.domain !== domain) continue;
      if (!p.verified) continue;

      let relevance = 0;
      const kw = q.match(/[\u4e00-\u9fff]+/g) || [];
      for (const w of kw) {
        if (p.problemQuestion && p.problemQuestion.includes(w)) relevance++;
      }

      if (relevance > 0) {
        results.push({
          pathId: p.id,
          problemQuestion: p.problemQuestion,
          answer: p.answer,
          steps: p.steps,
          thinkingStyle: p.thinkingStyle,
          strategyId: p.strategyId,
          relevance,
          adoptedCount: p.adoptedBy.length
        });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, 10);
  }

  searchDeadEnds(problem, domain) {
    const q = problem.question || problem;
    const results = [];

    for (const d of this.deadEnds) {
      if (domain && d.domain !== domain) continue;

      let relevance = 0;
      const kw = q.match(/[\u4e00-\u9fff]+/g) || [];
      for (const w of kw) {
        if (d.problemId && q.includes(w)) relevance++;
      }

      if (relevance > 0) {
        results.push({
          deadEndId: d.originalPathId,
          failureReason: d.failureReason,
          thinkingStyle: d.thinkingStyle,
          relevance
        });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, 5);
  }

  adopt(pathId, residentId) {
    const path = this.paths.find(p => p.id === pathId);
    if (!path) return;
    if (!path.adoptedBy.includes(residentId)) {
      path.adoptedBy.push(residentId);
      this._save();
    }
  }

  getCommunityStats() {
    const byStyle = {};
    for (const key of Object.keys(THINKING_STYLES)) {
      byStyle[key] = {
        name: THINKING_STYLES[key].name,
        nameEn: THINKING_STYLES[key].nameEn,
        icon: THINKING_STYLES[key].icon,
        paths: 0,
        verified: 0,
        deadEnds: 0,
        adoptions: 0
      };
    }

    for (const p of this.paths) {
      const style = p.thinkingStyle || 'courage';
      if (byStyle[style]) {
        byStyle[style].paths++;
        if (p.verified) byStyle[style].verified++;
        byStyle[style].adoptions += p.adoptedBy.length;
      }
    }

    for (const d of this.deadEnds) {
      const style = d.thinkingStyle || 'courage';
      if (byStyle[style]) byStyle[style].deadEnds++;
    }

    return {
      totalPaths: this.paths.length,
      totalVerified: this.paths.filter(p => p.verified).length,
      totalDeadEnds: this.deadEnds.length,
      totalAdoptions: this.paths.reduce((a, p) => a + p.adoptedBy.length, 0),
      byStyle
    };
  }

  _load() {
    try {
      if (existsSync(this._pathsFile || PATHS_FILE)) {
        this.paths = JSON.parse(readFileSync(this._pathsFile || PATHS_FILE, 'utf8'));
      }
      if (existsSync(this._deadEndsFile || DEAD_ENDS_FILE)) {
        this.deadEnds = JSON.parse(readFileSync(this._deadEndsFile || DEAD_ENDS_FILE, 'utf8'));
      }
    } catch {}
  }

  _save() {
    try {
      if (!existsSync(WISDOM_DIR)) mkdirSync(WISDOM_DIR, { recursive: true });
      writeFileSync(this._pathsFile, JSON.stringify(this.paths.slice(-500), null, 2));
      writeFileSync(this._deadEndsFile, JSON.stringify(this.deadEnds.slice(-200), null, 2));
    } catch {}
  }

  _startCrossBridgeSync() {
    const BRIDGE_PORTS = process.env.BRIDGE_PORTS ? process.env.BRIDGE_PORTS.split(',').map(Number) : [];
    const sync = () => {
      for (const p of BRIDGE_PORTS) {
        if (p === this.port) continue;
        const otherFile = join(WISDOM_DIR, 'thinking-paths-' + p + '.json');
        try {
          if (existsSync(otherFile)) {
            const other = JSON.parse(readFileSync(otherFile, 'utf8'));
            for (const path of other) {
              if (!this.paths.find(pp => pp.id === path.id)) {
                this.paths.push(path);
              }
            }
          }
        } catch {}
      }
      const otherDeadEnds = [];
      for (const p of BRIDGE_PORTS) {
        if (p === this.port) continue;
        const otherFile = join(WISDOM_DIR, 'dead-ends-' + p + '.json');
        try {
          if (existsSync(otherFile)) {
            const other = JSON.parse(readFileSync(otherFile, 'utf8'));
            for (const de of other) {
              if (!this.deadEnds.find(d => d.originalPathId === de.originalPathId)) {
                otherDeadEnds.push(de);
              }
            }
          }
        } catch {}
      }
      this.deadEnds = this.deadEnds.concat(otherDeadEnds);
      if (this.paths.length > 500) this.paths = this.paths.slice(-500);
      if (this.deadEnds.length > 200) this.deadEnds = this.deadEnds.slice(-200);
    };
    this._syncTimer = setInterval(sync, 30000);
    setTimeout(sync, 5000);
  }
}

export { THINKING_STYLES };
