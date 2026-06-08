// Experiment: code-reviewer — LLM 驱动的代码审查引擎
// Manifest id: code-reviewer
// I/O: 见各 op
//
// 包装 src/core/quality/code-reviewer.js 的 CodeReviewer 类
// 只读审计，审查结果写入 ~/.openchat/reviews/

export const META = {
  id: 'code-reviewer',
  name: 'Code Reviewer — LLM-driven code review engine',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: 'generate_problems | build_prompt | parse_result | get_findings | get_summary | review_file' },
    { name: 'problemId', type: 'string', required: false },
    { name: 'filePath', type: 'string', required: false },
    { name: 'llmOutput', type: 'string', required: false, description: 'LLM raw output for parse_result' },
  ],
  outputs: [
    { name: 'problems', type: 'array', description: 'generate_problems: 审查问题列表' },
    { name: 'prompt', type: 'string', description: 'build_prompt: 构造的 LLM prompt' },
    { name: 'review', type: 'object', description: 'parse_result: 解析后的审查结果' },
    { name: 'findings', type: 'array', description: 'get_findings: 所有发现' },
    { name: 'summary', type: 'object', description: 'get_summary: 审查统计摘要' },
  ],
  deps: [],
  tags: ['code-review', 'audit', 'quality'],
};

export async function run({ inputs = {} } = {}) {
  const { op, ...args } = inputs;
  if (!op) throw new Error('code-reviewer.run: op required');
  const { CodeReviewer } = await import('../core/quality/code-reviewer.js');

  switch (op) {
    case 'generate_problems': {
      const r = new CodeReviewer();
      return { outputs: { problems: r.generateReviewProblems() } };
    }

    case 'build_prompt': {
      const r = new CodeReviewer();
      const problems = r.generateReviewProblems();
      const problem = args.problemId
        ? problems.find(p => p.id === args.problemId)
        : problems[0];
      if (!problem) throw new Error(`Problem ${args.problemId} not found`);
      return { outputs: { prompt: r.buildReviewPrompt(problem, args.kbHint) } };
    }

    case 'parse_result': {
      if (!args.llmOutput || !args.problemId) throw new Error('llmOutput and problemId required');
      const r = new CodeReviewer();
      const problems = r.generateReviewProblems();
      const problem = problems.find(p => p.id === args.problemId);
      if (!problem) throw new Error(`Problem ${args.problemId} not found`);
      const review = r.parseReviewResult(problem, args.llmOutput);
      return { outputs: { review } };
    }

    case 'get_findings': {
      const r = new CodeReviewer();
      return { outputs: { findings: r.getFindings(args.severity || null) } };
    }

    case 'get_summary': {
      const r = new CodeReviewer();
      return { outputs: { summary: r.getSummary() } };
    }

    case 'review_file': {
      if (!args.filePath) throw new Error('filePath required');
      const r = new CodeReviewer();
      const problem = {
        id: `review_${args.filePath.replace(/[/\\]/g, '_')}`,
        question: `审查 ${args.filePath}：${args.focus || '找出潜在的 bug、逻辑错误、边界条件遗漏、空 catch 块等问题。'}`,
        domain: 'code_review',
        difficulty: 3,
        answer: null,
        source: 'code_review',
        filePath: args.filePath,
        fileLines: 0,
      };
      return { outputs: { prompt: r.buildReviewPrompt(problem, args.kbHint), problem } };
    }

    default:
      throw new Error(`code-reviewer.run: unknown op "${op}"`);
  }
}

import { create } from './lib/report.mjs';

const { ok, ng, skip, report } = create();
const NAME = 'Code Reviewer — LLM-driven code review engine';

async function test() {
  const { CodeReviewer } = await import('../core/quality/code-reviewer.js');
  const r = new CodeReviewer();

  const problems = r.generateReviewProblems();
  if (Array.isArray(problems) && problems.length > 0) ok(`generateReviewProblems: ${problems.length} problems`);
  else ng('generateReviewProblems failed');

  if (problems.length > 0) {
    const prompt = r.buildReviewPrompt(problems[0]);
    if (prompt.includes(problems[0].id)) ok('buildReviewPrompt includes problem id');
    else ng('buildReviewPrompt missing problem id');

    const mockOutput = JSON.stringify({
      findings: [{ severity: 'low', line: 1, type: 'style', description: 'test', suggestion: 'fix' }],
      summary: 'test review',
    });
    const review = r.parseReviewResult(problems[0], mockOutput);
    if (review && review.findings.length === 1) ok('parseReviewResult parsed mock output');
    else ng('parseReviewResult failed');
  }

  const summary = r.getSummary();
  if (typeof summary.totalReviews === 'number') ok('getSummary returns structured result');
  else ng('getSummary failed');

  report(NAME);
}

export { test };
