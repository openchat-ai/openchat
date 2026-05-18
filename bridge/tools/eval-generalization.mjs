#!/usr/bin/env node
/**
 * Generalization Evaluation Harness
 * 泛化效果评估工具
 *
 * Compares responses WITH vs WITHOUT generalization using LLM-as-judge.
 * Uses SiliconFlow API (China-friendly, free Qwen models) or OpenRouter.
 * 通过 SiliconFlow 或 OpenRouter 运行。支持国产模型。
 *
 * Usage: node tools/eval-generalization.mjs [--questions N]
 *   --questions: how many test questions to run (default 5, max 10)
 *
 * Requires: SILICONFLOW_API_KEY or OPENROUTER_API_KEY env var
 * 需要设置环境变量 SILICONFLOW_API_KEY 或 OPENROUTER_API_KEY
 */

// ---- Configuration / 配置 ----
const GENERATE_MODEL = 'Qwen/Qwen2.5-72B-Instruct'; // Response model / 回答模型 (strong)
const EVAL_MODEL = 'Qwen/Qwen2.5-72B-Instruct';    // Judge model / 打分模型
const API_BASE = process.env.SILICONFLOW_API_BASE || 'https://api.siliconflow.cn/v1';
const API_KEY = process.env.SILICONFLOW_API_KEY || process.env.OPENROUTER_API_KEY || '';

const QUESTIONS = [
  '冰箱里只剩鸡蛋、番茄和葱，晚餐做什么？',
  '我想学编程，零基础，怎么开始？',
  '周末朋友来家里，预算 200 块，怎么安排？',
  '每天加班到很晚，怎么坚持锻炼？',
  '想靠业余时间每月多赚 3000 块，有什么路子？',
  '孩子 5 岁，对数学没兴趣，怎么引导？',
  '打算买第一辆车，油车还是电车？',
  '想转行做 AI，28 岁了还来得及吗？',
  '办公室政治严重，怎么自保又不显得不合群？',
  '租房合同到期，房东要涨 30%，怎么谈？',
];

const JUDGE_PROMPT = `你是一个公正的 AI 评估员。你将收到两个回答（A 和 B），它们是对同一个问题的回应。

请从以下维度打分（1-5分）：
1. **实用性**：回答是否具体、可执行
2. **深度**：是否从多个角度分析，还是只有一个简单答案
3. **创新性**：是否提出了不止一种解法，是否有创意

输出格式：
A 总分：<1-5>
B 总分：<1-5>
优胜：A/B/平局
理由：<一句话说明>
`;

// ---- Core / 核心逻辑 ----

async function callLLM(messages, model = GENERATE_MODEL, temperature = 0.7) {
  if (!API_KEY) throw new Error('No API key configured. Set SILICONFLOW_API_KEY or OPENROUTER_API_KEY');

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Generate a baseline response (no generalization / no context).
 * 无泛化的基准回答：直接调 LLM
 */
async function generateBaseline(question) {
  return await callLLM([
    { role: 'system', content: '你是一个 AI 居民，请回答问题。' },
    { role: 'user', content: question },
  ]);
}

/**
 * Generate a generalized response (with past experiences injected).
 * 有泛化的回答：模拟相关经验注入
 */
async function generateWithGeneralization(question) {
  // Simulate related experiences that VectorMemory might retrieve
  const mockExperiences = [
    `[来自居民 素女的泛化经验] 之前有人问过类似问题。我的解法是：先分析核心需求，再从不同角度给出 3 个方案。第一个方案最快最简单，第二个方案更彻底但更花时间，第三个方案是折中。最后根据提问者的条件推荐一个。用户反馈说很有帮助。`,
    `[来自居民 小慧的经验] 遇到这种开放式问题，我通常会反问用户三个问题来缩小范围：预算多少？时间多紧？有没有什么限制？但用户有时会不耐烦，所以我现在会在给出多方案的同时附带追问。`,
  ];

  const contextPrompt = `当前问题：${question}

以下是其他居民遇到类似问题时留下的经验，请从中学到通用模式，然后给出你的回答：

${mockExperiences.join('\n\n')}

请从多个角度分析，给出至少 3 种不同的解法，最后推荐一个。`;

  return await callLLM([
    { role: 'system', content: '你是一个善于从经验中学习的 AI 居民。面对问题，你会参考过去的经验，从多个角度思考，给出多种解法。' },
    { role: 'user', content: contextPrompt },
  ]);
}

/**
 * Judge two responses and pick the winner.
 * 对比两个回答，评判优劣
 */
async function judgeResponses(question, responseA, responseB) {
  const judgeInput = `问题：${question}

=== 回答 A（无泛化）===
${responseA}

=== 回答 B（有泛化）===
${responseB}

${JUDGE_PROMPT}`;

  const result = await callLLM(
    [{ role: 'user', content: judgeInput }],
    EVAL_MODEL,
    0.3,  // Low temperature for consistent judging
  );

  // Parse result / 解析结果
  const aScore = parseFloat(result.match(/A 总分[：:]\s*([\d.]+)/)?.[1] || 0);
  const bScore = parseFloat(result.match(/B 总分[：:]\s*([\d.]+)/)?.[1] || 0);

  // Determine winner / 判定优胜
  const winner = aScore > bScore ? 'A' : bScore > aScore ? 'B' : 'tie';

  return {
    aScore,
    bScore,
    winner,
    judgeComment: result,
  };
}

// ---- Main / 主流程 ----

import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const questionCount = Math.min(
    parseInt(process.argv.find(a => a.startsWith('--questions='))?.split('=')[1] || '5'),
    QUESTIONS.length,
  );

  console.log('=== Generalization Evaluation / 泛化效果评估 ===\n');
  console.log(`Model: ${GENERATE_MODEL} | Judge: ${EVAL_MODEL}`);
  console.log(`Questions: ${questionCount}/${QUESTIONS.length}`);
  console.log(`Time: ~${questionCount * 30}s (30s per question)\n`);

  const results = [];
  let aWins = 0, bWins = 0, ties = 0;

  for (let i = 0; i < questionCount; i++) {
    const q = QUESTIONS[i];
    console.log(`[${i + 1}/${questionCount}] ${q.substring(0, 40)}...`);

    // Phase 1: Generate responses / 生成回答
    const [baseline, generalized] = await Promise.all([
      generateBaseline(q).catch(e => `[ERROR] ${e.message}`),
      generateWithGeneralization(q).catch(e => `[ERROR] ${e.message}`),
    ]);

    // Phase 2: Judge / 评判
    const judge = await judgeResponses(q, baseline, generalized);
    results.push({ question: q, baseline, generalized, ...judge });

    if (judge.winner === 'A') aWins++;
    else if (judge.winner === 'B') bWins++;
    else ties++;

    const icon = judge.winner === 'B' ? '✅' : judge.winner === 'A' ? '❌' : '➖';
    console.log(`  ${icon} Baseline=${judge.aScore} Generalized=${judge.bScore} Winner=${judge.winner}`);
    console.log();
  }

  // Summary / 总结
  console.log('=== Results / 结果 ===\n');
  console.log(`Generalization wins: ${bWins}/${questionCount} (${(bWins / questionCount * 100).toFixed(0)}%)`);
  console.log(`Baseline wins:      ${aWins}/${questionCount}`);
  console.log(`Ties:               ${ties}/${questionCount}`);
  console.log();
  console.log('Per-question breakdown:');
  for (const r of results) {
    const icon = r.winner === 'B' ? '✅' : r.winner === 'A' ? '❌' : '➖';
    console.log(`  ${icon} [${r.aScore} vs ${r.bScore}] ${r.question.substring(0, 50)}`);
  }

  // Write detailed report / 写入详细报告
  const reportPath = `eval-report-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
