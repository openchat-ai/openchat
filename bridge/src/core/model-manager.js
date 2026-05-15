/**
 * ModelManager — 领域分模型管理器
 *
 * 每领域一个 NeuralBrain 实例，独立训练、独立权重。
 * 分布式：每个 Fairy 训练自己的领域模型，NeuralMesh 跨节点联邦平均。
 *
 * 领域：math, logic, code, visual, network, ai, solve
 */

import { NeuralBrain } from './neural-brain.js';
import { join } from 'path';
import { homedir } from 'os';
import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { EventEmitter } from 'events';

const BRAIN_DIR = join(homedir(), '.openchat', 'brain');

const DOMAINS = ['math', 'logic', 'code', 'visual', 'network', 'ai', 'solve', 'general'];

export class ModelManager extends EventEmitter {
  constructor() {
    super();
    this.models = new Map();  // domain → NeuralBrain
    this.stats = new Map();    // domain → { samples, accuracy, epochs, lastTrain }
    this._ensureDir();
    this._loadAll();
  }

  _ensureDir() {
    try { if (!existsSync(BRAIN_DIR)) mkdirSync(BRAIN_DIR, { recursive: true }); } catch {}
  }

  // ── 加载/保存 ──

  _modelFile(domain) {
    return join(BRAIN_DIR, `model_${domain}.json`);
  }

  _loadAll() {
    for (const domain of DOMAINS) {
      const file = this._modelFile(domain);
      if (existsSync(file)) {
        try {
          const nn = new NeuralBrain(64, 32, 8, file);
          this.models.set(domain, nn);
          this.stats.set(domain, {
            samples: nn.trainingSamples,
            accuracy: nn.accuracy,
            epochs: nn.epochs,
          });
        } catch {}
      }
    }
  }

  _save(domain, nn) {
    const data = {
      W1: nn.W1, b1: nn.b1,
      W2: nn.W2, b2: nn.b2,
      trainingSamples: nn.trainingSamples,
      epochs: nn.epochs,
      accuracy: nn.accuracy,
      domain,
    };
    writeFileSync(this._modelFile(domain), JSON.stringify(data));
  }

  // ── 领域路由 ──

  /** 从 task 文本推断领域 */
  classifyDomain(task) {
    const t = (task || '').toLowerCase();
    if (t.includes('math') || t.includes('数学') || t.includes('计算') || t.includes('概率') || t.includes('数') && (t.includes('+') || t.includes('×') || t.includes('÷'))) return 'math';
    if (t.includes('code') || t.includes('代码') || t.includes('编程') || t.includes('python') || t.includes('javascript') || t.includes('写') && (t.includes('函数') || t.includes('类'))) return 'code';
    if (t.includes('logic') || t.includes('逻辑') || t.includes('推理') || t.includes('如果') || t.includes('证明')) return 'logic';
    if (t.includes('visual') || t.includes('可视化') || t.includes('图像') || t.includes('图') || t.includes('ui') || t.includes('界面')) return 'visual';
    if (t.includes('network') || t.includes('网络') || t.includes('p2p') || t.includes('swarm') || t.includes('peer')) return 'network';
    if (t.includes('ai') || t.includes('模型') || t.includes('机器学习') || t.includes('训练') || t.includes('推理')) return 'ai';
    if (t.includes('问题') || t.includes('解决') || t.includes('方案')) return 'solve';
    return 'general';
  }

  /** 获取或创建领域模型 */
  getOrCreate(domain) {
    let nn = this.models.get(domain);
    if (!nn) {
      nn = new NeuralBrain(64, 32, 8, this._modelFile(domain));
      this.models.set(domain, nn);
      this.stats.set(domain, { samples: nn.trainingSamples, accuracy: nn.accuracy, epochs: nn.epochs });
      this.emit('newModel', domain);
    }
    return nn;
  }

  // ── 训练 ──

  /** 喂一条解题记录训练对应领域模型 */
  train(problem, answer, solverName) {
    if (!problem) return;
    const domain = problem.domain || this.classifyDomain(problem.question || problem.task || '');
    const nn = this.getOrCreate(domain);

    const input = nn.vectorize(problem.question || problem.task || '');
    const target = new Array(8).fill(0);
    target[4] = 1;  // Simple domain-classification target
    nn.train(input, target, 0.01);
    this._save(domain, nn);

    const stat = this.stats.get(domain);
    stat.samples = nn.trainingSamples;
    stat.accuracy = nn.accuracy;
    stat.epochs = nn.epochs;

    this.emit('trained', { domain, samples: nn.trainingSamples, accuracy: nn.accuracy });
  }

  /** 批量训练（从经验文件） */
  trainBatch(problems) {
    if (!problems || !problems.length) return;
    // Use NeuralBrain's built-in batch training
    const byDomain = {};
    for (const p of problems) {
      const domain = p.domain || this.classifyDomain(p.question || p.task || '');
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(p);
    }
    for (const [domain, batch] of Object.entries(byDomain)) {
      const nn = this.getOrCreate(domain);
      nn.trainOnSolvedProblems(batch);
      this._save(domain, nn);
      const stat = this.stats.get(domain);
      stat.samples = nn.trainingSamples;
      stat.accuracy = nn.accuracy;
      stat.epochs = nn.epochs;
    }
    this.emit('batchTrained', this.stats);
  }

  // ── 预测 ──

  predictDifficulty(problem) {
    const domain = problem.domain || this.classifyDomain(problem.question || '');
    const nn = this.models.get(domain) || this.models.get('general');
    if (!nn) return { difficulty: 1, domain };
    return { difficulty: nn.predictDifficulty(problem.question || ''), domain };
  }

  // ── 统计 ──

  getStats() {
    const result = {};
    for (const [domain, stat] of this.stats) {
      result[domain] = {
        samples: stat.samples,
        accuracy: stat.accuracy,
        epochs: stat.epochs,
        hasModel: this.models.has(domain),
        weightsKB: this.models.has(domain) ? Math.round(JSON.stringify(this.models.get(domain).W1).length / 1024) : 0,
      };
    }
    // 添加活跃领域（有模型的）
    const total = { samples: 0, models: 0 };
    for (const [, s] of Object.entries(result)) {
      total.samples += s.samples || 0;
      if (s.hasModel) total.models++;
    }
    return { domains: result, total };
  }

  // ── 内部 ──

  _vectorize(text) {
    const t = (text || '').slice(0, 200);
    const vec = new Array(64).fill(0);
    // Trigram hash
    for (let i = 0; i < t.length - 2; i++) {
      const hash = (t.charCodeAt(i) * 31 + t.charCodeAt(i + 1) * 127 + t.charCodeAt(i + 2) * 251) % 20;
      vec[hash] += 1;
    }
    // Structural features
    const lt = t.toLowerCase();
    if (/[0-9]/.test(lt)) vec[20] = 1;
    if (lt.includes('?') || lt.includes('？')) vec[21] = 1;
    if (lt.includes('如果') || lt.includes('假设')) vec[22] = 1;
    if (lt.includes('概率')) vec[23] = 1;
    if (lt.includes('方程') || lt.includes('等式')) vec[24] = 1;
    if (lt.includes('面积') || lt.includes('体积')) vec[25] = 1;
    // Length buckets
    const len = t.length;
    if (len < 20) vec[30] = 1;
    else if (len < 40) vec[31] = 1;
    else if (len < 80) vec[32] = 1;
    else if (len < 150) vec[33] = 1;
    else vec[34] = 1;
    // Normalize
    const max = Math.max(1, ...vec);
    for (let i = 0; i < 40; i++) vec[i] /= max;
    return vec;
  }
}

export default ModelManager;
