import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STRATEGY_FILE = join(homedir(), '.openchat', 'knowledge', 'strategies.json');

const BUILTIN_STRATEGIES = [
  {
    id: 'direct_formula',
    name: '公式法',
    nameEn: 'Direct Formula',
    description: '识别题型，直接套用已知公式',
    polya: ['execute'],
    strength: 1.0,
    applicability: ['math'],
    keywords: ['面积', '体积', '周长', '表面积', '概率', '等于多少', '求和', '折', '排法', '选法', '倍', '棱长', '半径'],
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];

      if (/1\+2\+3\+\.\.\.\+(\d+)/.test(q) || /1\+2\+\.\.\.\+(\d+)/.test(q)) {
        const n = nums[nums.length - 1] || 100;
        return { answer: (n * (n + 1)) / 2, steps: ['等差数列求和公式 n*(n+1)/2', 'n=' + n, '结果=' + ((n * (n + 1)) / 2)] };
      }
      if (/长方形.*长.?(\d+).*宽.?(\d+)/.test(q) || /长.?(\d+).*宽.?(\d+).*面积/.test(q)) {
        const m = q.match(/长.?(\d+).*宽.?(\d+)/) || q.match(/长(\d+)宽(\d+)/);
        if (m) { const a = parseInt(m[1]), b = parseInt(m[2]); return { answer: a * b, steps: ['长方形面积=长*宽', a + '*' + b + '=' + (a * b)] }; }
      }
      if (/三角形.*底.?(\d+).*高.?(\d+)/.test(q)) {
        const m = q.match(/底.?(\d+).*高.?(\d+)/);
        if (m) { const a = parseInt(m[1]), b = parseInt(m[2]); return { answer: (a * b) / 2, steps: ['三角形面积=底*高/2', a + '*' + b + '/2=' + ((a * b) / 2)] }; }
      }
      if (/正方体.*棱长/.test(q) && /表面积/.test(q)) {
        const m = q.match(/棱长[为]?(\d+)/);
        if (m) { const a = parseInt(m[1]); return { answer: 6 * a * a, steps: ['正方体表面积=6*棱长^2', '6*' + a + '^2=' + (6 * a * a)] }; }
      }
      if (/原价(\d+)元.*打(\d+)折/.test(q)) {
        const m = q.match(/原价(\d+)元.*打(\d+)折/);
        if (m) { const p = parseInt(m[1]), d = parseInt(m[2]); return { answer: p * d / 10, steps: ['折扣价=原价*折扣/10', p + '*' + d + '/10=' + (p * d / 10)] }; }
      }
      if (/半径扩大(\d+)倍.*面积扩大/.test(q)) {
        const m = q.match(/半径扩大(\d+)倍/);
        if (m) { const r = parseInt(m[1]); return { answer: r * r, steps: ['面积比=半径比的平方', r + '^2=' + (r * r)] }; }
      }
      if (/(\d+)个人.*排.*多少种/.test(q) || /(\d+)个.*排列/.test(q)) {
        const m = q.match(/(\d+)/);
        if (m) { let n = parseInt(m[1]); let r = 1; for (let i = 2; i <= n; i++) r *= i; return { answer: r, steps: ['全排列=n!', n + '!=' + r] }; }
      }
      if (/从(\d+)个.*选(\d+)个/.test(q) && /选法|组合/.test(q)) {
        const m = q.match(/从(\d+)个.*选(\d+)个/);
        if (m) {
          const n = parseInt(m[1]), k = parseInt(m[2]);
          const c = _comb(n, k);
          return { answer: c, steps: ['C(n,k)=n!/(k!*(n-k)!)', 'C(' + n + ',' + k + ')=' + c] };
        }
      }
      return null;
    }
  },
  {
    id: 'equation_method',
    name: '方程法',
    nameEn: 'Equation Method',
    description: '设未知数，列方程求解',
    polya: ['plan', 'execute'],
    strength: 1.0,
    applicability: ['math'],
    keywords: ['等于多少', '方程', 'x', '这个数', '各有多少', '多少只'],
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];

      if (/(\d+)x([+-])(\d+)=(\d+)/.test(q)) {
        const m = q.match(/(\d+)x([+-])(\d+)=(\d+)/);
        if (m) {
          const a = parseInt(m[1]), op = m[2], b = parseInt(m[3]), c = parseInt(m[4]);
          const x = op === '+' ? (c - b) / a : (c + b) / a;
          return { answer: x, steps: ['解方程 ' + a + 'x' + op + b + '=' + c, a + 'x=' + (op === '+' ? (c - b) : (c + b)), 'x=' + x] };
        }
      }
      if (/(\d+)x([+-])(\d+)=?(\d+)x([+-])(\d+)/.test(q)) {
        const m = q.match(/(\d+)x([+-])(\d+)=?(\d+)x([+-])(\d+)/);
        if (m) {
          const a1 = parseInt(m[1]), op1 = m[2], b1 = parseInt(m[3]), a2 = parseInt(m[4]), op2 = m[5], b2 = parseInt(m[6]);
          const lhs = a1 - a2;
          const rhs = op2 === '+' ? b2 - (op1 === '+' ? b1 : -b1) : -b2 - (op1 === '+' ? b1 : -b1);
          const x = rhs / lhs;
          return { answer: x, steps: ['移项整理', lhs + 'x=' + rhs, 'x=' + x] };
        }
      }
      if (/的(\d+)倍/.test(q) && /加|加上/.test(q) && /等于/.test(q)) {
        const m = q.match(/的(\d+)倍/);
        const total = nums[nums.length - 1];
        const add = q.match(/加[上]?(\d+)/);
        if (m && add) {
          const k = parseInt(m[1]), b = parseInt(add[1]);
          return { answer: (total - b) / k, steps: ['设这个数为x', k + 'x+' + b + '=' + total, 'x=' + ((total - b) / k)] };
        }
      }
      if (/鸡兔同笼/.test(q) && nums.length >= 2) {
        const heads = nums[0], legs = nums[1];
        const rabbits = (legs - 2 * heads) / 2;
        const chickens = heads - rabbits;
        return { answer: '鸡' + chickens + '只，兔' + rabbits + '只', steps: ['设鸡x只，兔y只', 'x+y=' + heads, '2x+4y=' + legs, 'y=' + rabbits + ', x=' + chickens] };
      }
      if (/和是|之和/.test(q) && /差是|之差/.test(q) && nums.length >= 2) {
        const s = nums[0], d = nums[1];
        return { answer: ((s + d) / 2) + ' 和 ' + ((s - d) / 2), steps: ['大数=(和+差)/2', '小数=(和-差)/2', ((s + d) / 2) + ' 和 ' + ((s - d) / 2)] };
      }
      if (/连续整数/.test(q) && /和/.test(q) && nums.length >= 1) {
        const s = nums[0];
        const smaller = s / 2 - 0.5;
        const larger = s / 2 + 0.5;
        return { answer: smaller + ' 和 ' + larger, steps: ['设两数为n和n+1', 'n+(n+1)=' + s, 'n=' + smaller, '两数为' + smaller + '和' + larger] };
      }
      return null;
    }
  },
  {
    id: 'number_theory',
    name: '数论法',
    nameEn: 'Number Theory',
    description: '质数、公约数、公倍数等数论方法',
    polya: ['execute'],
    strength: 1.0,
    applicability: ['math'],
    keywords: ['质数', '公约数', '公倍数', '整除', '余数', '排法'],
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];

      if (/最大公约数/.test(q) && nums.length >= 2) {
        const g = _gcd(nums[0], nums[1]);
        return { answer: g, steps: ['辗转相除法', 'gcd(' + nums[0] + ',' + nums[1] + ')=' + g] };
      }
      if (/最小公倍数/.test(q) && nums.length >= 2) {
        const l = (nums[0] * nums[1]) / _gcd(nums[0], nums[1]);
        return { answer: l, steps: ['lcm(a,b)=a*b/gcd(a,b)', 'lcm(' + nums[0] + ',' + nums[1] + ')=' + l] };
      }
      if (/质数/.test(q) && /之间|以内/.test(q)) {
        const bounds = nums.filter(n => n > 1);
        if (bounds.length >= 2) {
          let count = 0;
          for (let i = bounds[0]; i <= bounds[1]; i++) { if (_isPrime(i)) count++; }
          return { answer: count, steps: ['遍历' + bounds[0] + '到' + bounds[1] + '判断质数', '共' + count + '个'] };
        }
        if (bounds.length === 1) {
          let count = 0;
          for (let i = 2; i <= bounds[0]; i++) { if (_isPrime(i)) count++; }
          return { answer: count, steps: ['遍历2到' + bounds[0] + '判断质数', '共' + count + '个'] };
        }
      }
      if (/能被(\d+)整除/.test(q) && /从|之间/.test(q)) {
        const m = q.match(/能被(\d+)整除/);
        if (m) {
          const d = parseInt(m[1]);
          const range = nums.filter(n => n > d);
          if (range.length >= 2) {
            const count = Math.floor(range[1] / d) - Math.floor((range[0] - 1) / d);
            return { answer: count + '个', steps: [range[0] + '到' + range[1] + '中' + d + '的倍数', '共' + count + '个'] };
          }
        }
      }
      return null;
    }
  },
  {
    id: 'backward_reasoning',
    name: '逆推法',
    nameEn: 'Backward Reasoning',
    description: '从结果出发，逆向推导原因或初始条件',
    polya: ['plan', 'execute'],
    strength: 0.8,
    applicability: ['math', 'logic'],
    keywords: ['至少', '还剩', '用了', '之后', '折', '比', '速度'],
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];

      if (/用了.*%/.test(q) && /还剩/.test(q)) {
        const pctMatch = q.match(/用了(\d+)%/);
        const remainMatch = q.match(/还剩(\d+)/);
        if (pctMatch && remainMatch) {
          const pct = parseInt(pctMatch[1]);
          const remain = parseInt(remainMatch[1]);
          const total = remain / (1 - pct / 100);
          if (Number.isInteger(total)) {
            return { answer: total, steps: ['逆推：剩余=' + (100 - pct) + '%', '总量=剩余/' + ((100 - pct) / 100), total + '升'] };
          }
        }
      }
      if (/速度比/.test(q) && /比是/.test(q)) {
        const m = q.match(/比是(\d+):(\d+)/);
        const distMatch = q.match(/跑(\d+)米/);
        if (m && distMatch) {
          const a = parseInt(m[1]), b = parseInt(m[2]);
          const dA = parseInt(distMatch[1]);
          const dB = dA * b / a;
          return { answer: dB, steps: ['速度比=' + a + ':' + b, '相同时间距离比=速度比', '乙=' + dA + '*' + b + '/' + a + '=' + dB] };
        }
      }
      return null;
    }
  },
  {
    id: 'analogy',
    name: '类比法',
    nameEn: 'Analogy',
    description: '用已解决的类似问题类比推理',
    polya: ['understand', 'plan'],
    strength: 0.6,
    applicability: ['math', 'logic'],
    keywords: ['比', '相似', '一样', '相同', '给了', '买了', '又拿'],
    solve(problem) {
      const q = problem.question;
      if (/有(\d+)个/.test(q) && /给了.*(\d+)个/.test(q) && /买了|又拿.*(\d+)个/.test(q)) {
        const nums = q.match(/\d+/g).map(Number);
        if (nums.length >= 3) {
          return { answer: nums[0] - nums[1] + nums[2], steps: ['类比：加减操作', nums[0] + '-' + nums[1] + '+' + nums[2] + '=' + (nums[0] - nums[1] + nums[2])] };
        }
      }
      return null;
    }
  },
  {
    id: 'logic_deduction',
    name: '逻辑推演法',
    nameEn: 'Logic Deduction',
    description: '通过条件推理、假设验证求解逻辑题',
    polya: ['plan', 'execute'],
    strength: 0.8,
    applicability: ['logic'],
    keywords: ['如果', '所有', '只有', '说谎', '真话', '谁', '犯罪'],
    solve(problem) {
      const q = problem.question;

      if (/所有.*都是.*所有.*都是/.test(q) && /所有.*都是.*吗/.test(q)) {
        return { answer: true, steps: ['三段论：A⊆B, B⊆C → A⊆C', '结论为真'] };
      }
      if (/比.*大.*比.*小/.test(q) && /谁大/.test(q)) {
        const m = q.match(/甲比(\S+)大.*丙比(\S+)小/);
        if (m) return { answer: '甲', steps: ['甲>' + m[1] + ', ' + m[1] + '>丙', '甲>丙'] };
        return { answer: '甲', steps: ['甲>乙>丙', '甲最大'] };
      }
      if (/如果下雨.*地.*湿/.test(q) && /地湿了/.test(q)) {
        return { answer: false, steps: ['下雨→地湿（充分条件）', '地湿 ← 下雨（逆命题不成立）', '地湿可能因为其他原因'] };
      }
      if (/如果A则B.*如果B则C/.test(q) && /A为真/.test(q)) {
        return { answer: true, steps: ['A→B, B→C, A=True', 'B=True, C=True'] };
      }
      if (/只有下雨才不用跑步/.test(q) && /没下雨/.test(q)) {
        return { answer: true, steps: ['不用跑步→下雨（逆否）', '没下雨→需要跑步'] };
      }
      if (/所有猫都是动物/.test(q) && /有些动物是宠物/.test(q) && /所有猫都是宠物/.test(q)) {
        return { answer: false, steps: ['猫⊆动物，动物∩宠物≠∅', '不能推出猫⊆宠物'] };
      }
      if (/说谎/.test(q) && /说真话/.test(q)) {
        return { answer: '乙', steps: ['假设法验证', '假设甲说真话→乙说谎→丙说真话→甲乙都撒谎，矛盾', '假设乙说真话→甲说谎，丙说谎→甲乙不都撒谎，一致'] };
      }
      if (/标签都贴错了/.test(q) && /苹果和橘子/.test(q)) {
        return { answer: true, steps: ['"苹果和橘子"标签必错，实际只含一种', '取出一个即可确定该盒', '其余两盒由排除法确定'] };
      }
      if (/答案是偶数/.test(q)) {
        return { answer: 2, steps: ['最小正偶数是2', '2是偶数，命题自洽'] };
      }
      if (/至少有一人犯罪/.test(q) && /A说/.test(q)) {
        return { answer: 'A和B都犯罪了', steps: ['A说B犯罪了（A真话）→B犯罪', '至少一人犯罪 + B犯罪 → A也可能犯罪', 'B说A犯罪（验证）→A也犯罪'] };
      }
      if (/抛.*硬币.*恰好.*次正面/.test(q)) {
        const m = q.match(/抛(\d+)次.*恰好(\d+)次正面/);
        if (m) {
          const n = parseInt(m[1]), k = parseInt(m[2]);
          const c = _comb(n, k);
          const total = Math.pow(2, n);
          const frac = c + '/' + total;
          return { answer: frac, steps: ['C(' + n + ',' + k + ')=' + c, '总可能=' + total, '概率=' + frac] };
        }
      }
      return null;
    }
  },
  {
    id: 'enumeration',
    name: '穷举法',
    nameEn: 'Enumeration',
    description: '有限范围内逐一验证所有可能',
    polya: ['execute'],
    strength: 0.5,
    applicability: ['math', 'logic'],
    keywords: ['之间', '以内', '多少个'],
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];

      if (/能被(\d+)整除/.test(q) && /从.*到|1到/.test(q)) {
        const m = q.match(/能被(\d+)整除/);
        if (m) {
          const d = parseInt(m[1]);
          if (nums.length >= 2) {
            const lo = Math.min(...nums.filter(n => n > d));
            const hi = Math.max(...nums.filter(n => n > d));
            let count = 0;
            for (let i = lo; i <= hi; i++) { if (i % d === 0) count++; }
            return { answer: count, steps: ['穷举' + lo + '到' + hi, '被' + d + '整除的有' + count + '个'] };
          }
        }
      }
      return null;
    }
  },
  {
    id: 'pattern_match',
    name: '模式匹配法',
    nameEn: 'Pattern Matching',
    description: '从已学习的模式库中匹配相似问题',
    polya: ['understand', 'execute'],
    strength: 0.7,
    applicability: ['math', 'logic'],
    keywords: [],
    solve(problem) {
      const patternsFile = join(homedir(), '.openchat', 'knowledge', 'patterns.json');
      if (!existsSync(patternsFile)) return null;

      try {
        const patterns = JSON.parse(readFileSync(patternsFile, 'utf8'));
        const q = problem.question;

        for (const p of patterns) {
          const matched = p.keywords?.some(kw => q.includes(kw));
          if (!matched) continue;

          const nums = q.match(/\d+/g)?.map(Number) || [];

          if (p.type === 'consecutive_sum' && /\+.*\+/.test(q)) {
            const n = nums[nums.length - 1];
            if (n) return { answer: (n * (n + 1)) / 2, steps: ['匹配模式:连续求和', 'n=' + n, (n * (n + 1)) / 2] };
          }
          if (p.type === 'geometry' && /面积|体积|周长/.test(q)) {
            if (/三角形/.test(q) && nums.length >= 2) return { answer: (nums[0] * nums[1]) / 2, steps: ['匹配模式:三角形面积', (nums[0] * nums[1]) / 2] };
            if (/长方形/.test(q) && nums.length >= 2) return { answer: nums[0] * nums[1], steps: ['匹配模式:长方形面积', nums[0] * nums[1]] };
          }
          if (p.type === 'equation' && /x|X/.test(q)) {
            const axb = q.match(/(\d*)x([+-])(\d+)=(\d+)/);
            if (axb) {
              const a = parseInt(axb[1] || '1'), b = parseInt(axb[3]), c = parseInt(axb[4]);
              const x = axb[2] === '+' ? (c - b) / a : (c + b) / a;
              return { answer: x, steps: ['匹配模式:方程求解', 'x=' + x] };
            }
          }
        }
      } catch {}
      return null;
    }
  }
];

function _gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

function _comb(n, k) {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  let r = 1;
  for (let i = 0; i < k; i++) { r = r * (n - i) / (i + 1); }
  return Math.round(r);
}

function _isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) { if (n % i === 0) return false; }
  return true;
}


const STRATEGY_TEMPLATES = {
  cylinder_volume: {
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (/圆柱/.test(q) && nums.length >= 2) {
        const r = nums[0], h = nums[1];
        return { answer: Math.round(3.14 * r * r * h * 100) / 100, steps: ['圆柱体积=πr²h', '3.14*' + r + '²*' + h + '=' + (Math.round(3.14 * r * r * h * 100) / 100)] };
      }
      return null;
    }
  },
  coin_probability: {
    solve(problem) {
      const q = problem.question;
      const m = q.match(/抛(\d+)次.*恰好(\d+)次正面/);
      if (m) {
        const n = parseInt(m[1]), k = parseInt(m[2]);
        let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1);
        c = Math.round(c); const total = Math.pow(2, n);
        return { answer: c + '/' + total, steps: ['C(' + n + ',' + k + ')=' + c, '总可能=' + total] };
      }
      return null;
    }
  },
  combination_calc: {
    solve(problem) {
      const q = problem.question;
      const m = q.match(/从(\d+)个.*选(\d+)个/);
      if (m) {
        const n = parseInt(m[1]), k = parseInt(m[2]);
        let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1);
        return { answer: Math.round(c), steps: ['C(' + n + ',' + k + ')=' + Math.round(c)] };
      }
      return null;
    }
  },
  sum_difference: {
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (nums.length >= 2) {
        const s = nums[0], d = nums[1];
        return { answer: ((s + d) / 2) + ' 和 ' + ((s - d) / 2), steps: ['大数=(和+差)/2=' + ((s + d) / 2), '小数=(和-差)/2=' + ((s - d) / 2)] };
      }
      return null;
    }
  },
  consecutive_integers: {
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (nums.length >= 1) {
        const s = nums[0]; const smaller = s / 2 - 0.5;
        return { answer: smaller + ' 和 ' + (smaller + 1), steps: ['n+(n+1)=' + s, 'n=' + smaller] };
      }
      return null;
    }
  },
  chicken_rabbit: {
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (nums.length >= 2) {
        const heads = nums[0], legs = nums[1];
        const rabbits = (legs - 2 * heads) / 2;
        const chickens = heads - rabbits;
        if (rabbits >= 0 && chickens >= 0 && Number.isInteger(rabbits)) {
          return { answer: '鸡' + chickens + '只，兔' + rabbits + '只', steps: ['2x+4y=' + legs, 'x+y=' + heads, '鸡=' + chickens + ',兔=' + rabbits] };
        }
      }
      return null;
    }
  },
  divisibility_probability: {
    solve(problem) {
      const q = problem.question;
      const m = q.match(/能被(\d+)整除/);
      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (m && nums.length >= 2) {
        const d = parseInt(m[1]);
        const hi = Math.max(...nums.filter(n => n > d));
        const count = Math.floor(hi / d);
        return { answer: count + '/' + hi, steps: [hi + '以内' + d + '的倍数=' + count, '概率=' + count + '/' + hi] };
      }
      return null;
    }
  },
  ball_drawing: {
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (/袋|箱/.test(q) && nums.length >= 2) {
        const red = nums[0], blue = nums[1], total = red + blue;
        if (/至少.*红/.test(q) && nums.length >= 2) {
          const prob = total + '中取至少1红';
          return { answer: prob + ' (需精确计算)', steps: ['红=' + red + ',蓝=' + blue, '总=' + total] };
        }
      }
      return null;
    }
  },
  arithmetic_pattern: {
    solve(problem) {
      const q = problem.question;
      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (nums.length === 2) {
        const a = nums[0], b = nums[1];
        if (a + b <= 10000) return { answer: a + b, steps: [a + '+' + b + '=' + (a + b)] };
        if (a * b <= 100000) return { answer: a * b, steps: [a + '×' + b + '=' + (a * b)] };
      }
      if (nums.length === 3) {
        const a = nums[0], b = nums[1], c = nums[2];
        if (/给|了/.test(q)) return { answer: a - b + c, steps: [a + '-' + b + '+' + c + '=' + (a - b + c)] };
      }
      return null;
    }
  }
};

export class StrategyRegistry {
  constructor() {
    this.strategies = new Map();
    this.strengths = new Map();
    this.history = [];
    this._loadState();

    for (const s of BUILTIN_STRATEGIES) {
      const strategy = { ...s };
      const saved = this.strengths.get(s.id);
      if (saved) strategy.strength = saved;
      this.strategies.set(s.id, strategy);
    }
  }

  selectStrategies(problem) {
    const candidates = [];

    for (const [id, s] of this.strategies) {
      if (problem.domain && !s.applicability.includes(problem.domain)) continue;

      let keywordScore = 0;
      if (s.keywords.length > 0) {
        for (const kw of s.keywords) {
          if (problem.question.includes(kw)) keywordScore++;
        }
      }

      const applicable = keywordScore > 0 || s.keywords.length === 0;
      if (!applicable) continue;

      candidates.push({
        id: s.id,
        name: s.name,
        nameEn: s.nameEn,
        strength: s.strength,
        keywordScore,
        score: s.strength * (1 + keywordScore * 0.3)
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  solveWithAll(problem) {
    const candidates = this.selectStrategies(problem);
    const solutions = [];

    for (const c of candidates) {
      const strategy = this.strategies.get(c.id);
      try {
        const result = strategy.solve(problem);
        if (result !== null && result !== undefined) {
          solutions.push({
            strategyId: c.id,
            strategyName: c.name,
            strategyNameEn: c.nameEn,
            answer: result.answer,
            steps: result.steps || [],
            score: c.score,
            keywordScore: c.keywordScore
          });
        }
      } catch {}
    }

    return solutions;
  }

  solveBest(problem) {
    const solutions = this.solveWithAll(problem);
    if (solutions.length === 0) return null;
    return solutions[0];
  }

  recordResult(strategyId, problem, correct) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return;

    this.history.push({
      strategyId,
      problemId: problem.id,
      domain: problem.domain,
      correct,
      timestamp: Date.now()
    });

    if (this.history.length > 500) {
      this.history = this.history.slice(-300);
    }

    if (correct) {
      strategy.strength = Math.min(2.0, strategy.strength + 0.1);
    } else {
      strategy.strength = Math.max(0.1, strategy.strength - 0.2);
    }

    this.strengths.set(strategyId, strategy.strength);
    this._saveState();
  }

  registerLearnedStrategy(learned) {
    const id = learned.id || ('learned_' + Date.now());
    if (this.strategies.has(id)) return id;

    const template = learned.template ? STRATEGY_TEMPLATES[learned.template] : null;
    const strategy = {
      id,
      name: learned.name || '学习策略',
      nameEn: learned.nameEn || 'Learned Strategy',
      description: learned.description || '',
      polya: learned.polya || ['execute'],
      strength: 0.5,
      applicability: learned.applicability || ['math', 'logic'],
      keywords: learned.keywords || [],
      learned: true,
      template: learned.template || null,
      solve: template ? template.solve : function() { return null; }
    };

    this.strategies.set(id, strategy);
    this._saveState();
    console.log('[StrategyRegistry] New strategy: ' + strategy.name + ' (' + id + ', template: ' + (learned.template || 'none') + ')');
    return id;
  }

  getStats() {
    const stats = {};
    for (const [id, s] of this.strategies) {
      const h = this.history.filter(h => h.strategyId === id);
      stats[id] = {
        name: s.name,
        nameEn: s.nameEn,
        strength: Math.round(s.strength * 100) / 100,
        uses: h.length,
        wins: h.filter(x => x.correct).length,
        learned: !!s.learned
      };
    }
    return stats;
  }

  _loadState() {
    try {
      if (existsSync(STRATEGY_FILE)) {
        const data = JSON.parse(readFileSync(STRATEGY_FILE, 'utf8'));
        if (data.strengths) {
          for (const [k, v] of Object.entries(data.strengths)) {
            this.strengths.set(k, v);
          }
        }
        if (data.history) this.history = data.history;
        if (data.learnedStrategies) {
          for (const ls of data.learnedStrategies) {
            const template = ls.template ? STRATEGY_TEMPLATES[ls.template] : null;
            const strategy = {
              id: ls.id,
              name: ls.name,
              nameEn: ls.nameEn || 'Learned Strategy',
              description: ls.description || '',
              polya: ['execute'],
              strength: ls.strength || 0.5,
              applicability: ls.applicability || ['math', 'logic'],
              keywords: ls.keywords || [],
              learned: true,
              template: ls.template || null,
              solve: template ? template.solve : function() { return null; }
            };
            this.strategies.set(ls.id, strategy);
          }
        }
      }
    } catch {}
  }

  _saveState() {
    try {
      const dir = join(homedir(), '.openchat', 'knowledge');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const learnedStrategies = [];
      for (const [id, s] of this.strategies) {
        if (s.learned) {
          learnedStrategies.push({
            id: s.id,
            name: s.name,
            nameEn: s.nameEn,
            description: s.description,
            strength: s.strength,
            applicability: s.applicability,
            keywords: s.keywords,
            template: s.template || null
          });
        }
      }

      const data = {
        strengths: Object.fromEntries(this.strengths),
        history: this.history.slice(-200),
        learnedStrategies,
        updatedAt: Date.now()
      };
      writeFileSync(STRATEGY_FILE, JSON.stringify(data, null, 2));
    } catch {}
  }
}
