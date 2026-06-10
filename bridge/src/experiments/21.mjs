// Experiment 53: Teach-Me — 苏格拉底式交互教学
//
// 基于 CCB /teach-me pattern。
// 诊断水平 → 拆解 5-15 原子概念 → 苏格拉底提问 → 断点续学。
// 可建在 skill-loader 之上，也可独立运行。
//
// I/O (compose 契约):
//   { op, topic?, level?, answer?, resume? }
//   → { outputs: { path?, current?, question?, progress?, done? } }

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { create } from './lib/report.mjs';

export const META = { id: 'teach-me' };

const NAME = 'Teach-Me — 苏格拉底式交互教学';

// ── 知识点库（内置教学大纲） ──

const TOPIC_DB = {
  javascript: {
    title: 'JavaScript 基础',
    concepts: [
      { id: 'js1', name: '变量与作用域 (var/let/const)', questions: ['var 和 let 有什么区别？', '什么是暂时性死区？'] },
      { id: 'js2', name: '闭包与高阶函数', questions: ['闭包是什么？能举一个实际例子吗？', '高阶函数如何工作？'] },
      { id: 'js3', name: '原型链与继承', questions: ['JavaScript 如何实现继承？', 'class 语法是真正的类吗？'] },
      { id: 'js4', name: '异步编程 (Promise/async/await)', questions: ['微任务和宏任务的区别？', 'Promise.all 和 Promise.allSettled 的区别？'] },
      { id: 'js5', name: 'Event Loop 事件循环', questions: ['请描述一次完整的事件循环 tick。', 'setTimeout(fn, 0) 什么时候执行？'] },
    ],
  },
  nodejs: {
    title: 'Node.js 基础',
    concepts: [
      { id: 'node1', name: '模块系统 (CommonJS vs ESM)', questions: ['require 和 import 的区别？', '循环依赖如何处理？'] },
      { id: 'node2', name: 'Stream 与 Buffer', questions: ['Stream 有几种类型？', '背压如何处理？'] },
      { id: 'node3', name: 'EventEmitter 模式', questions: ['EventEmitter 如何避免内存泄漏？', 'maxListeners 的作用？'] },
      { id: 'node4', name: 'Cluster 与子进程', questions: ['Cluster 如何实现负载均衡？', 'child_process 有哪些 spawn 模式？'] },
    ],
  },
  flutter: {
    title: 'Flutter 开发',
    concepts: [
      { id: 'fl1', name: 'Widget 树与 Element 树', questions: ['StatelessWidget 和 StatefulWidget 的区别？', 'Key 的作用是什么？'] },
      { id: 'fl2', name: '状态管理 (Riverpod)', questions: ['Provider 和 Riverpod 的区别？', '如何避免不必要的 rebuild？'] },
      { id: 'fl3', name: 'BuildContext 与 InheritedWidget', questions: ['BuildContext 的本质是什么？', 'of(context) 是如何查找的？'] },
      { id: 'fl4', name: '渲染管线与 Layout', questions: ['Flutter 的渲染管线有几个阶段？', 'Constraints go down, Sizes go up 是什么意思？'] },
    ],
  },
  agent: {
    title: 'Agent Harness 工程',
    concepts: [
      { id: 'ag1', name: 'Agent Loop 核心', questions: ['Agent loop 中 stop_reason 有哪些？', 'tool_use 之后为什么要追加 tool_result？'] },
      { id: 'ag2', name: 'Tool 系统设计', questions: ['Tool handler 的 dispatch 模式是怎样的？', '如何保证工具调用的安全性？'] },
      { id: 'ag3', name: '上下文管理', questions: ['Context compaction 有哪几种策略？', 'Subagent 如何实现上下文隔离？'] },
      { id: 'ag4', name: '多 Agent 协作', questions: ['MessageBus 的设计模式是怎样的？', 'Auto-claim 和 Leader-assign 的对比？'] },
      { id: 'ag5', name: 'Feature Flag 系统', questions: ['分层回退有哪些层级？', '同步读取 vs 异步刷新如何平衡？'] },
    ],
  },
};

// ── 学习进度持久化 ──

const PROGRESS_DIR = resolve(homedir(), '.openchat', 'teach-me');

async function _loadProgress(topic) {
  try {
    const file = resolve(PROGRESS_DIR, `${topic}.json`);
    if (!existsSync(file)) return null;
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function _saveProgress(topic, data) {
  await mkdir(PROGRESS_DIR, { recursive: true });
  const file = resolve(PROGRESS_DIR, `${topic}.json`);
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── 概念生成（内置 + 扩展） ──

function _generatePath(topic, level) {
  const entry = TOPIC_DB[topic];
  if (entry) {
    return {
      title: entry.title,
      concepts: entry.concepts.map((c, i) => ({
        ...c,
        status: i === 0 ? 'current' : 'pending',
      })),
    };
  }

  // 未知主题：生成通用路径
  const numConcepts = level === 'advanced' ? 10 : level === 'beginner' ? 4 : 6;
  return {
    title: `${topic} 学习路径`,
    concepts: Array.from({ length: numConcepts }, (_, i) => ({
      id: `c_${topic}_${i}`,
      name: `${topic} - 概念 ${i + 1}`,
      questions: [`你对"${topic}"概念${i + 1}如何理解？`],
      status: i === 0 ? 'current' : 'pending',
    })),
  };
}

function _getQuestion(concept, idx = 0) {
  if (concept.questions && concept.questions.length > 0) {
    return concept.questions[idx % concept.questions.length];
  }
  return `请描述你对"${concept.name}"的理解。`;
}

// ── Public API ──

export async function run({ inputs = {} } = {}) {
  const { op, topic, level = 'auto', answer, resume } = inputs;

  switch (op) {
    case 'start': {
      if (!topic) throw new Error('topic required');

      // 检查断点续学
      if (resume) {
        const saved = await _loadProgress(topic);
        if (saved) {
          return { outputs: { progress: saved, resumed: true } };
        }
      }

      const path = _generatePath(topic, level);
      const progress = {
        topic,
        level,
        title: path.title,
        concepts: path.concepts,
        completed: [],
        currentConcept: path.concepts[0],
        currentQuestion: _getQuestion(path.concepts[0]),
        total: path.concepts.length,
        done: 0,
        score: 0,
      };

      await _saveProgress(topic, progress);
      return {
        outputs: {
          path: progress.concepts.map(c => ({ id: c.id, name: c.name, status: c.status })),
          current: { name: progress.currentConcept.name, question: progress.currentQuestion },
          progress,
        },
      };
    }

    case 'answer': {
      if (!topic) throw new Error('topic required');

      const progress = await _loadProgress(topic);
      if (!progress) throw new Error(`no session for topic: ${topic}. Start first.`);

      // 评分（模拟：有回答即通过）
      const score = answer && answer.length > 5 ? 1 : 0.5;
      progress.score += score;
      progress.done++;

      // 标记当前完成
      const current = progress.concepts.find(c => c.status === 'current');
      if (current) {
        current.status = 'completed';
        progress.completed.push(current.id);
      }

      // 检查是否完成
      const next = progress.concepts.find(c => c.status === 'pending');
      if (next) {
        next.status = 'current';
        progress.currentConcept = next;
        progress.currentQuestion = _getQuestion(next);
      } else {
        progress.currentConcept = null;
        progress.currentQuestion = null;
      }

      // 计算总分
      const totalScore = Math.round((progress.score / progress.total) * 100);

      await _saveProgress(topic, progress);

      if (!next) {
        return {
          outputs: {
            done: true,
            score: totalScore,
            summary: `完成了 ${progress.title}，得分 ${totalScore}%`,
            progress,
          },
        };
      }

      return {
        outputs: {
          done: false,
          next: { name: next.name, question: progress.currentQuestion },
          progress: {
            done: progress.done,
            total: progress.total,
            score: totalScore,
            currentName: next.name,
          },
        },
      };
    }

    case 'status': {
      if (!topic) throw new Error('topic required');
      const progress = await _loadProgress(topic);
      if (!progress) return { outputs: { exists: false } };

      const score = progress.total > 0 ? Math.round((progress.score / progress.total) * 100) : 0;
      return {
        outputs: {
          exists: true,
          topic: progress.topic,
          title: progress.title,
          done: progress.done,
          total: progress.total,
          score,
          completed: progress.completed,
          current: progress.currentConcept?.name || null,
        },
      };
    }

    case 'list': {
      const topics = Object.keys(TOPIC_DB).map(key => ({
        id: key,
        title: TOPIC_DB[key].title,
        concepts: TOPIC_DB[key].concepts.length,
      }));
      return { outputs: { builtin: topics } };
    }

    default:
      throw new Error(`unknown op: ${op}`);
  }
}

// ── 测试 ──

export async function test() {
  const { ok, ng, report } = create();
  let pass = true;

  // ① start 已知主题
  const s1 = await run({ inputs: { op: 'start', topic: 'javascript' } });
  if (s1.outputs.path && s1.outputs.path.length === 5) ok('start JS path has 5 concepts');
  else { ng(`start: got ${s1.outputs.path?.length} concepts`); pass = false; }

  // ② start 未知主题 + level
  const s2 = await run({ inputs: { op: 'start', topic: '量子计算', level: 'beginner' } });
  if (s2.outputs.path && s2.outputs.path.length === 4) ok('start unknown topic with beginner level');
  else { ng(`start unknown: got ${s2.outputs.path?.length}`); pass = false; }

  // ③ answer 通过
  const s3 = await run({ inputs: { op: 'answer', topic: 'javascript', answer: 'var 是函数作用域，let 和 const 是块作用域，const 不能重新赋值。' } });
  if (s3.outputs.done === false && s3.outputs.next) ok('answer moves to next concept');
  else { ng('answer: no next concept'); pass = false; }

  // ④ status
  const s4 = await run({ inputs: { op: 'status', topic: 'javascript' } });
  if (s4.outputs.exists && s4.outputs.done === 1) ok('status shows 1/5 completed');
  else { ng(`status: done=${s4.outputs.done}`); pass = false; }

  // ⑤ list
  const s5 = await run({ inputs: { op: 'list' } });
  if (s5.outputs.builtin && s5.outputs.builtin.length >= 4) ok('list has 4+ builtin topics');
  else { ng('list: too few topics'); pass = false; }

  // ⑥ 完整路径完成
  // 跑完剩余 4 题
  for (const ans of ['闭包是函数及其词法环境的组合', '通过 prototype 实现', 'Promise 是微任务', '先执行同步再微任务再宏任务']) {
    await run({ inputs: { op: 'answer', topic: 'javascript', answer: ans } });
  }
  const s6 = await run({ inputs: { op: 'status', topic: 'javascript' } });
  if (s6.outputs.done === 5 && s6.outputs.score > 0) ok('complete JS path: 5/5 done');
  else { ng(`complete: done=${s6.outputs.done} score=${s6.outputs.score}`); pass = false; }

  // ⑦ resume
  const s7 = await run({ inputs: { op: 'start', topic: 'javascript', resume: true } });
  if (s7.outputs.resumed && s7.outputs.progress.done === 5) ok('resume works');
  else { ng('resume: failed'); pass = false; }

  report(NAME);
  return pass;
}
