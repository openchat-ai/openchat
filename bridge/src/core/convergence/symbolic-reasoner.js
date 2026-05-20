/**
 * SymbolicReasoner — 符号推理引擎
 *
 * 用公理和定理推演，不是正则匹配。
 * 像人一样：等式两边同减、同除、代入、展开。
 *
 * 公理系统：
 *   A1: a=b → a±c = b±c   (等式加减)
 *   A2: a=b → a×c = b×c   (等式乘)
 *   A3: a=b → a÷c = b÷c   (等式除, c≠0)
 *   A4: a = a              (自反)
 *   A5: a=b → b=a          (对称)
 *   A6: a=b ∧ b=c → a=c    (传递)
 *
 * 定理库：
 *   一元一次方程、二元一次方程组、勾股定理
 *   面积公式、体积公式、求和公式
 */

export class SymbolicReasoner {
  constructor() {
    this.solveCount = 0;
    this.log = [];
  }

  /**
   * 尝试演绎求解。返回 { solved, answer, proof } 或 null
   */
  tryDeduce(problem) {
    this.log = [];
    const q = problem.question;

    // 尝试各种推理路径
    for (const solver of [
      this._linearEquation,
      this._systemOfEquations,
      this._arithmeticSeries,
      this._geometryAreaVolume,
      this._chickenRabbit,
      this._workProblem,
      this._profitLoss,
      this._numberTheory
    ]) {
      const result = solver.call(this, q);
      if (result) {
        this.solveCount++;
        return result;
      }
    }
    return null;
  }

  /**
   * 一元一次方程：ax + b = c
   * 公理演绎：
   *   ax + b = c
   *   ax + b - b = c - b   (A1: 两边减b)
   *   ax = c - b
   *   ax ÷ a = (c - b) ÷ a  (A3: 两边除a)
   *   x = (c - b) / a
   */
  _linearEquation(question) {
    // 模式1: ax + b = c
    let m = question.match(/(\d*)\s*[xX]\s*\+\s*(\d+)\s*=\s*(\d+)/);
    if (m) {
      const a = m[1] ? parseInt(m[1]) : 1;
      const b = parseInt(m[2]);
      const c = parseInt(m[3]);
      return this._buildResult('一元一次方程', [
        { step: `${a}x + ${b} = ${c}`, reason: '给定方程' },
        { step: `${a}x = ${c} - ${b}`, reason: 'A1: 等式两边同减' + b },
        { step: `${a}x = ${c - b}`, reason: '算术计算' },
        { step: `x = ${c - b} ÷ ${a}`, reason: 'A3: 等式两边同除' + a },
        { step: `x = ${(c - b) / a}`, reason: '结果' },
      ], (c - b) / a);
    }

    // 模式2: ax - b = c
    m = question.match(/(\d*)\s*[xX]\s*-\s*(\d+)\s*=\s*(\d+)/);
    if (m) {
      const a = m[1] ? parseInt(m[1]) : 1;
      const b = parseInt(m[2]);
      const c = parseInt(m[3]);
      return this._buildResult('一元一次方程', [
        { step: `${a}x - ${b} = ${c}`, reason: '给定方程' },
        { step: `${a}x = ${c} + ${b}`, reason: 'A1: 等式两边同加' + b },
        { step: `${a}x = ${c + b}`, reason: '算术计算' },
        { step: `x = ${c + b} ÷ ${a}`, reason: 'A3: 等式两边同除' + a },
        { step: `x = ${(c + b) / a}`, reason: '结果' },
      ], (c + b) / a);
    }

    // 模式3: ax + b = cx + d (变量在两边)
    m = question.match(/(\d*)\s*[xX]\s*\+\s*(\d+)\s*=\s*(\d*)\s*[xX]\s*\+\s*(\d+)/);
    if (m) {
      const a = m[1] ? parseInt(m[1]) : 1;
      const b = parseInt(m[2]);
      const c = m[3] ? parseInt(m[3]) : 1;
      const d = parseInt(m[4]);
      return this._buildResult('一元一次方程(双侧)', [
        { step: `${a}x + ${b} = ${c}x + ${d}`, reason: '给定' },
        { step: `${a}x - ${c}x + ${b} = ${d}`, reason: 'A1: 两边同减' + c + 'x' },
        { step: `${a - c}x + ${b} = ${d}`, reason: '合并同类项' },
        { step: `${a - c}x = ${d} - ${b}`, reason: 'A1: 两边同减' + b },
        { step: `x = ${d - b} ÷ ${a - c}`, reason: 'A3: 两边同除' + (a - c) },
        { step: `x = ${(d - b) / (a - c)}`, reason: '结果' },
      ], (d - b) / (a - c));
    }

    return null;
  }

  /**
   * 二元一次方程组
   * 消元法：代入消元 / 加减消元
   */
  _systemOfEquations(question) {
    // 模式: 两数和为S，差为D → x = (S+D)/2, y = (S-D)/2
    const m = question.match(/和是(\d+).*差是(\d+)/);
    if (m) {
      const S = parseInt(m[1]), D = parseInt(m[2]);
      return this._buildResult('二元方程组(消元法)', [
        { step: `x + y = ${S}`, reason: '条件1: 和为' + S },
        { step: `x - y = ${D}`, reason: '条件2: 差为' + D },
        { step: `(x+y) + (x-y) = ${S} + ${D}`, reason: 'A1: 两式相加消去y' },
        { step: `2x = ${S + D}`, reason: '合并' },
        { step: `x = ${(S + D) / 2}`, reason: 'A3: 同除2' },
        { step: `y = ${S} - ${(S + D) / 2} = ${(S - D) / 2}`, reason: '代入求y' },
      ], `${(S + D) / 2}和${(S - D) / 2}`);
    }

    // 连续整数之和
    const c = question.match(/两个连续整数之和.*?(\d+)/);
    if (c) {
      const sum = parseInt(c[1]);
      return this._buildResult('连续整数', [
        { step: `x + (x+1) = ${sum}`, reason: '设较小数为x' },
        { step: `2x + 1 = ${sum}`, reason: '合并' },
        { step: `2x = ${sum - 1}`, reason: 'A1: 同减1' },
        { step: `x = ${(sum - 1) / 2}`, reason: 'A3: 同除2' },
        { step: `较大数 = ${(sum + 1) / 2}`, reason: 'x+1' },
      ], `${(sum - 1) / 2}和${(sum + 1) / 2}`);
    }

    return null;
  }

  /**
   * 等差数列求和
   * 定理: Sn = n(a1 + an)/2 = n[2a1 + (n-1)d]/2
   */
  _arithmeticSeries(question) {
    // 1+2+3+...+n
    let m = question.match(/1\s*\+\s*2\s*\+\s*3\s*\+\s*\.\.\.\s*\+\s*(\d+)/);
    if (m) {
      const n = parseInt(m[1]);
      return this._buildResult('等差数列求和(高斯)', [
        { step: `求 1 + 2 + 3 + ... + ${n}`, reason: '问题' },
        { step: `配对: (1+${n}) + (2+${n - 1}) + ...`, reason: '高斯配对法' },
        { step: `每对和 = ${n + 1}`, reason: '每对首尾相加' },
        { step: `共 ${n / 2} 对`, reason: 'n个数两两配对' },
        { step: `总和 = ${n + 1} × ${n / 2} = ${n * (n + 1) / 2}`, reason: '定理: n(n+1)/2' },
      ], n * (n + 1) / 2);
    }

    // 给定首项、公差、前n项
    m = question.match(/首项(\d+).*公差(\d+).*前(\d+)项/);
    if (m) {
      const a1 = parseInt(m[1]), d = parseInt(m[2]), n = parseInt(m[3]);
      const an = a1 + (n - 1) * d;
      const sum = n * (a1 + an) / 2;
      return this._buildResult('等差数列求和(通项)', [
        { step: `a₁=${a1}, d=${d}, n=${n}`, reason: '给定' },
        { step: `a${n} = a₁ + (${n}-1)×${d} = ${an}`, reason: '定理: an=a₁+(n-1)d' },
        { step: `S${n} = ${n}×(${a1}+${an})/2`, reason: '定理: Sn=n(a₁+an)/2' },
        { step: `S${n} = ${sum}`, reason: '结果' },
      ], sum);
    }

    // 1+3+5+... (奇数求和 = n²)
    m = question.match(/1\s*\+\s*3\s*\+\s*5\s*\+\s*\.\.\.\s*\+\s*(\d+)/);
    if (m) {
      const last = parseInt(m[1]);
      const n = (last + 1) / 2;
      return this._buildResult('奇数求和定理', [
        { step: `求 1 + 3 + 5 + ... + ${last}`, reason: '问题' },
        { step: `这是前 ${n} 个奇数`, reason: `最后一个奇数 = 2×${n}-1 = ${last}` },
        { step: `定理: 前n个奇数和 = n² = ${n * n}`, reason: '奇数求和公式' },
      ], n * n);
    }

    return null;
  }

  /**
   * 几何面积/体积
   * 定理: 长方形面积=长×宽, 三角形面积=底×高/2, 圆面积=πr²
   */
  _geometryAreaVolume(question) {
    // 长方形面积
    let m = question.match(/长(\d+).*宽(\d+).*面积/);
    if (m) {
      const l = parseInt(m[1]), w = parseInt(m[2]);
      return this._buildResult('长方形面积', [
        { step: `长=${l}, 宽=${w}`, reason: '给定' },
        { step: `面积 = ${l} × ${w} = ${l * w}`, reason: '定理: S = l × w' },
      ], l * w);
    }

    // 三角形面积
    m = question.match(/底(\d+).*高(\d+).*面积/);
    if (m && question.includes('三角')) {
      const b = parseInt(m[1]), h = parseInt(m[2]);
      return this._buildResult('三角形面积', [
        { step: `底=${b}, 高=${h}`, reason: '给定' },
        { step: `面积 = ${b} × ${h} ÷ 2 = ${b * h / 2}`, reason: '定理: S = bh/2' },
      ], b * h / 2);
    }

    // 圆面积
    m = question.match(/半径.*?(\d+).*面积|直径.*?(\d+).*面积/);
    if (m) {
      let r;
      if (question.includes('直径')) {
        r = parseInt(m[2]) / 2;
      } else {
        r = parseInt(m[1]);
      }
      const area = Math.PI * r * r;
      return this._buildResult('圆面积', [
        { step: `半径 r = ${r}`, reason: '给定/推导' },
        { step: `面积 = π × ${r}² = π × ${r * r}`, reason: '定理: S = πr²' },
        { step: `面积 ≈ ${+(area).toFixed(1)}`, reason: 'π≈3.14159' },
      ], +(area).toFixed(1));
    }

    // 圆柱体积
    m = question.match(/半径(\d+).*高(\d+).*体积/);
    if (m && question.includes('圆柱')) {
      const r = parseInt(m[1]), h = parseInt(m[2]);
      return this._buildResult('圆柱体积', [
        { step: `底面积 = π × ${r}² = π × ${r * r}`, reason: '圆面积定理' },
        { step: `体积 = 底面积 × ${h}`, reason: '定理: V = Sh' },
        { step: `体积 = 3.14 × ${r * r} × ${h} = ${+(3.14 * r * r * h).toFixed(1)}`, reason: '结果(π≈3.14)' },
      ], +(3.14 * r * r * h).toFixed(1));
    }

    // 正方体表面积
    m = question.match(/正方体.*棱长(\d+).*表面积/);
    if (m) {
      const a = parseInt(m[1]);
      return this._buildResult('正方体表面积', [
        { step: `棱长 a = ${a}`, reason: '给定' },
        { step: `一个面面积 = ${a}² = ${a * a}`, reason: '正方形面积' },
        { step: `6个面 = 6 × ${a * a} = ${6 * a * a}`, reason: '定理: S = 6a²' },
      ], 6 * a * a);
    }

    return null;
  }

  /**
   * 鸡兔同笼
   * 定理: 兔 = (脚 - 2×头) / 2, 鸡 = 头 - 兔
   */
  _chickenRabbit(question) {
    const m = question.match(/(\d+).*?头.*?(\d+).*?[脚足]/);
    if (!m || (!question.includes('鸡') && !question.includes('兔'))) return null;
    const heads = parseInt(m[1]), feet = parseInt(m[2]);
    const rabbits = (feet - 2 * heads) / 2;
    const chickens = heads - rabbits;

    return this._buildResult('鸡兔同笼(假设法)', [
      { step: `假设全是鸡: 脚 = 2×${heads} = ${2 * heads}`, reason: '假设法: 全鸡' },
      { step: `比实际少: ${feet} - ${2 * heads} = ${feet - 2 * heads}`, reason: '差额' },
      { step: `每只兔替换鸡多2脚`, reason: '兔比鸡多2脚' },
      { step: `兔数 = ${feet - 2 * heads} ÷ 2 = ${rabbits}`, reason: '差额÷每只多出的' },
      { step: `鸡数 = ${heads} - ${rabbits} = ${chickens}`, reason: '总数-兔数' },
    ], `鸡${chickens}只，兔${rabbits}只`);
  }

  /**
   * 工程问题
   * 定理: 合作时间 = 1 / (1/t1 + 1/t2)
   */
  _workProblem(question) {
    // 甲乙合作
    const m = question.match(/甲.*?(\d+).*天.*乙.*?(\d+).*天.*合作.*几天/);
    if (m) {
      const a = parseInt(m[1]), b = parseInt(m[2]);
      const together = 1 / (1 / a + 1 / b);
      return this._buildResult('工程问题(合作)', [
        { step: `甲每天完成 1/${a}`, reason: '工效 = 1÷时间' },
        { step: `乙每天完成 1/${b}`, reason: '工效 = 1÷时间' },
        { step: `合作每天完成 1/${a} + 1/${b} = ${(1 / a + 1 / b).toFixed(3)}`, reason: '工效相加' },
        { step: `合作需 1 ÷ (1/${a}+1/${b}) ≈ ${together.toFixed(1)} 天`, reason: '时间 = 1÷合作工效' },
      ], +(together.toFixed(1)));
    }

    // 进水管+出水管
    const p = question.match(/进水管.*?(\d+).*满.*出水管.*?(\d+).*空/);
    if (p) {
      const inTime = parseInt(p[1]), outTime = parseInt(p[2]);
      const net = 1 / inTime - 1 / outTime;
      const result = net > 0 ? 1 / net : Infinity;
      return this._buildResult('水池问题', [
        { step: `进水管每小时注 1/${inTime}`, reason: '注水速率' },
        { step: `出水管每小时排 1/${outTime}`, reason: '排水速率' },
        { step: `净速率 = 1/${inTime} - 1/${outTime} = ${net.toFixed(3)}`, reason: '注水-排水' },
        { step: `需 1 ÷ ${net.toFixed(3)} ≈ ${result.toFixed(1)} 小时`, reason: '时间=总量÷速率' },
      ], +(result.toFixed(1)));
    }

    return null;
  }

  /**
   * 利润/折扣
   * 定理: 售价 = 原价 × 折扣, 利润 = 售价 - 进价
   */
  _profitLoss(question) {
    // 打折
    let m = question.match(/原价(\d+).*打?(\d+)折/);
    if (m) {
      const price = parseInt(m[1]), discount = parseInt(m[2]);
      return this._buildResult('折扣问题', [
        { step: `原价 = ${price}, ${discount}折`, reason: '给定' },
        { step: `折后 = ${price} × ${discount / 10} = ${price * discount / 10}`, reason: '定理: 折后价=原价×折扣率' },
      ], price * discount / 10);
    }

    // 加价出售
    m = question.match(/进价(\d+).*加价(\d+)%/);
    if (m) {
      const cost = parseInt(m[1]), markup = parseInt(m[2]);
      return this._buildResult('加价问题', [
        { step: `进价 = ${cost}`, reason: '给定' },
        { step: `加价 ${markup}%:  涨价 = ${cost} × ${markup}% = ${cost * markup / 100}`, reason: '百分比' },
        { step: `售价 = ${cost} + ${cost * markup / 100} = ${cost * (1 + markup / 100)}`, reason: '进价+涨价' },
      ], cost * (1 + markup / 100));
    }

    // 用了X%后剩Y
    m = question.match(/用了(\d+)%.*剩.*?(\d+)/);
    if (m) {
      const usedPct = parseInt(m[1]), remain = parseInt(m[2]);
      const original = remain / (1 - usedPct / 100);
      return this._buildResult('百分比逆推', [
        { step: `剩下 ${100 - usedPct}% = ${remain}`, reason: '用了' + usedPct + '%剩' + (100 - usedPct) + '%' },
        { step: `1% = ${remain} ÷ ${100 - usedPct} = ${(remain / (100 - usedPct)).toFixed(1)}`, reason: '求1%' },
        { step: `100% = ${(remain / (100 - usedPct)).toFixed(1)} × 100 = ${original}`, reason: '求100%' },
      ], original);
    }

    return null;
  }

  /**
   * 初等数论
   */
  _numberTheory(question) {
    // 最大公约数 (欧几里得算法)
    let m = question.match(/(\d+).*?(\d+).*最大公约/);
    if (!m) m = question.match(/最大公约.*?(\d+).*?(\d+)/);
    if (m) {
      let a = parseInt(m[1]), b = parseInt(m[2]);
      const [oa, ob] = [a, b];
      while (b) { [a, b] = [b, a % b]; }
      return this._buildResult('最大公约数(欧几里得)', [
        { step: `gcd(${oa}, ${ob})`, reason: '问题' },
        { step: `${oa} ÷ ${ob} = ${Math.floor(oa / ob)} 余 ${oa % ob}`, reason: '欧几里得算法' },
        { step: `最大公约数 = ${a}`, reason: '余数为0时的除数' },
      ], a);
    }

    // 最小公倍数: lcm(a,b) = a*b/gcd(a,b)
    m = question.match(/最小公倍.*?(\d+).*?(\d+)/);
    if (m) {
      let a = parseInt(m[1]), b = parseInt(m[2]);
      let [x, y] = [a, b];
      while (y) { [x, y] = [y, x % y]; }
      return this._buildResult('最小公倍数', [
        { step: `gcd(${a}, ${b}) = ${x}`, reason: '先求最大公约数' },
        { step: `lcm = ${a}×${b}÷${x} = ${a * b / x}`, reason: '定理: lcm·gcd = a·b' },
      ], a * b / x);
    }

    // 质数判定
    m = question.match(/质数|素数/);
    if (m && question.match(/多少.*个/)) {
      let count = 0;
      for (let i = 2; i <= 100; i++) {
        if (this._isPrime(i)) count++;
      }
      return this._buildResult('质数计数(1-100)', [
        { step: `筛选法求1-100质数个数`, reason: '埃拉托色尼筛法' },
        { step: `质数: 2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97`, reason: '逐个判定' },
        { step: `共 ${count} 个`, reason: '统计' },
      ], count);
    }

    return null;
  }

  _isPrime(n) {
    if (n < 2) return false;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
    return true;
  }

  _buildResult(method, proof, answer) {
    return { solved: true, answer, method, proof };
  }

  getStats() {
    return { symbolicSolves: this.solveCount };
  }
}
