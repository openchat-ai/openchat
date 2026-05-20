/**
 * TheoremDB — 定理数据库
 *
 * 层次化组织各学科的公式/定理/公理
 * 支持定理链：输出1 → 输入2 → 输出3
 */

export class TheoremDB {
  constructor() {
    this.theorems = new Map();
    this._loadAll();
  }

  _loadAll() {
    // ============ 算数 ============
    this.add('加法交换律', 'arithmetic', 1, 'a+b = b+a', (a,b) => a+b);
    this.add('加法结合律', 'arithmetic', 1, '(a+b)+c = a+(b+c)', null);
    this.add('乘法交换律', 'arithmetic', 1, 'a×b = b×a', null);
    this.add('乘法分配律', 'arithmetic', 2, 'a×(b+c) = a×b+a×c', null);

    // ============ 方程 ============
    this.add('等式加减法', 'algebra', 2, '若 a=b 则 a±c=b±c', (a,b,c,op) => op==='+'?a+c:a-c);
    this.add('等式乘除法', 'algebra', 2, '若 a=b 且 c≠0 则 a×c=b×c', null);
    this.add('一元一次通解', 'algebra', 2, 'ax+b=c → x=(c-b)/a', (a,b,c) => (c-b)/a);
    this.add('一元二次求根', 'algebra', 3, 'ax²+bx+c=0 → x=(-b±√Δ)/2a, Δ=b²-4ac', null);

    // ============ 几何 ============
    this.add('长方形面积', 'geometry', 1, 'S = l × w', (l,w) => l*w);
    this.add('三角形面积', 'geometry', 1, 'S = (b×h)/2', (b,h) => b*h/2);
    this.add('圆面积', 'geometry', 2, 'S = πr²', (r) => Math.PI*r*r);
    this.add('圆柱体积', 'geometry', 2, 'V = πr²h', (r,h) => Math.PI*r*r*h);
    this.add('正方体体积', 'geometry', 1, 'V = a³', (a) => a*a*a);
    this.add('正方体表面积', 'geometry', 1, 'S = 6a²', (a) => 6*a*a);
    this.add('长方体体积', 'geometry', 1, 'V = l×w×h', (l,w,h) => l*w*h);
    this.add('梯形面积', 'geometry', 2, 'S = (a+b)h/2', (a,b,h) => (a+b)*h/2);
    this.add('勾股定理', 'geometry', 3, 'a²+b²=c²', (a,b) => Math.sqrt(a*a+b*b));
    this.add('球体积', 'geometry', 3, 'V = 4πr³/3', (r) => 4*Math.PI*r*r*r/3);
    this.add('圆周长', 'geometry', 1, 'C = 2πr', (r) => 2*Math.PI*r);

    // ============ 概率 ============
    this.add('组合数', 'probability', 2, 'C(n,k) = n!/(k!(n-k)!)', null);
    this.add('概率补集', 'probability', 2, 'P(A) = 1-P(¬A)', (pNot) => 1-pNot);
    this.add('古典概型', 'probability', 2, 'P = 有利/总数', null);
    this.add('二项概率', 'probability', 3, 'P(X=k) = C(n,k)p^k(1-p)^{n-k}', null);

    // ============ 数论 ============
    this.add('欧几里得算法', 'number_theory', 2, 'gcd(a,b) = gcd(b, a%b)', null);
    this.add('lcm公式', 'number_theory', 2, 'lcm(a,b) = ab/gcd(a,b)', null);
    this.add('质数判定', 'number_theory', 2, 'n是质数当且仅当无小于√n的因数', null);

    // ============ 数列 ============
    this.add('等差数列通项', 'series', 2, 'aₙ = a₁+(n-1)d', (a1,d,n) => a1+(n-1)*d);
    this.add('等差数列求和', 'series', 2, 'Sₙ = n(a₁+aₙ)/2', (a1,an,n) => n*(a1+an)/2);
    this.add('等差数列求和2', 'series', 2, 'Sₙ = n[2a₁+(n-1)d]/2', null);
    this.add('等比数列求和', 'series', 3, 'Sₙ = a₁(1-qⁿ)/(1-q)', null);

    // ============ 比例/百分数 ============
    this.add('折扣公式', 'arithmetic', 1, '折后=原价×折扣率', (price,rate) => price*rate);
    this.add('百分数逆推', 'arithmetic', 2, '原量=现量/(1-用率)', (remain,used) => remain/(1-used/100));
    this.add('速度公式', 'arithmetic', 1, '路程=速度×时间', (v,t) => v*t);
    this.add('比例求解', 'arithmetic', 2, 'a:b = c:d → ad=bc', null);
    this.add('加价公式', 'arithmetic', 1, '售价=进价×(1+加价率)', (cost,rate) => cost*(1+rate/100));

    // ============ 工程问题 ============
    this.add('合作时间', 'work', 2, 't = 1/(1/a+1/b)', (a,b) => 1/(1/a+1/b));
    this.add('净速率', 'work', 2, '净速率 = 注水率-排水率', (inRate,outRate) => inRate-outRate);

    // ============ 逻辑 ============
    this.add('三段论', 'logic', 1, '所有A是B ∧ 所有B是C → 所有A是C', null);
    this.add('肯定前件', 'logic', 2, 'P→Q ∧ P → Q', null);
    this.add('否定后件', 'logic', 2, 'P→Q ∧ ¬Q → ¬P', null);
    this.add('传递性', 'logic', 1, 'a>b ∧ b>c → a>c', null);
  }

  add(name, subject, difficulty, formula, compute = null) {
    this.theorems.set(name, { name, subject, difficulty, formula, compute });
  }

  /**
   * 根据问题主题查找适用定理
   */
  findRelevant(question, subject = null) {
    const keywords = this._extractKeywords(question);
    const candidates = [];

    for (const [name, theorem] of this.theorems) {
      if (subject && theorem.subject !== subject) continue;
      let score = 0;
      for (const kw of keywords) {
        if (theorem.name.includes(kw) || theorem.formula.includes(kw)) score += 2;
        if (theorem.subject.includes(kw)) score += 1;
      }
      if (score > 0) candidates.push({ theorem, score });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  _extractKeywords(question) {
    const map = {
      '面积': ['面积', '几何', 'geometry'],
      '体积': ['体积', '几何', 'geometry'],
      '方程': ['方程', '代数', 'algebra'],
      'x=': ['方程', '代数'],
      '概率': ['概率', 'probability'],
      '折扣': ['折扣', '比例', '算术'],
      '公约': ['数论', 'number_theory'],
      '公倍': ['数论', 'number_theory'],
      '质数': ['数论'],
      '素数': ['数论'],
      '鸡': ['算术', '方程'],
      '兔': ['算术', '方程'],
      '求和': ['数列', 'series'],
    };
    const found = [];
    for (const [key, kws] of Object.entries(map)) {
      if (question.includes(key)) found.push(...kws);
    }
    return [...new Set(found)];
  }

  getStats() {
    return { totalTheorems: this.theorems.size };
  }
}
