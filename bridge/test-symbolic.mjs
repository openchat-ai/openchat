import { SymbolicReasoner } from './src/core/symbolic-reasoner.js';

const s = new SymbolicReasoner();
const tests = [
  '解方程 2x+5=15，x等于多少？',
  '鸡兔同笼，共35个头，94只脚，鸡和兔各有多少只？',
  '1+2+3+...+100 等于多少？',
  '一个长方形长8宽5，面积是多少？',
  '一个圆柱底面半径3高10，体积是多少？',
  '两个数的和是48，差是12，这两个数分别是多少？',
  '12和18的最大公约数是多少？',
  '一件商品原价200元，打8折后多少钱？',
];

for (const q of tests) {
  const r = s.tryDeduce({ question: q, domain: 'math' });
  console.log('\n📐 ' + q);
  if (r) {
    r.proof.forEach(p => console.log('  ├ ' + p.step + '  ' + p.reason));
    console.log('  └ 答案: ' + r.answer + ' (' + r.method + ')');
  } else {
    console.log('  ✗ 未解出');
  }
}
