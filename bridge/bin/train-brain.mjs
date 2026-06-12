#!/usr/bin/env node
// train-brain.mjs — NeuralBrain 手动 seed + stats
//
// 用法:
//   node bin/train-brain.mjs --stats
//   node bin/train-brain.mjs --bootstrap              # 20 个 seed sample
//   node bin/train-brain.mjs --text "add /foo" --domain code_review --difficulty 1 --label success
//   node bin/train-brain.mjs --predict "fix the bug"  # 测预测
//
// 数据形状: { question, domain: math|logic|research|code_review, difficulty: 0-3 }
// 持久化: ~/.openchat/brain/weights.json (NeuralBrain 内部管)

import { NeuralBrain } from '../src/core/memory/neural-brain.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    if (a.includes('=')) {
      const [k, ...v] = a.slice(2).split('=');
      out[k] = v.join('=');
    } else {
      const k = a.slice(2);
      const next = argv[i + 1];
      // 下一个 arg 是值 (不是 flag, 不是 boolean 关键字)
      if (next && !next.startsWith('--') && next !== 'true' && next !== 'false') {
        // 多词值: 吃到下一个 flag 为止
        const words = [next];
        let j = i + 2;
        while (j < argv.length && !argv[j].startsWith('--')) {
          words.push(argv[j]);
          j++;
        }
        out[k] = words.join(' ');
        i = j - 1;
      } else {
        out[k] = true;
      }
    }
  }
  return out;
}

const args = parseArgs();
const brain = new NeuralBrain();

if (args.stats) {
  const s = brain.getStats();
  console.log(JSON.stringify(s, null, 2));
  console.log(`\nweights file: ${process.env.HOME}/.openchat/brain/weights.json`);
  process.exit(0);
}

if (args.predict) {
  const diff = brain.predictDifficulty(args.predict);
  const dom = brain.predictDomain(args.predict);
  const can = brain.canSolveLocally(args.predict);
  const out = brain.predict(args.predict);
  console.log(JSON.stringify({ input: args.predict, difficulty: diff, domain: dom, canLocal: can, full: out }, null, 2));
  process.exit(0);
}

if (args.bootstrap) {
  const seeds = [
    { q: 'add slash command', d: 'code_review', diff: 1 },
    { q: 'fix bug in foo', d: 'code_review', diff: 2 },
    { q: 'refactor bar.js to ESM', d: 'code_review', diff: 2 },
    { q: 'explain what this function does', d: 'research', diff: 0 },
    { q: 'find all references to X', d: 'research', diff: 1 },
    { q: 'compute 1+2+3', d: 'math', diff: 0 },
    { q: 'solve the equation x=5', d: 'math', diff: 2 },
    { q: 'prove the theorem', d: 'logic', diff: 3 },
    { q: 'add /foo command that does X', d: 'code_review', diff: 1 },
    { q: 'run the test suite', d: 'code_review', diff: 1 },
    { q: 'write a function to sort array', d: 'code_review', diff: 1 },
    { q: 'read first 10 lines of file', d: 'code_review', diff: 0 },
    { q: 'commit current changes', d: 'code_review', diff: 0 },
    { q: 'why does X fail at startup', d: 'logic', diff: 2 },
    { q: 'design a new feature spec', d: 'research', diff: 3 },
    { q: 'show git log of file', d: 'research', diff: 0 },
    { q: 'lint the file for errors', d: 'code_review', diff: 0 },
    { q: 'update README with new command', d: 'code_review', diff: 1 },
    { q: 'compare two implementations', d: 'research', diff: 1 },
    { q: 'delete the dead code path', d: 'code_review', diff: 1 },
  ];
  const r = brain.trainOnSolvedProblems(seeds.map(s => ({ question: s.q, domain: s.d, difficulty: s.diff })));
  console.log('bootstrap done:', JSON.stringify(r, null, 2));
  console.log(`\nstats: ${JSON.stringify(brain.getStats())}`);
  process.exit(0);
}

if (args.text) {
  const domain = args.domain || 'research';
  const diff = parseInt(args.difficulty || '1', 10);
  const success = args.label !== 'fail';
  const sample = success
    ? { question: args.text, domain, difficulty: diff }
    : { question: args.text, domain: 'logic', difficulty: Math.min(3, diff + 1) };
  const r = brain.trainOnSolvedProblems([sample]);
  console.log('trained:', JSON.stringify(r, null, 2));
  console.log(`stats: ${JSON.stringify(brain.getStats())}`);
  process.exit(0);
}

console.log('Usage:');
console.log('  --stats                                    show weights stats');
console.log('  --predict "text"                           predict difficulty/domain');
console.log('  --bootstrap                                seed 20 sample');
console.log('  --text "..." --domain <d> --difficulty <0-3> --label <success|fail>');
