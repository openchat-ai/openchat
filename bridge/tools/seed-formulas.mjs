#!/usr/bin/env node
/**
 * Seed math formulas into Vector Memory, then test generalization.
 * 导入 150+ 条初高中数学公式到向量记忆，测试泛化效果。
 *
 * Usage: node tools/seed-formulas.mjs
 *   -> Seeds formulas, then prompts interactive query.
 */
import { vectorMemory } from '../src/core/vector-memory.js';

const FORMULAS = [
  // ---- 代数 ----
  '完全平方公式：(a+b)² = a² + 2ab + b²',
  '完全平方差公式：(a-b)² = a² - 2ab + b²',
  '平方差公式：a² - b² = (a+b)(a-b)',
  '立方和公式：a³ + b³ = (a+b)(a² - ab + b²)',
  '立方差公式：a³ - b³ = (a-b)(a² + ab + b²)',
  '和的立方：(a+b)³ = a³ + 3a²b + 3ab² + b³',
  '差的立方：(a-b)³ = a³ - 3a²b + 3ab² - b³',
  '一元二次方程求根公式：x = [-b ± √(b²-4ac)] / 2a，其中 ax²+bx+c=0',
  '判别式：Δ = b² - 4ac，Δ>0两个实根，Δ=0一个实根，Δ<0无实根',
  '韦达定理：x₁ + x₂ = -b/a，x₁x₂ = c/a',
  '因式分解之十字相乘法：x²+(p+q)x+pq = (x+p)(x+q)',
  '分式加法：a/b + c/d = (ad+bc)/bd',
  '分式乘法：a/b × c/d = ac/bd',
  '指数相乘：a^m × a^n = a^(m+n)',
  '指数相除：a^m ÷ a^n = a^(m-n)',
  '幂的乘方：(a^m)^n = a^(mn)',
  '积的乘方：(ab)^n = a^n × b^n',
  '零指数：a⁰ = 1 (a≠0)',
  '负指数：a^(-n) = 1/a^n',
  '分数指数：a^(m/n) = ⁿ√(a^m)',
  '对数定义：logₐb = c 等价于 a^c = b',
  '对数乘法：logₐ(MN) = logₐM + logₐN',
  '对数除法：logₐ(M/N) = logₐM - logₐN',
  '对数幂：logₐ(M^n) = n·logₐM',
  '换底公式：logₐb = log_c b / log_c a',
  '自然对数：ln(x) = log_e(x)，其中 e ≈ 2.71828',
  '常用对数：lg(x) = log₁₀(x)',
  '等差数列通项：a_n = a₁ + (n-1)d',
  '等差数列前n项和：S_n = n(a₁+a_n)/2 = na₁ + n(n-1)d/2',
  '等比数列通项：a_n = a₁·q^(n-1)',
  '等比数列前n项和：S_n = a₁(1-q^n)/(1-q) (q≠1)',
  '无穷等比级数和：S = a₁/(1-q) (|q|<1)',
  '算术-几何平均不等式：(a+b)/2 ≥ √(ab)，当a=b时取等',
  '柯西不等式：(a₁²+a₂²)(b₁²+b₂²) ≥ (a₁b₁+a₂b₂)²',
  '绝对值不等式：|a+b| ≤ |a| + |b|',
  '绝对值不等式：|a-b| ≥ ||a| - |b||',
  '排序不等式：同序和 ≥ 乱序和 ≥ 逆序和',

  // ---- 几何 ----
  '勾股定理：a² + b² = c²，其中c为斜边',
  '勾股定理逆定理：若a²+b²=c²，则三角形为直角三角形',
  '三角形面积：S = (底×高)/2 = (1/2)ab·sinC',
  '海伦公式：S = √[s(s-a)(s-b)(s-c)]，其中s=(a+b+c)/2',
  '三角形内角和：∠A + ∠B + ∠C = 180°',
  '正弦定理：a/sinA = b/sinB = c/sinC = 2R',
  '余弦定理：a² = b² + c² - 2bc·cosA',
  '平行四边形面积：S = 底×高 = ab·sinθ',
  '梯形面积：S = (上底+下底)×高/2',
  '菱形面积：S = 对角线₁×对角线₂/2',
  '圆面积：S = πr²',
  '圆周长：C = 2πr = πd',
  '弧长：l = rθ（θ为弧度）',
  '扇形面积：S = (1/2)r²θ = (θ/360°)πr²',
  '圆柱侧面积：S = 2πrh',
  '圆柱体积：V = πr²h',
  '圆锥侧面积：S = πrl（l为母线）',
  '圆锥体积：V = (1/3)πr²h',
  '球表面积：S = 4πr²',
  '球体积：V = (4/3)πr³',
  '长方体体积：V = abc',
  '正方体体积：V = a³',
  '棱柱体积：V = Sh',
  '棱锥体积：V = (1/3)Sh',
  '圆台体积：V = (1/3)πh(R²+Rr+r²)',
  '两点间距离：d = √[(x₂-x₁)² + (y₂-y₁)²]',
  '中点坐标：((x₁+x₂)/2, (y₁+y₂)/2)',
  '点到直线距离：d = |Ax₀+By₀+C| / √(A²+B²)',
  '直线斜率公式：k = (y₂-y₁)/(x₂-x₁)',
  '两直线平行：k₁ = k₂',
  '两直线垂直：k₁·k₂ = -1',
  '圆的方程：(x-a)² + (y-b)² = r²',
  '椭圆方程：x²/a² + y²/b² = 1',
  '双曲线方程：x²/a² - y²/b² = 1',
  '抛物线方程：y² = 2px',
  '平行四边形对角线互相平分',
  '直角三角形斜边中线等于斜边一半',
  '三角形中位线平行且等于第三边一半',
  '圆的切线垂直于过切点的半径',
  '圆周角等于圆心角的一半',
  '直径所对圆周角是直角',
  '相似三角形对应边成比例，对应角相等',
  '全等三角形判定：SSS/SAS/ASA/AAS/HL',

  // ---- 三角 ----
  'sin²θ + cos²θ = 1',
  'tanθ = sinθ/cosθ',
  'cotθ = cosθ/sinθ',
  'sin(α+β) = sinα·cosβ + cosα·sinβ',
  'sin(α-β) = sinα·cosβ - cosα·sinβ',
  'cos(α+β) = cosα·cosβ - sinα·sinβ',
  'cos(α-β) = cosα·cosβ + sinα·sinβ',
  'tan(α+β) = (tanα+tanβ)/(1-tanα·tanβ)',
  'tan(α-β) = (tanα-tanβ)/(1+tanα·tanβ)',
  '二倍角正弦：sin2θ = 2sinθ·cosθ',
  '二倍角余弦：cos2θ = cos²θ - sin²θ = 2cos²θ-1 = 1-2sin²θ',
  '二倍角正切：tan2θ = 2tanθ/(1-tan²θ)',
  '半角公式：sin(θ/2) = ±√[(1-cosθ)/2]',
  '半角公式：cos(θ/2) = ±√[(1+cosθ)/2]',
  '积化和差：sinα·cosβ = [sin(α+β)+sin(α-β)]/2',
  '积化和差：cosα·cosβ = [cos(α+β)+cos(α-β)]/2',
  '积化和差：sinα·sinβ = [cos(α-β)-cos(α+β)]/2',
  '和差化积：sinα+sinβ = 2sin[(α+β)/2]·cos[(α-β)/2]',
  '和差化积：sinα-sinβ = 2cos[(α+β)/2]·sin[(α-β)/2]',
  '和差化积：cosα+cosβ = 2cos[(α+β)/2]·cos[(α-β)/2]',
  '和差化积：cosα-cosβ = -2sin[(α+β)/2]·sin[(α-β)/2]',
  '诱导公式：sin(π/2-α) = cosα',
  '诱导公式：cos(π/2-α) = sinα',
  '诱导公式：sin(π-α) = sinα',
  '诱导公式：cos(π-α) = -cosα',
  '诱导公式：sin(-α) = -sinα',
  '诱导公式：cos(-α) = cosα',
  'asinθ + bcosθ = √(a²+b²)·sin(θ+φ)，其中tanφ=b/a',

  // ---- 解析几何 ----
  '向量点积：a·b = |a||b|·cosθ = x₁x₂+y₁y₂',
  '向量叉积模：|a×b| = |a||b|·sinθ',
  '三角形重心坐标：((x₁+x₂+x₃)/3, (y₁+y₂+y₃)/3)',
  '三角形外心：三边中垂线交点',
  '三角形内心：三角平分线交点',
  '三角形垂心：三高线交点',
  '直线一般式：Ax + By + C = 0',
  '直线点斜式：y - y₀ = k(x - x₀)',
  '直线两点式：(y-y₁)/(y₂-y₁) = (x-x₁)/(x₂-x₁)',
  '圆的标准式：(x-a)² + (y-b)² = r²',
  '圆的一般式：x²+y²+Dx+Ey+F=0，圆心(-D/2,-E/2)，半径=√[(D²+E²-4F)/4]',

  // ---- 概率统计 ----
  '排列数：P(n,m) = n!/(n-m)!',
  '组合数：C(n,m) = n!/[m!(n-m)!]',
  '古典概率：P(A) = 有利结果数/总结果数',
  '条件概率：P(A|B) = P(AB)/P(B)',
  '全概率公式：P(A) = ΣP(A|B_i)·P(B_i)',
  '贝叶斯公式：P(B_i|A) = P(A|B_i)·P(B_i) / ΣP(A|B_j)·P(B_j)',
  '期望值：E(X) = Σx_i·p_i',
  '方差：D(X) = E(X²) - [E(X)]²',
  '二项分布：P(X=k) = C(n,k)·p^k·(1-p)^(n-k)',
  '正态分布概率密度：f(x) = 1/[σ√(2π)]·e^{-(x-μ)²/(2σ²)}',
  '标准差：σ = √D(X)',
  '协方差：Cov(X,Y) = E[(X-E(X))(Y-E(Y))]',
  '相关系数：ρ_XY = Cov(X,Y)/(σ_X·σ_Y)',

  // ---- 导数与积分 ----
  '导数定义：f\'(x) = lim[h→0] [f(x+h)-f(x)]/h',
  '幂函数求导：(x^n)\' = nx^(n-1)',
  '乘法求导：(uv)\' = u\'v + uv\'',
  '除法求导：(u/v)\' = (u\'v - uv\')/v²',
  '链式法则：f(g(x))\' = f\'(g(x))·g\'(x)',
  'sinx导数：(sinx)\' = cosx',
  'cosx导数：(cosx)\' = -sinx',
  'tanx导数：(tanx)\' = sec²x',
  '指数求导：(e^x)\' = e^x',
  '对数求导：(lnx)\' = 1/x',
  '不定积分：∫x^n dx = x^(n+1)/(n+1) + C',
  '定积分：∫_a^b f(x)dx = F(b)-F(a)',
  '∫sinx dx = -cosx + C',
  '∫cosx dx = sinx + C',
  '∫e^x dx = e^x + C',
  '∫1/x dx = ln|x| + C',
  '∫1/(1+x²) dx = arctanx + C',
  '分部积分：∫u·dv = uv - ∫v·du',
  '换元积分：∫f(g(x))·g\'(x)dx = ∫f(u)du（令u=g(x))',
  '曲线下面积：∫_a^b f(x)dx',
  '旋转体体积：V = π∫_a^b [f(x)]² dx',
  '曲线弧长：L = ∫_a^b √(1+[f\'(x)]²) dx',
];

async function main() {
  console.log('=== Seeding Math Formulas to Vector Memory ===\n');
  console.log(`Total formulas: ${FORMULAS.length}`);

  // Clear existing entries from previous tests
  vectorMemory._entries = [];
  vectorMemory._idf = {};

  // Seed each formula
  for (let i = 0; i < FORMULAS.length; i++) {
    vectorMemory.store({
      residentId: 'math-lib',
      text: FORMULAS[i],
      metadata: { index: i, type: 'math-formula' },
      source: 'math-library',
    });
  }
  vectorMemory.save();

  console.log(`Seeded ${vectorMemory._entries.length} formulas\n`);

  // Test queries
  const queries = [
    '一个直角三角形，两条直角边分别是3和4，斜边是多少？',
    '已知圆锥底面半径3cm，高4cm，求体积？',
    '小明投硬币10次，每次正面的概率0.5，求正好5次正面的概率？',
    'y = sin(2x)的导数是什么？',
  ];

  for (const q of queries) {
    console.log(`\n───── 查询: ${q}`);
    const related = vectorMemory.search(q, { limit: 3, minScore: 0.02 });
    console.log(`  命中 ${related.length} 条相关公式:`);
    for (const r of related) {
      console.log(`  [${(r.score * 100).toFixed(0)}%] ${r.text.substring(0, 80)}`);
    }
    if (related.length === 0) {
      console.log('  (无相关公式)');
    }
  }

  console.log('\n=== Done. Formulas saved to ~/.openchat/vector-memory/ ===');
  console.log('Run eval: npm run eval:generalization -- --questions=1');
}

main().catch(e => console.error('Error:', e.message));
