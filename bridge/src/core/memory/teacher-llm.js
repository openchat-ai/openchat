/**
 * TeacherLLM — 只在关键时用 LLM 教学
 *
 * 不求解题，只做三件事：
 * 1. 模式提炼 — 把一次解题过程提炼成可复用的推理规则
 * 2. 缺陷诊断 — 系统解不出时，LLM 分析缺了什么概念
 * 3. 课程生成 — 设计从简单到复杂的渐进学习路径
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import logger from '../logger.js';

const RULES_DIR = join(homedir(), '.openchat', 'rules');

export class TeacherLLM {
  constructor() {
    this._ensureDir();
    this.teacherCalls = 0;
    this.rulesGenerated = 0;
  }

  _ensureDir() {
    try { if (!existsSync(RULES_DIR)) mkdirSync(RULES_DIR, { recursive: true }); } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }

  /**
   * 1. 模式提炼：给定一个已解问题，让 LLM 写出可复用的推理规则
   * 返回 JavaScript 函数字符串，可以直接 eval 注入推理引擎
   */
  buildExtractPatternPrompt(problem, answer) {
    return `你是一个数学教师。一个学生刚刚解决了这道题：

题目：${problem.question}
学生的答案：${answer}

请做两件事：

1. 用一句话总结这道题考察的数学概念（如"一元一次方程""组合数公式""概率的补集法"）
2. 写一个 JavaScript 函数来判断新题目是否属于同类型，函数签名：
\`\`\`javascript
function match(question) {
  // 返回 true 如果新题目和这道题考察同一概念
}
\`\`\`
3. 写一个 JavaScript 函数来求解同类题目，函数签名：
\`\`\`javascript
function solve(question) {
  // 从题目中提取数字，应用公式，返回答案（数字或字符串）
}
\`\`\`

只返回 JSON：
\`\`\`json
{
  "concept": "概念名",
  "match": "function match(question) { ... }",
  "solve": "function solve(question) { ... }"
}
\`\`\``;
  }

  /**
   * 2. 缺陷诊断：系统解不出，LLM 分析缺什么
   */
  buildDiagnosisPrompt(problem, failedReason = '') {
    return `你是一个数学诊断专家。一个自学系统尝试解决这道题但失败了：

题目：${problem.question}
领域：${problem.domain}
难度：${problem.difficulty || '?'}
失败原因：${failedReason || '未知'}

请分析：

1. 这道题需要哪些前置知识？
2. 系统为什么可能解不出来？
3. 应该先学会哪三道更简单的题作为铺垫？

只返回 JSON：
\`\`\`json
{
  "requiredConcepts": ["概念1", "概念2"],
  "blocker": "卡住的原因",
  "scaffolding": [
    { "question": "更简单的题1", "domain": "${problem.domain}", "difficulty": 1 },
    { "question": "更简单的题2", "domain": "${problem.domain}", "difficulty": 1 },
    { "question": "更简单的题3", "domain": "${problem.domain}", "difficulty": 2 }
  ]
}
\`\`\``;
  }

  /**
   * 3. 课程生成：设计渐进学习路径
   */
  buildCurriculumPrompt(domain, masteredConcepts, targetDifficulty) {
    return `你是一个课程设计师。一个自学系统正在学习${domain === 'math' ? '数学' : '逻辑推理'}。

当前已掌握概念：${masteredConcepts.join('、') || '无'}
目标难度：${targetDifficulty}（1=简单, 2=中等, 3=困难）

请设计从当前水平到目标难度的「最小题量、最大覆盖」课程，返回 10 道渐进的练习题。

只返回 JSON 数组：
\`\`\`json
[
  { "question": "题目", "concept": "考察的概念", "difficulty": 1, "hint": "提示（可选）" },
  ...
]
\`\`\``;
  }

  /**
   * 解析 LLM 回复的模式
   */
  parsePatternResponse(content) {
    try {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const json = JSON.parse(m[0]);
      if (json.concept && json.match && json.solve) {
        this.teacherCalls++;
        return json;
      }
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return null;
  }

  /**
   * 解析 LLM 诊断回复
   */
  parseDiagnosisResponse(content) {
    try {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return null;
      return JSON.parse(m[0]);
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return null;
  }

  /**
   * 解析 LLM 课程回复
   */
  parseCurriculumResponse(content, domain) {
    try {
      const m = content.match(/\[[\s\S]*\]/);
      if (!m) return null;
      const items = JSON.parse(m[0]);
      return items.map((item, i) => ({
        id: `curriculum_${domain}_${Date.now()}_${i}`,
        question: item.question,
        domain,
        difficulty: item.difficulty || 1,
        concept: item.concept || '',
        hint: item.hint || '',
        answer: null,
        source: 'llm_curriculum'
      }));
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    return null;
  }

  /**
   * 把 LLM 教的规则保存并尝试注入推理引擎
   */
  saveRule(problemId, concept, matchFn, solveFn) {
    const rule = { problemId, concept, match: matchFn, solve: solveFn, createdAt: Date.now() };
    try {
      const file = join(RULES_DIR, `rule_${problemId}_${Date.now()}.json`);
      writeFileSync(file, JSON.stringify(rule, null, 2));
      this.rulesGenerated++;
      logger.info(`[Teacher] 新推理规则: ${concept} (${problemId})`);
      return rule;
    } catch (e) {
      logger.info(`[Teacher] 保存规则失败: ${e.message}`);
      return null;
    }
  }

  getStats() {
    return {
      teacherCalls: this.teacherCalls,
      rulesGenerated: this.rulesGenerated
    };
  }
}
