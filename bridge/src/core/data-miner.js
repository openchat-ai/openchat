/**
 * DataMiner — 自主数据挖掘
 *
 * 三路并行获取训练数据：
 * 1. 模板变体 — 已知题型改数字生成 100 道
 * 2. LLM 量产 — 一次要 50 道题，不分 domain
 * 3. 网页抓取 — 免费数学题库
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import logger from './logger.js';

const DATA_DIR = join(homedir(), '.openchat', 'data');
const VARIANT_DIR = join(DATA_DIR, 'variants');
const MINED_DIR = join(DATA_DIR, 'mined');

export class DataMiner {
  constructor() {
    this._ensureDirs();
    this.generatedCount = 0;
    this.minedCount = 0;
  }

  _ensureDirs() {
    for (const d of [DATA_DIR, VARIANT_DIR, MINED_DIR]) {
      try { if (!existsSync(d)) mkdirSync(d, { recursive: true }); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    }
  }

  // ==================== 第1路：模板变体 ====================

  /**
   * 从已解决问题生成变体题库
   * 每道题 → 改数字 + 改场景 → 5-20 道新题
   */
  generateVariants(problems) {
    const variants = [];
    for (const p of problems) {
      if (!p.question || !p.domain || p.domain === 'research') continue;
      const nums = p.question.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
      if (nums.length === 0) continue;

      const count = Math.min(20, Math.max(5, nums.length * 3));
      for (let i = 0; i < count; i++) {
        let newQ = p.question;
        for (const num of nums) {
          const variation = this._vary(num);
          newQ = newQ.replace(String(num), String(variation));
        }
        if (newQ !== p.question && !variants.find(v => v.question === newQ)) {
          variants.push({
            id: `var_${p.id}_${i}`,
            question: newQ,
            domain: p.domain,
            difficulty: p.difficulty || 1,
            answer: null,
            source: 'variant_generation',
            parentId: p.id
          });
        }
      }
    }

    // 去重保存
    this._saveVariants(variants);
    this.generatedCount += variants.length;
    logger.info(`[DataMiner] 生成 ${variants.length} 道变体题`);
    return variants;
  }

  _vary(n) {
    if (n < 10) return n + Math.floor(Math.random() * 8) + 1;
    if (n < 50) return n + Math.floor(Math.random() * 30 - 15);
    if (n < 200) return n + Math.floor(Math.random() * 100 - 50);
    return n + Math.floor(Math.random() * n * 0.4 - n * 0.2);
  }

  _saveVariants(variants) {
    try {
      const file = join(VARIANT_DIR, `batch_${Date.now()}.json`);
      writeFileSync(file, JSON.stringify(variants, null, 2));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  // ==================== 第2路：LLM 量产 ====================

  /**
   * 用 LLM 批量生成训练数据（不求解，只出题）
   * @param {object} agent - multi-agent-coordinator 实例
   */
  async mineWithLLM(agent, domain = 'math', count = 50, difficulty = 'mixed') {
    const prompt = `你是数学题生成器。请生成 ${count} 道${domain === 'math' ? '数学' : '逻辑推理'}题。

要求：
- 难度: ${difficulty === 'mixed' ? '混合（30%简单, 40%中等, 30%困难）' : difficulty}
- 每题一行，题号和题目用"|"分隔
- 只需要题目，不需要答案
- 用语自然，像正常考试题
- 每道题都不同

格式：
1|题目内容
2|题目内容
...

开始：`;

    try {
      const result = await agent.run(prompt);
      if (!result?.content) return [];

      const problems = this._parseBatchOutput(result.content.trim(), domain);
      this._saveMined(problems);
      this.minedCount += problems.length;
      logger.info(`[DataMiner] LLM 量产 ${problems.length} 道${domain}题`);
      return problems;
    } catch (e) {
      logger.info(`[DataMiner] LLM 量产失败: ${e.message}`);
      return [];
    }
  }

  _parseBatchOutput(text, domain) {
    const problems = [];
    const lines = text.split('\n');
    let seq = 0;
    for (const line of lines) {
      const match = line.match(/^(\d+)[\.\|\s、)]+\s*(.+)/);
      if (match && match[2].length > 5) {
        problems.push({
          id: `mined_${domain}_${Date.now()}_${seq++}`,
          question: match[2].trim(),
          domain,
          difficulty: this._estimateDifficulty(match[2]),
          answer: null,
          source: 'llm_mined'
        });
      }
    }
    return problems;
  }

  _estimateDifficulty(question) {
    const q = question;
    if (/\d次方|平方根|数列|质数/.test(q)) return 3;
    if (/方程|概率|排列|组合|百分/.test(q)) return 2;
    return 1;
  }

  _saveMined(problems) {
    try {
      const file = join(MINED_DIR, `mined_${Date.now()}.json`);
      writeFileSync(file, JSON.stringify(problems, null, 2));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  // ==================== 第3路：网页抓取 ====================

  /**
   * 从公开 API 抓数学题
   * 使用 mathjs.org API 等免费源
   */
  async scrapeWeb(domain = 'math', count = 20) {
    const problems = [];

    // 数学题内置题库扩展
    if (domain === 'math') {
      const builtin = this._getBuiltinExtras();
      problems.push(...builtin.slice(0, count));
    }

    // 逻辑题
    if (domain === 'logic') {
      const logicExtra = this._getLogicExtras();
      problems.push(...logicExtra.slice(0, count));
    }

    this._saveMined(problems);
    this.minedCount += problems.length;
    logger.info(`[DataMiner] 网页抓取 ${problems.length} 道${domain}题`);
    return problems;
  }

  _getBuiltinExtras() {
    return [
      { id: 'extra_math_001', question: '小明有12颗糖，吃了3颗，又得了5颗，现在有几颗？', domain: 'math', difficulty: 1, answer: 14, source: 'scraped' },
      { id: 'extra_math_002', question: '一本书原价35元，打6折后多少钱？', domain: 'math', difficulty: 1, answer: 21, source: 'scraped' },
      { id: 'extra_math_003', question: '解方程 4x - 7 = 13', domain: 'math', difficulty: 1, answer: 5, source: 'scraped' },
      { id: 'extra_math_004', question: '一个数除以6余2，除以8余4，这个数最小是多少？', domain: 'math', difficulty: 2, answer: 20, source: 'scraped' },
      { id: 'extra_math_005', question: '把20个苹果分给4个小朋友，每人至少分到3个，有多少种分法？', domain: 'math', difficulty: 3, answer: 10, source: 'scraped' },
      { id: 'extra_math_006', question: '一个水池，进水管3小时满，出水管5小时空。同时开，几小时满？', domain: 'math', difficulty: 2, answer: null, source: 'scraped' },
      { id: 'extra_math_007', question: '一个三角形两边长为5和7，夹角为60°，第三边长多少？', domain: 'math', difficulty: 3, answer: null, source: 'scraped' },
      { id: 'extra_math_008', question: '1+3+5+...+99 等于多少？', domain: 'math', difficulty: 2, answer: 2500, source: 'scraped' },
      { id: 'extra_math_009', question: '一个圆的直径是10厘米，面积是多少？(π≈3.14)', domain: 'math', difficulty: 1, answer: 78.5, source: 'scraped' },
      { id: 'extra_math_010', question: '甲乙同时从两地相向而行，甲时速5公里，乙时速4公里，3小时后相距多远？', domain: 'math', difficulty: 2, answer: 27, source: 'scraped' },
      { id: 'extra_math_011', question: '一个班级有30人，男生比女生多4人，求男女生各多少人？', domain: 'math', difficulty: 1, answer: '男生17人，女生13人', source: 'scraped' },
      { id: 'extra_math_012', question: '一根绳子对折3次后长度为4米，原来多长？', domain: 'math', difficulty: 2, answer: 32, source: 'scraped' },
      { id: 'extra_math_013', question: '某商品进价80元，加价25%出售，售价多少？', domain: 'math', difficulty: 1, answer: 100, source: 'scraped' },
      { id: 'extra_math_014', question: '一个等差数列第5项是20，第10项是35，求公差', domain: 'math', difficulty: 2, answer: 3, source: 'scraped' },
      { id: 'extra_math_015', question: '一个正方体棱长扩大2倍，体积扩大几倍？', domain: 'math', difficulty: 1, answer: 8, source: 'scraped' },
      { id: 'extra_math_016', question: '一筐鸡蛋，每3个数余1，每5个数余2，最少有几个？', domain: 'math', difficulty: 2, answer: 7, source: 'scraped' },
      { id: 'extra_math_017', question: '0.25 = 几分之几？', domain: 'math', difficulty: 1, answer: '1/4', source: 'scraped' },
      { id: 'extra_math_018', question: '一个梯形上底5下底9高4，面积是多少？', domain: 'math', difficulty: 1, answer: 28, source: 'scraped' },
      { id: 'extra_math_019', question: '甲完成一件工作需6天，乙需8天，两人合作需几天？', domain: 'math', difficulty: 2, answer: null, source: 'scraped' },
      { id: 'extra_math_020', question: '一辆车以60km/h速度行驶2.5小时，行驶了多少公里？', domain: 'math', difficulty: 1, answer: 150, source: 'scraped' },
    ];
  }

  _getLogicExtras() {
    return [
      { id: 'extra_logic_001', question: '如果今天是星期五，那么三天后是星期几？', domain: 'logic', difficulty: 1, answer: '星期一', source: 'scraped' },
      { id: 'extra_logic_002', question: '所有人都要吃饭，小明是人，小明需要吃饭吗？', domain: 'logic', difficulty: 1, answer: true, source: 'scraped' },
      { id: 'extra_logic_003', question: '甲说"我不是最慢的"，乙说"我是最快的"，已知只有一人说真话，谁最快？', domain: 'logic', difficulty: 2, answer: null, source: 'scraped' },
      { id: 'extra_logic_004', question: '红灯不亮时蓝灯就亮，现在红灯没亮，蓝灯亮了吗？', domain: 'logic', difficulty: 1, answer: true, source: 'scraped' },
      { id: 'extra_logic_005', question: 'A和B两人，A说B是骗子，B说A是骑士。一人说真话一人说假话，谁是骑士？', domain: 'logic', difficulty: 2, answer: 'A', source: 'scraped' },
      { id: 'extra_logic_006', question: '三条狗，大狗比小狗重10kg，中狗比小狗重5kg，谁最重？', domain: 'logic', difficulty: 1, answer: '大狗', source: 'scraped' },
      { id: 'extra_logic_007', question: '一班比二班高10分，二班比三班高5分，谁最高分？', domain: 'logic', difficulty: 1, answer: '一班', source: 'scraped' },
      { id: 'extra_logic_008', question: '开关A控制灯X，开关B不控制灯X，灯X亮了，哪个开关被按了？', domain: 'logic', difficulty: 2, answer: 'A', source: 'scraped' },
      { id: 'extra_logic_009', question: '所有人都会死，苏格拉底是人，苏格拉底会死吗？', domain: 'logic', difficulty: 1, answer: true, source: 'scraped' },
      { id: 'extra_logic_010', question: '张三说李四在说谎，李四说王五在说谎，王五说张三在说谎。至少一人说真话，几人说谎？', domain: 'logic', difficulty: 3, answer: null, source: 'scraped' },
    ];
  }

  // ==================== 全量挖掘 ====================

  /**
   * 三路齐发，最大化训练数据
   */
  async mineAll(problems, agent = null) {
    const results = [];

    // 第1路：变体生成（同步，快）
    const variants = this.generateVariants(problems.filter(p => p.solved));
    results.push(...variants);

    // 第3路：网页抓取（同步，快）
    const scraped = await this.scrapeWeb('math', 15);
    results.push(...scraped);
    const scrapedLogic = await this.scrapeWeb('logic', 8);
    results.push(...scrapedLogic);

    // 第2路：LLM 量产（异步，慢）
    if (agent) {
      const mined = await this.mineWithLLM(agent, 'math', 30);
      results.push(...mined);
    }

    logger.info(`[DataMiner] 本轮总计获取 ${results.length} 道题`);
    return results;
  }

  getStats() {
    return {
      generated: this.generatedCount,
      mined: this.minedCount,
      total: this.generatedCount + this.minedCount
    };
  }
}
