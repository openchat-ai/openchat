import logger from '../monitoring/logger.js';
/**
 * UniversalSolver — 统一求解引擎
 *
 * 不区分数学/编程/逻辑/物理。
 * 一个知识图谱 + 一个推理引擎 + 一个规则系统。
 *
 * 任何领域的问题进来：
 *   1. 归一化 → 提取结构化信息
 *   2. 定理匹配 → 从知识图谱找适用规则
 *   3. 演绎求解 → 定理链推导答案
 *   4. 验证 → 结果可验证/可直接执行
 */

export class UniversalSolver {
  constructor() {
    this.rules = new Map();
    this.concepts = new Map();
    this.history = [];
    this._langKey = {
      area: ['面积','area'],
      volume: ['体积','volume'],
      rectangle: ['长方','矩形','rectangle'],
      triangle: ['三角','triangle'],
      circle: ['圆','circle','圆形'],
      cylinder: ['圆柱','cylinder'],
      cube: ['正方体','正方','cube'],
      equation: ['方程','solve','find x','求x'],
      discount: ['折','discount','%off','off','percent off'],
      gcd: ['公约','gcd','最大公因数','greatest common divisor'],
      lcm: ['公倍','lcm','最小公倍数','least common multiple'],
      prime: ['质数','素数','prime'],
      sum: ['和','sum','求和','total','总共','加起来','add'],
      max: ['最大','max','maximum','largest','biggest'],
      min: ['最小','min','minimum','smallest'],
      reverse: ['反转','reverse','反向','backward'],
      fibonacci: ['斐波那契','fibonacci','fib'],
      search: ['查找','search','二分','find','寻找'],
      chicken: ['鸡','chicken','hen'],
      rabbit: ['兔','rabbit'],
      speed: ['时速','speed','km/h','mile'],
      work: ['合作','together','合作几天','work together','days together'],
      percent: ['百分','percent','%'],
    };
    this._bootstrap();
  }

  _has(text, key) {
    const kws = this._langKey[key] || [key];
    return kws.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
  }

  _struct(question) {
    const q = this._chineseToArabic(question);
    const nums = q.match(/\d+/g)?.map(Number) || [];
    return {
      nums, hasX: /[xX]/.test(q) || this._has(q,'equation'),
      isEq: /[=＝]/.test(q),
      isPlus: /[+＋加]/.test(q) && !this._has(q,'gcd') && !this._has(q,'lcm'),
      isMinus: /[-－减]/.test(q),
      area: this._has(q,'area'),
      volume: this._has(q,'volume'),
      rectangle: this._has(q,'rectangle') && !this._has(q,'equation'),
      triangle: this._has(q,'triangle'),
      circle: this._has(q,'circle'),
      cylinder: this._has(q,'cylinder'),
      cube: this._has(q,'cube'),
      discount: this._has(q,'discount'),
      numberTheory: this._has(q,'gcd') || this._has(q,'lcm') || this._has(q,'prime'),
      series: /\.\.\.|到/.test(q) && !this._has(q,'discount'),
      sort: this._has(q,'max') || this._has(q,'min'),
      reverse: this._has(q,'reverse'),
      fibonacci: this._has(q,'fibonacci'),
      search: this._has(q,'search'),
      chicken: this._has(q,'chicken'),
      rabbit: this._has(q,'rabbit'),
      speed: this._has(q,'speed'),
      work: this._has(q,'work'),
      percent: this._has(q,'percent'),
    };
  }

  _chineseToArabic(q) {
    const map = [
      ['九十',90],['八十',80],['七十',70],['六十',60],['五十',50],['四十',40],['三十',30],['二十',20],['十',10],
      ['九百',900],['八百',800],['七百',700],['六百',600],['五百',500],['四百',400],['三百',300],['二百',200],['一百',100],
      ['九',9],['八',8],['七',7],['六',6],['五',5],['四',4],['三',3],['二',2],['两',2],['一',1],['百',100],['千',1000],
      // English numbers (longer first to avoid partial matches)
      ['thousand',1000],['hundred',100],['ninety',90],['eighty',80],['seventy',70],['sixty',60],['fifty',50],['forty',40],['thirty',30],['twenty',20],
      ['nineteen',19],['eighteen',18],['seventeen',17],['sixteen',16],['fifteen',15],['fourteen',14],['thirteen',13],['twelve',12],['eleven',11],['ten',10],
      ['nine',9],['eight',8],['seven',7],['six',6],['five',5],['four',4],['three',3],['two',2],['one',1],['zero',0],
    ];
    let r = q.toLowerCase();
    for (const [word, num] of map) r = r.replace(new RegExp(word, 'g'), String(num));
    return r;
  }

  _bootstrap() {
    // ===== 通用规则模板 =====
    // 每条规则：match(question) → solve(question) → answer
    // 不分 domain，只按概念组织

    this.addConcept('addition', []);
    this.addConcept('multiplication', ['addition']);
    this.addConcept('subtraction', ['addition']);
    this.addConcept('division', ['multiplication']);
    this.addConcept('exponentiation', ['multiplication']);
    this.addConcept('equations', ['addition', 'multiplication']);
    this.addConcept('area', ['multiplication']);
    this.addConcept('volume', ['area']);
    this.addConcept('percentage', ['multiplication']);
    this.addConcept('probability', ['percentage']);
    this.addConcept('number_theory', ['division']);
    this.addConcept('geometry_basic', ['area', 'volume']);
    this.addConcept('series', ['addition']);
    this.addConcept('sorting', ['comparison', 'loops']);
    this.addConcept('searching', ['comparison', 'sorting']);
    this.addConcept('recursion', ['functions']);
    this.addConcept('variable', []);
    this.addConcept('conditionals', ['variable']);
    this.addConcept('loops', ['variable', 'conditionals']);
    this.addConcept('functions', ['variable', 'loops']);
    this.addConcept('greedy', ['sorting']);
    this.addConcept('dynamic_programming', ['recursion']);
    this.addConcept('data_structures', ['variable']);
    this.addConcept('strings', ['loops']);
    this.addConcept('logic_basic', []);
    this.addConcept('rate_work', ['division']);
    this.addConcept('ratio_proportion', ['multiplication', 'division']);
    this.addConcept('statistics', ['addition', 'division']);

    // ===== 内置规则（跨领域） =====

    // --- 算术 ---
    this.addRule('两数和', 'addition', (q) => {
      if (/公约|公倍|质数|素数/.test(q)) return null;
      const m = q.match(/(\d+).*和.*(\d+)/);
      return m ? parseInt(m[1]) + parseInt(m[2]) : null;
    }, 1);

    this.addRule('两数差', 'addition', (q) => {
      const m = q.match(/(\d+).*差.*?(\d+)/); return m ? parseInt(m[1]) - parseInt(m[2]) : null;
    }, 1);

    this.addRule('连加', 'addition', (q) => {
      if (/方程|[xX=]|面积|体积|折|公约|公倍|质数|概率|数列|.../.test(q)) return null;
      const nums = q.match(/\d+/g)?.map(Number) || [];
      return nums.length >= 2 ? nums.reduce((a,b)=>a+b,0) : null;
    }, 1);

    this.addRule('折扣', 'multiplication', (q) => {
      const m = q.match(/(\d+).*?(\d+)\s*折/); return m ? parseInt(m[1]) * parseInt(m[2]) / 10 : null;
    }, 1);

    // --- 方程 ---
    this.addRule('一元一次方程', 'equations', (q) => {
      const m = q.match(/(\d*)\s*[xX]\s*[＋+-]\s*(\d+)\s*[＝=]\s*(\d+)/);
      if (!m) return null;
      const a = m[1] ? parseInt(m[1]) : 1, b = parseInt(m[2]), c = parseInt(m[3]);
      return q.includes('-') ? (c + b) / a : (c - b) / a;
    }, 2);

    // --- 几何 ---
    this.addRule('长方形面积', 'area', (q) => {
      const s = this._struct(q);
      if (!s.rectangle && !s.area) return null;
      const m = q.match(/长.*?(\d+).*?宽.*?(\d+)/) || q.match(/(\d+).*?[×xby].*?(\d+)/i) || q.match(/(\d+)\s+by\s+(\d+)/i);
      return m ? parseInt(m[1]) * parseInt(m[2]) : null;
    }, 1);
    
    this.addRule('百分比折扣', 'percentage', (q) => {
      const s = this._struct(q);
      if (!s.discount) return null;
      const offMatch = q.match(/(\d+)\s*%?\s*(off|discount)/i) || q.match(/(off|discount)\s*(\d+)\s*%/i);
      if (offMatch) {
        const price = s.nums[0], off = parseInt(offMatch[1]||offMatch[2]);
        return price * (1 - off / 100);
      }
      return null;
    }, 1);

    this.addRule('三角形面积', 'area', (q) => {
      const m = q.match(/底.*?(\d+).*?高.*?(\d+)/);
      return m ? parseInt(m[1]) * parseInt(m[2]) / 2 : null;
    }, 2);

    this.addRule('圆柱体积', 'volume', (q) => {
      const m = q.match(/半径.*?(\d+).*?高.*?(\d+)/);
      if (!m || !q.includes('圆柱')) return null;
      const r = parseInt(m[1]), h = parseInt(m[2]);
      return +(3.14 * r * r * h).toFixed(1);
    }, 2);

    this.addRule('正方体表面积', 'geometry_basic', (q) => {
      const m = q.match(/正方体.*棱长(\d+)|棱长(\d+).*正方体/);
      if (!m || !/表面积/.test(q)) return null;
      const a = parseInt(m[1] || m[2]);
      return 6 * a * a;
    }, 2);

    this.addRule('最大公约数', 'number_theory', (q) => {
      const m = q.match(/(\d+).*?(\d+).*最大公约/) || q.match(/最大公约.*?(\d+).*?(\d+)/);
      if (!m) return null;
      let a = parseInt(m[1]), b = parseInt(m[2]);
      let [x, y] = [a, b];
      while (y) { [x, y] = [y, x % y]; }
      return x;
    }, 2);

    this.addRule('最小公倍数', 'number_theory', (q) => {
      const m = q.match(/(\d+).*?(\d+).*最小公倍/) || q.match(/最小公倍.*?(\d+).*?(\d+)/);
      if (!m) return null;
      let a = parseInt(m[1]), b = parseInt(m[2]);
      let [x, y] = [a, b];
      while (y) { [x, y] = [y, x % y]; }
      return a * b / x;
    }, 2);

    this.addRule('质数个数', 'number_theory', (q) => {
      const m = q.match(/(\d+).*以内/) || q.match(/1.*?(\d+).*质数/);
      if (!m || !/质数|素数/.test(q)) return null;
      const limit = parseInt(m[1]);
      let count = 0;
      for (let i = 2; i <= limit; i++) {
        let isP = true;
        for (let j = 2; j * j <= i; j++) { if (i % j === 0) { isP = false; break; } }
        if (isP) count++;
      }
      return count;
    }, 2);

    this.addRule('大小比较', 'logic_basic', (q) => {
      if (!/比.*[大小重高矮]/.test(q)) return null;
      const bigger = q.match(/(.)比(.).*[大重高]/);
      const smaller = q.match(/(.)比(.).*[小轻矮]/);
      if (q.includes('谁大') || q.includes('最重') || q.includes('最高')) return bigger ? bigger[1] : null;
      if (q.includes('谁小') || q.includes('最轻') || q.includes('最矮')) return smaller ? smaller[1] : null;
      return null;
    }, 1);

    this.addRule('鸡兔同笼', 'equations', (q) => {
      const m = q.match(/(\d+).*?头.*?(\d+).*?[脚足]/);
      if (!m || !/鸡|兔/.test(q)) return null;
      const heads = parseInt(m[1]), feet = parseInt(m[2]);
      return `鸡${(4*heads-feet)/2}只兔${(feet-2*heads)/2}只`;
    }, 2);

    this.addRule('速度问题', 'rate_work', (q) => {
      const m = q.match(/时速(\d+).*?(\d+)小时/);
      if (!m) return null;
      return parseInt(m[1]) * parseFloat(m[2]);
    }, 1);

    this.addRule('圆形面积', 'geometry_basic', (q) => {
      const m = q.match(/直径.*?(\d+)|半径.*?(\d+).*圆[形]/);
      if (!m || !/圆.*面积/.test(q)) return null;
      let r = parseInt(m[1] || m[2]);
      if (q.includes('直径')) r = r / 2;
      return +(Math.PI * r * r).toFixed(1);
    }, 2);

    // --- 数列 ---
    this.addRule('等差数列求和', 'addition', (q) => {
      const mapper = {
        '九十':90,'八十':80,'七十':70,'六十':60,'五十':50,'四十':40,'三十':30,'二十':20,'十':10,
        '一百':100,'二百':200,'三百':300,'四百':400,'五百':500,
        '六百':600,'七百':700,'八百':800,'九百':900,'一千':1000,'百':100,'千':1000,
        '一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9
      };
      let q2 = q;
      for (const [k, v] of Object.entries(mapper).sort((a,b)=>b[0].length-a[0].length)) {
        q2 = q2.replace(new RegExp(k, 'g'), String(v));
      }
      const m = q2.match(/从?(\d+)[到加至].*?(\d+)/);
      if (!m) return null;
      const a = parseInt(m[1]), b = parseInt(m[2]);
      if (/奇数|单数/.test(q)) return ((b + 1) / 2) ** 2;
      return (a + b) * ((b - a + 1) / 2);
    }, 2);

    // --- 概率 ---
    this.addRule('古典概型', 'probability', (q) => {
      const m = q.match(/(\d+)个.*?(\d+)个/);
      if (!m || !q.includes('概率')) return null;
      const total = parseInt(m[1]) + parseInt(m[2]);
      if (q.includes('至少')) {
        // 1 - P(全不中)
        const red = parseInt(q.match(/红.*?(\d+)/)?.[1] || m[1]);
        const others = total - red;
        // Simplified
        return null; // 需要更精确的组合计算
      }
      return null;
    }, 3);

    // --- 编程 ---
    this.addRule('数组最大值', 'loops', (q) => {
      if (!/最大|max/i.test(q)) return null;
      const bracket = q.match(/\[([\d,\s]+)\]/);
      const nl = q.match(/([\d,\s]+)哪.*?最大|最大.*?([\d,\s]+)/);
      const str = bracket ? bracket[1] : (nl ? (nl[1] || nl[2]) : null);
      if (!str) return null;
      const arr = str.split(/[,，\s]+/).filter(Boolean).map(Number);
      return arr.length > 1 ? Math.max(...arr) : null;
    }, 1);

    this.addRule('数组最小值', 'loops', (q) => {
      const m = q.match(/\[([\d,\s]+)\]/);
      if (!m || !q.includes('最小')) return null;
      const arr = m[1].split(/[,，\s]+/).map(Number);
      return Math.min(...arr);
    }, 1);

    this.addRule('数组求和', 'loops', (q) => {
      const m = q.match(/\[([\d,\s]+)\]/);
      if (!m || !q.includes('求和')) return null;
      const arr = m[1].split(/[,，\s]+/).map(Number);
      return arr.reduce((a, b) => a + b, 0);
    }, 1);

    this.addRule('字符串反转', 'strings', (q) => {
      const m = q.match(/'([^']*)'|"([^"]*)"|反转\s*(\S+)|([a-zA-Z]+)/);
      if (!m || !/反转|reverse/i.test(q)) return null;
      const s = m[1] || m[2] || m[3] || m[4];
      return s ? s.split('').reverse().join('') : null;
    }, 1);

    this.addRule('斐波那契', 'recursion', (q) => {
      const m = q.match(/斐波那契.*?(\d+)/i);
      if (!m) return null;
      const n = parseInt(m[1]);
      let a = 0, b = 1;
      for (let i = 2; i <= n; i++) [a, b] = [b, a + b];
      return b;
    }, 2);

    this.addRule('二分查找', 'searching', (q) => {
      const m = q.match(/\[([\d,\s]+)\].*?(\d+)/);
      if (!m || !q.includes('查找') && !q.includes('搜索')) return null;
      const arr = m[1].split(/[,，\s]+/).map(Number).sort((a,b)=>a-b);
      const target = parseInt(m[2]);
      let l = 0, r = arr.length - 1;
      while (l <= r) { const mid = Math.floor((l + r) / 2); if (arr[mid] === target) return mid; arr[mid] < target ? l = mid + 1 : r = mid - 1; }
      return -1;
    }, 2);
  }

  addConcept(name, prerequisites) {
    this.concepts.set(name, { name, prerequisites, rules: [], mastered: false, count: 0 });
  }

  addRule(name, concept, solve, difficulty = 1) {
    const rule = { name, concept, solve, difficulty };
    this.rules.set(name, rule);
    if (this.concepts.has(concept)) {
      this.concepts.get(concept).rules.push(name);
    }
  }

  /**
   * 统一求解入口——不分领域
   */
/**
   * 模糊求解——返回多个候选，每个带置信度
   * { solved: true/false, answer, rule, concept, confidence: 0-1 }
   */
  solve(question, fuzzyMode = false) {
    const candidates = [];
    const q = question;
    const s = this._struct(q);  // 先提取统一结构

    for (const [name, rule] of this.rules) {
      try {
        const answer = rule.solve(q);
        if (answer !== null && answer !== undefined) {
          const confidence = this._keywordMatch(name, q) * 0.7 + this._ngramSimilarity(name, q) * 0.3;
          if (fuzzyMode || confidence > 0.3) {
            candidates.push({ rule: name, answer, concept: rule.concept, confidence, difficulty: rule.difficulty });
          }
        }
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    }

    // 无规则命中时，用结构推演
    if (candidates.length === 0) {
      const deduced = this._deduceFromStructure(s, q);
      if (deduced) {
        this.history.push({ question: q.substring(0, 60), rule: 'structure_deduced', concept: 'inferred', confidence: 0.5, time: Date.now() });
        return deduced;
      }
      return null;
    }

    candidates.sort((a, b) => (b.confidence * 10 + b.difficulty) - (a.confidence * 10 + a.difficulty));
    const best = candidates[0];
    this.history.push({ question: q.substring(0, 60), rule: best.rule, concept: best.concept, confidence: best.confidence, time: Date.now() });
    if (this.concepts.has(best.concept)) this.concepts.get(best.concept).count++;

    return { solved: true, answer: best.answer, rule: best.rule, concept: best.concept, confidence: Math.round(best.confidence * 100) / 100, alternatives: fuzzyMode ? candidates.slice(1, 3).map(c => ({ answer: c.answer, rule: c.rule, confidence: Math.round(c.confidence * 100) / 100 })) : [] };
  }

  /**
   * 规则全没命中时，从结构中推演
   */
  _deduceFromStructure(s, q) {
    // 数列求和
    if (s.nums.length >= 2 && /和|sum|总计|total|加起来|相加|加|add|\+/.test(q) && (/到|from|between|从|.../.test(q) || (s.nums.length===2&&s.nums[0]<s.nums[1]))) {
      const a = Math.min(...s.nums.filter(n => n > 0)), b = Math.max(...s.nums);
      if (a > 0 && b > a && b < 1000000) return { solved: true, answer: (a+b)*(b-a+1)/2, rule: '结构推演', concept: 'series', confidence: 0.7 };
    }
    // 最大/最小
    if (s.nums.length >= 3 && /最大|max|largest|biggest/i.test(q)) return { solved: true, answer: Math.max(...s.nums), rule: '结构推演', concept: 'loops', confidence: 0.8 };
    if (s.nums.length >= 3 && /最小|min|smallest/i.test(q)) return { solved: true, answer: Math.min(...s.nums), rule: '结构推演', concept: 'loops', confidence: 0.8 };
    // 折扣
    if (s.nums.length >= 2 && /折|discount|off/i.test(q)) return { solved: true, answer: s.nums[0]*s.nums[1]/10, rule: '结构推演', concept: 'percentage', confidence: 0.8 };
    return null;
  }

  _keywordMatch(ruleName, q) {
    const keywords = this._getKeywords(ruleName);
    if (keywords.length === 0) return 0.3; // 通用规则给低分
    let matches = 0, total = 0;
    for (const kw of keywords) {
      total += kw.length;
      if (q.includes(kw)) matches += kw.length;
    }
    return total > 0 ? matches / total : 0.3;
  }

  _ngramSimilarity(ruleName, q) {
    const nameChars = [...ruleName];
    let matches = 0;
    for (const c of nameChars) {
      if (q.includes(c)) matches++;
    }
    return nameChars.length > 0 ? matches / nameChars.length : 0;
  }

  _getKeywords(ruleName) {
    const map = {
      '一元一次方程': ['x', '方程', '等于'],
      '两数和': ['和', '+'],
      '连加': ['+'],
      '折扣': ['折'],
      '长方形面积': ['面积', '长', '宽'],
      '三角形面积': ['三角形', '底', '高'],
      '圆柱体积': ['圆柱', '体积', '半径'],
      '正方体表面积': ['正方体', '表面积', '棱长'],
      '最大公约数': ['公约', 'gcd'],
      '最小公倍数': ['公倍', 'lcm'],
      '质数个数': ['质数', '素数'],
      '等差数列求和': ['...', '...,', '到', '1+2'],
      '大小比较': ['比', '大小', '重', '矮'],
      '鸡兔同笼': ['鸡', '兔', '头', '脚'],
      '速度问题': ['时速', '小时', '公里'],
      '圆形面积': ['圆', '直径', 'π'],
      '数组最大值': ['最大', '[]', '['],
      '数组最小值': ['最小', '[]', '['],
      '数组求和': ['求和', '和', '['],
      '字符串反转': ['反转', 'reverse', '反向'],
      '斐波那契': ['斐波那契', 'fib', '项'],
      '二分查找': ['查找', '搜索', '二分'],
    };
return map[ruleName] || [];
  }

  /**
   * LLM 教学：给一个问题+答案，自动提炼新规则
   */
  learn(question, answer, concept) {
    const nums = question.match(/\d+/g)?.map(Number) || [];
    if (nums.length < 2) return null;

    if (!concept) concept = this._guessConcept(question);
    const sig = question.replace(/\d+/g, '#').substring(0, 80);
    const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/#/g, '\\d+');
    const pattern = new RegExp(escaped);

    this.addRule(`learned_${Date.now()}`, concept, (q) => {
      if (!pattern.test(q)) return null;
      const newNums = q.match(/\d+/g)?.map(Number) || [];
      if (newNums.length !== nums.length) return null;
      let result = String(answer);
      for (let i = 0; i < nums.length; i++) result = result.replace(new RegExp(String(nums[i]), 'g'), String(newNums[i]));
      return isNaN(parseFloat(result)) ? result : parseFloat(result);
    }, 2);

    return concept;
  }

  _guessConcept(q) {
    if (/面积|体积|长|宽|半径|圆柱|正方/.test(q)) return 'geometry_basic';
    if (/[xX=]|方程/.test(q)) return 'equations';
    if (/折|百分/.test(q)) return 'percentage';
    if (/概率/.test(q)) return 'probability';
    if (/排序|最大|最小/.test(q)) return 'loops';
    if (/查找|搜索/.test(q)) return 'searching';
    if (/质数|素数|公约|公倍/.test(q)) return 'number_theory';
    if (/数列|求和|1\+2|.../.test(q)) return 'series';
    return 'addition';
  }

  /**
   * 从 LLM 提炼好的结构化规则直接注入
   */
  injectRule(name, concept, matchFn, solveFn, difficulty = 2) {
    this.addConcept(concept, []);
    this.rules.set(name, { name, concept, solve: (q) => { try { return matchFn(q) ? solveFn(q) : null; } catch (e) { logger.warn('[IGNORE] ' + (e?.message || '')); return null; } }, difficulty });
  }

  getStats() {
    return {
      totalRules: this.rules.size,
      totalConcepts: this.concepts.size,
      mastered: [...this.concepts.values()].filter(c => c.count >= 3).length,
      history: this.history.length
    };
  }
}
