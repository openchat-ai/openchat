/**
 * SelfEvolution — 自我进化引擎
 *
 * 不再是"解N题=IQ涨2点"的假增长
 * IQ = f(速度, 正确率, 解题难度, 策略多样性)
 * 每轮自动优化 Agent prompt
 */

import logger from '../monitoring/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const EVO_DIR = join(homedir(), '.openchat', 'evolution');
const STRATEGY_STATS_FILE = join(EVO_DIR, 'strategy-stats.json');
const PROMPT_VERSIONS_FILE = join(EVO_DIR, 'prompt-versions.json');

export class SelfEvolution {
  constructor() {
    this._ensureDir();
    this.strategies = this._load(STRATEGY_STATS_FILE, {});
    this.promptVersions = this._load(PROMPT_VERSIONS_FILE, []);
    this._solveTimes = [];        // 最近 N 轮求解耗时
    this._correctCount = 0;      // 正确次数
    this._totalVerified = 0;     // 已验证总数
  }

  _ensureDir() {
    try { if (!existsSync(EVO_DIR)) mkdirSync(EVO_DIR, { recursive: true }); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  _load(file, fallback) {
    try {
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return fallback;
  }

  _save(file, data) {
    try { writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  /**
   * 记录一次求解结果
   * @returns {object} 策略分析报告
   */
  recordSolve(problem, answer, timeMs, isCorrect, strategyName, residentName) {
    const key = strategyName || 'unknown';
    if (!this.strategies[key]) {
      this.strategies[key] = { name: key, attempts: 0, correct: 0, totalTime: 0, minTime: Infinity, maxTime: 0, domains: {}, lastUsed: null };
    }
    const s = this.strategies[key];
    s.attempts++;
    if (isCorrect) s.correct++;
    s.totalTime += timeMs;
    if (timeMs < s.minTime) s.minTime = timeMs;
    if (timeMs > s.maxTime) s.maxTime = timeMs;
    s.lastUsed = Date.now();
    s.domains[problem.domain] = (s.domains[problem.domain] || 0) + 1;
    s.lastResident = residentName;

    this._solveTimes.push({ time: timeMs, correct: isCorrect, domain: problem.domain, difficulty: problem.difficulty || 1 });
    if (this._solveTimes.length > 200) this._solveTimes = this._solveTimes.slice(-200);

    if (isCorrect) this._correctCount++;
    this._totalVerified++;

    this._save(STRATEGY_STATS_FILE, this.strategies);

    return this.analyzeStrategy(key);
  }

  /**
   * 分析单个策略的表现
   */
  analyzeStrategy(name) {
    const s = this.strategies[name];
    if (!s) return null;
    const accuracy = s.attempts > 0 ? s.correct / s.attempts : 0;
    const avgTime = s.attempts > 0 ? s.totalTime / s.attempts : 0;
    const domainSpread = Object.keys(s.domains).length;
    return { name, accuracy, avgTime, attempts: s.attempts, correct: s.correct, domainSpread, bestDomain: Object.entries(s.domains).sort((a, b) => b[1] - a[1])[0]?.[0] };
  }

  /**
   * 计算真实IQ：不再只是 solvedCount*2
   * 公式：base(100) + 正确率分 + 速度分 + 难度分 + 策略多样性分
   */
  computeRealIQ(solvedCount) {
    if (this._totalVerified === 0) return 100 + solvedCount * 2;

    const recent = this._solveTimes.slice(-50);
    if (recent.length === 0) return 100 + solvedCount * 2;

    const accuracy = this._correctCount / Math.max(this._totalVerified, 1);

    const avgTime = recent.reduce((s, r) => s + r.time, 0) / recent.length;
    const speedScore = avgTime < 3000 ? 30 : avgTime < 5000 ? 20 : avgTime < 10000 ? 10 : 0;

    const avgDifficulty = recent.reduce((s, r) => s + (r.difficulty || 1), 0) / recent.length;
    const diffScore = avgDifficulty >= 3 ? 30 : avgDifficulty >= 2 ? 15 : 0;

    const uniqueStrategies = Object.values(this.strategies).filter(s => s.attempts > 0).length;
    const diversityScore = uniqueStrategies >= 5 ? 20 : uniqueStrategies >= 3 ? 10 : 0;

    const iq = Math.round(100 + accuracy * 100 + speedScore + diffScore + diversityScore);
    return Math.min(999, iq);
  }

  /**
   * 自动生成优化后的 prompt 模板
   * 根据历史表现选择最佳策略组合
   */
  generateOptimizedPrompt(basePrompt, domain) {
    const topStrategies = Object.values(this.strategies)
      .filter(s => s.attempts >= 3)
      .sort((a, b) => {
        const aAcc = a.correct / a.attempts;
        const bAcc = b.correct / b.attempts;
        return bAcc - aAcc;
      })
      .slice(0, 3);

    let strategyGuide = '';
    if (topStrategies.length > 0) {
      strategyGuide = '\n\n## 进化经验（根据历史自动提炼）\n';
      strategyGuide += `当前最优策略（按正确率排序）：\n`;
      for (const s of topStrategies) {
        const acc = (s.correct / s.attempts * 100).toFixed(0);
        const avgMs = (s.totalTime / s.attempts).toFixed(0);
        const domains = Object.keys(s.domains).join('、') || '通用';
        strategyGuide += `- ${s.name}: 正确率${acc}% 平均${avgMs}ms 擅长:${domains}\n`;
      }
      strategyGuide += '\n请优先使用正确率最高的策略。如果当前问题匹配策略擅长领域，直接使用该策略。\n';
    }

    return basePrompt + strategyGuide;
  }

  /**
   * 获取所有策略排名
   */
  getRankings() {
    return Object.values(this.strategies)
      .filter(s => s.attempts > 0)
      .map(s => ({ ...s, accuracy: s.correct / s.attempts }))
      .sort((a, b) => b.accuracy - a.accuracy);
  }

  /**
   * 获取进化摘要
   */
  getSummary() {
    return {
      totalSolves: this._totalVerified,
      correct: this._correctCount,
      accuracy: this._totalVerified > 0 ? (this._correctCount / this._totalVerified * 100).toFixed(1) + '%' : 'N/A',
      avgTime: this._solveTimes.length > 0 ? (this._solveTimes.reduce((s, r) => s + r.time, 0) / this._solveTimes.length).toFixed(0) + 'ms' : 'N/A',
      strategies: this.getRankings().length,
      topStrategies: this.getRankings().slice(0, 3).map(s => `${s.name}(${(s.accuracy*100).toFixed(0)}%)`),
      iq: this.computeRealIQ(this._totalVerified)
    };
  }
}
