/**
 * NeuralBrain — 系统自己的神经网络
 *
 * 纯 JavaScript 实现，零依赖。
 * 喂数据 → 训练 → 学会自己判断问题难度/分类/策略选择。
 *
 * 架构：输入层(64) → 隐藏层(32) → 输出层(8)
 * 激活：ReLU(隐藏) / Softmax(输出)
 * 优化：SGD + 交叉熵损失
 */

import logger from '../logger.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const BRAIN_DIR = join(homedir(), '.openchat', 'brain');
const WEIGHTS_FILE = join(BRAIN_DIR, 'weights.json');
const TRAINING_LOG = join(BRAIN_DIR, 'training-log.json');

export class NeuralBrain {
  constructor(inputSize = 64, hiddenSize = 32, outputSize = 8) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;

    // 权重矩阵
    this.W1 = this._initMatrix(inputSize, hiddenSize);   // input → hidden
    this.b1 = new Array(hiddenSize).fill(0);
    this.W2 = this._initMatrix(hiddenSize, outputSize);  // hidden → output
    this.b2 = new Array(outputSize).fill(0);

    this.trainingSamples = 0;
    this.epochs = 0;
    this.accuracy = 0;

    this._ensureDir();
    this._loadWeights();
  }

  _ensureDir() {
    try { if (!existsSync(BRAIN_DIR)) mkdirSync(BRAIN_DIR, { recursive: true }); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  _initMatrix(rows, cols) {
    const m = [];
    for (let i = 0; i < rows; i++) {
      m[i] = [];
      for (let j = 0; j < cols; j++) {
        m[i][j] = (Math.random() - 0.5) * Math.sqrt(2.0 / rows);
      }
    }
    return m;
  }

  /**
   * 把问题文本转换成数字向量
   */
  vectorize(question) {
    const vec = new Array(this.inputSize).fill(0);
    if (!question) return vec;

    const q = question.toLowerCase();

    // 特征1-20: 字符 n-gram 哈希
    for (let i = 0; i < q.length - 2; i++) {
      const trigram = q.charCodeAt(i) * 256 + q.charCodeAt(i + 2);
      vec[trigram % this.inputSize]++;
    }

    // 特征21-30: 结构特征
    vec[20] = (q.match(/\d+/g) || []).length;          // 数字数量
    vec[21] = q.includes('?') || q.includes('？') ? 1 : 0;
    vec[22] = q.includes('如果') || q.includes('if') ? 1 : 0;
    vec[23] = q.includes('所有') ? 1 : 0;
    vec[24] = q.includes('概率') ? 1 : 0;
    vec[25] = q.includes('方程') || q.includes('x=') ? 1 : 0;
    vec[26] = q.includes('面积') || q.includes('体积') ? 1 : 0;
    vec[27] = q.includes('最大公约') || q.includes('最小公倍') ? 1 : 0;
    vec[28] = q.includes('质数') ? 1 : 0;
    vec[29] = q.includes('说谎') || q.includes('真话') ? 1 : 0;

    // 特征31-35: 问题长度分桶
    const len = q.length;
    vec[30] = len < 20 ? 1 : 0;
    vec[31] = len < 40 ? 1 : 0;
    vec[32] = len < 80 ? 1 : 0;
    vec[33] = len < 150 ? 1 : 0;
    vec[34] = len >= 150 ? 1 : 0;

    // 特征36-45: 第一个和最后一个字符编码
    vec[35] = (q.charCodeAt(0) || 0) / 65536;
    vec[36] = (q.charCodeAt(q.length - 1) || 0) / 65536;

    // 归一化
    const max = Math.max(...vec) || 1;
    for (let i = 0; i < vec.length; i++) {
      vec[i] = vec[i] / max;
    }

    return vec;
  }

  /**
   * 前向传播
   * @returns {{ hidden, output }}
   */
  forward(input) {
    // W1 * input + b1
    const hidden = new Array(this.hiddenSize).fill(0);
    for (let j = 0; j < this.hiddenSize; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < this.inputSize; i++) {
        sum += this.W1[i][j] * input[i];
      }
      hidden[j] = this._relu(sum);
    }

    // W2 * hidden + b2
    const output = new Array(this.outputSize).fill(0);
    for (let j = 0; j < this.outputSize; j++) {
      let sum = this.b2[j];
      for (let i = 0; i < this.hiddenSize; i++) {
        sum += this.W2[i][j] * hidden[i];
      }
      output[j] = sum;
    }

    return { hidden, output: this._softmax(output) };
  }

  _relu(x) { return x > 0 ? x : 0; }
  _reluDeriv(x) { return x > 0 ? 1 : 0; }

  _softmax(arr) {
    const max = Math.max(...arr);
    const exp = arr.map(x => Math.exp(x - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(x => x / sum);
  }

  /**
   * 训练一个样本
   */
  train(input, target, learningRate = 0.01) {
    const { hidden, output } = this.forward(input);

    // 输出层误差
    const outputError = new Array(this.outputSize);
    for (let j = 0; j < this.outputSize; j++) {
      outputError[j] = output[j] - target[j];
    }

    // 隐藏层误差
    const hiddenError = new Array(this.hiddenSize).fill(0);
    for (let i = 0; i < this.hiddenSize; i++) {
      for (let j = 0; j < this.outputSize; j++) {
        hiddenError[i] += outputError[j] * this.W2[i][j];
      }
      hiddenError[i] *= this._reluDeriv(hidden[i]);
    }

    // 更新 W2
    for (let i = 0; i < this.hiddenSize; i++) {
      for (let j = 0; j < this.outputSize; j++) {
        this.W2[i][j] -= learningRate * outputError[j] * hidden[i];
      }
    }
    for (let j = 0; j < this.outputSize; j++) {
      this.b2[j] -= learningRate * outputError[j];
    }

    // 更新 W1
    for (let i = 0; i < this.inputSize; i++) {
      for (let j = 0; j < this.hiddenSize; j++) {
        this.W1[i][j] -= learningRate * hiddenError[j] * input[i];
      }
    }
    for (let j = 0; j < this.hiddenSize; j++) {
      this.b1[j] -= learningRate * hiddenError[j];
    }

    this.trainingSamples++;
  }

  /**
   * 预测：返回各类别的概率
   */
  predict(question) {
    const input = this.vectorize(question);
    const { output } = this.forward(input);
    return output;
  }

  /**
   * 预测难度 (0-3)
   */
  predictDifficulty(question) {
    const output = this.predict(question);
    return Math.round(output.slice(0, 4).reduce((s, p, i) => s + p * i, 0));
  }

  /**
   * 预测领域: math=0, logic=1, research=2, code_review=3
   */
  predictDomain(question) {
    const output = this.predict(question);
    const domains = ['math', 'logic', 'research', 'code_review'];
    const idx = output.slice(4).indexOf(Math.max(...output.slice(4)));
    return domains[idx % domains.length] || 'math';
  }

  /**
   * 判断推理引擎能否自己解决
   */
  canSolveLocally(question) {
    const output = this.predict(question);
    return output[4] > 0.5; // 输出层第5个神经元 = 可本地解决概率
  }

  /**
   * 用已解决问题批量训练
   */
  trainOnSolvedProblems(problems) {
    let correct = 0, total = 0;
    for (const problem of problems) {
      if (!problem.question || !problem.domain) continue;

      const input = this.vectorize(problem.question);

      // 目标向量: [难度one-hot(4), 领域one-hot(4)]
      const target = new Array(8).fill(0);
      const diff = Math.min(3, Math.max(0, problem.difficulty || 1));
      target[diff] = 1;
      const domainMap = { math: 4, logic: 5, research: 6, code_review: 7 };
      const domainSlot = domainMap[problem.domain] || 5;
      target[domainSlot] = 1;

      this.train(input, target, 0.005);

      const pred = this.predict(problem.question);
      const predDomain = pred.slice(4).indexOf(Math.max(...pred.slice(4)));
      const trueDomain = domainSlot - 4;
      if (predDomain === trueDomain) correct++;
      total++;
    }

    this.epochs++;
    this.accuracy = total > 0 ? correct / total : 0;
    this._saveWeights();
    this._logTraining();

    return { accuracy: this.accuracy, samples: this.trainingSamples, epochs: this.epochs };
  }

  _saveWeights() {
    try {
      writeFileSync(WEIGHTS_FILE, JSON.stringify({
        W1: this.W1, b1: this.b1,
        W2: this.W2, b2: this.b2,
        samples: this.trainingSamples,
        epochs: this.epochs,
        accuracy: this.accuracy
      }));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  _loadWeights() {
    try {
      if (existsSync(WEIGHTS_FILE)) {
        const data = JSON.parse(readFileSync(WEIGHTS_FILE, 'utf8'));
        if (data.W1 && data.W1.length === this.inputSize) {
          this.W1 = data.W1; this.b1 = data.b1;
          this.W2 = data.W2; this.b2 = data.b2;
          this.trainingSamples = data.samples || 0;
          this.epochs = data.epochs || 0;
          this.accuracy = data.accuracy || 0;
          return true;
        }
      }
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return false;
  }

  _logTraining() {
    try {
      let log = [];
      if (existsSync(TRAINING_LOG)) {
        log = JSON.parse(readFileSync(TRAINING_LOG, 'utf8'));
      }
      log.push({ samples: this.trainingSamples, accuracy: this.accuracy, time: Date.now() });
      if (log.length > 100) log = log.slice(-100);
      writeFileSync(TRAINING_LOG, JSON.stringify(log));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  getStats() {
    return {
      architecture: `${this.inputSize}→${this.hiddenSize}→${this.outputSize}`,
      samples: this.trainingSamples,
      epochs: this.epochs,
      accuracy: (this.accuracy * 100).toFixed(1) + '%',
      weights: this.W1.reduce((s, r) => s + r.length, 0)
    };
  }
}
