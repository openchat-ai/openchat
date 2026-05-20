/**
 * QuestionNormalizer — 句型归一化
 *
 * 人类说 "1+2+...+100"、"从1加到100"、"高斯小时候算的那道题"
 * 系统都能理解成同一种数学结构。
 *
 * 策略：多层模式 → 提取数字 + 结构 → 输出标准形式
 */

export class QuestionNormalizer {
  constructor() {
    this.patterns = [
      // ============ 等差数列求和 ============
      {
        name: 'arithmetic_sum',
        match: [
          /从\s*(\d+)\s*[加到至].*?(\d+)/,
          /从\s*(\d+)\s*一直加到\s*(\d+)/,
          /(\d+)\s*\+\s*(\d+)\s*\+\s*\.\.\.\s*\+\s*(\d+)/,
          /求\s*(\d+)\s*到\s*(\d+).*?和/,
          /计算\s*(\d+)\s*\+\s*\d+\s*\+\s*...\s*\+\s*(\d+)/,
          /高斯.*?(\d+)\+.*?(\d+)\+.*?(\d+)/,
        ],
        canonical: (nums) => `求从${nums[0]}到${nums[1]}的和`,
        type: 'series_sum',
        extract: [0, -1],  // 取第一个和最后一个数字
      },

      // ============ 一元一次方程 ============
      {
        name: 'linear_equation',
        match: [
          /(\d*)\s*[xX]\s*[＋+]\s*(\d+)\s*[＝=]\s*(\d+)/,
          /(\d*)\s*[xX]\s*[－-]\s*(\d+)\s*[＝=]\s*(\d+)/,
          /解方程\s*[：:]?\s*(\d*)\s*[xX]\s*[＋+]\s*(\d+)\s*[＝=]\s*(\d+)/,
          /方程\s*(\d*)\s*[xX]\s*[＋+]\s*(\d+)\s*=\s*(\d+)/,
          /(\d+)\s*[xX]\s*[＋+]\s*(\d+)\s*=\s*(\d+)\s*[xX].*?求/,
          /一个数的\s*(\d*)\s*倍[加＋]\s*(\d+)\s*等[於于]\s*(\d+)/,
          /某数.?(\d*)\s*倍[加＋]\s*(\d+)\s*.*?(\d+)/,
        ],
        canonical: (nums) => {
          const a = nums[0] || 1, b = nums[1], c = nums[2];
          return `解方程 ${a}x+${b}=${c}，求x`;
        },
        type: 'linear_equation',
      },

      // ============ 鸡兔同笼 ============
      {
        name: 'chicken_rabbit',
        match: [
          /鸡.*?兔.*?(\d+).*?头.*?(\d+).*?[脚足]/,
          /(\d+).*?头.*?(\d+).*?[脚足].*?鸡.*?兔/,
          /笼子.*?鸡.*?兔.*?(\d+).*?头.*?(\d+).*?脚/,
          /鸡兔.*?(\d+).*?头.*?(\d+).*?[脚足]/,
          /兔和鸡.*?(\d+).*?头.*?(\d+).*?[脚足]/,
          /(\d+)[只个].*?鸡.*?(\d+)[只个].*?兔.*?共.*?(\d+).*?头.*?(\d+).*?[脚足]/,
        ],
        canonical: (nums) => `鸡兔同笼，共${nums[0]}头${nums[1]}脚`,
        type: 'chicken_rabbit',
      },

      // ============ 和差问题 ============
      {
        name: 'sum_diff',
        match: [
          /两.*?数.*?和.*?(\d+).*?差.*?(\d+)/,
          /和是\s*(\d+).*?差是\s*(\d+)/,
          /两数之和.*?(\d+).*?两数之差.*?(\d+)/,
          /甲.*?乙.*?之和.*?(\d+).*?之差.*?(\d+)/,
          /它们.*?和.*?(\d+).*?差.*?(\d+)/,
          /(\d+).*?与.*?(\d+).*?是.*?两数.*?和.*?差/,
        ],
        canonical: (nums) => `两个数的和是${nums[0]}差是${nums[1]}`,
        type: 'sum_diff',
      },

      // ============ 几何面积 ============
      {
        name: 'rectangle_area',
        match: [
          /长方.*?长\s*(\d+).*?宽\s*(\d+)/,
          /矩形.*?长\s*(\d+).*?宽\s*(\d+)/,
          /长\s*(\d+).*?宽\s*(\d+)\s*.*?面积/,
          /(\d+)\s*[××]\s*(\d+)\s*.*?长方/,
          /一个.*?(\d+).*?[米厘].*?长.*?(\d+).*?[米厘].*?宽/,
        ],
        canonical: (nums) => `长方形长${nums[0]}宽${nums[1]}求面积`,
        type: 'rectangle_area',
      },

      // ============ 圆柱体积 ============
      {
        name: 'cylinder_volume',
        match: [
          /圆柱.*?半径\s*(\d+).*?高\s*(\d+)/,
          /圆柱.*?底面.*?半径\s*(\d+).*?高\s*(\d+)/,
          /一个.*?圆柱.*?底面.*?(\d+).*?高.*?(\d+)/,
          /半径\s*(\d+).*?高\s*(\d+).*?圆柱/,
        ],
        canonical: (nums) => `圆柱底面半径${nums[0]}高${nums[1]}求体积`,
        type: 'cylinder_volume',
      },

      // ============ 折扣 ============
      {
        name: 'discount',
        match: [
          /原价\s*(\d+).*?(\d+)\s*折/,
          /打\s*(\d+)\s*折.*?原价\s*(\d+)/,
          /(\d+)\s*元.*?打\s*(\d+)\s*折/,
          /(\d+)\s*折.*?原价\s*(\d+)/,
        ],
        canonical: (nums) => {
          // 第一个是原价还是折后价取决于顺序
          if (nums.length >= 2) {
            const price = nums[0] > nums[1] ? nums[0] : nums[1];
            const discount = nums[0] > nums[1] ? nums[1] : nums[0];
            return `原价${price}打${discount}折`;
          }
          return '';
        },
        type: 'discount',
      },

      // ============ 最大公约数 ============
      {
        name: 'gcd',
        match: [
          /最大公约.*?(\d+).*?(\d+)/,
          /最大公因数.*?(\d+).*?(\d+)/,
          /\((\d+),\s*(\d+)\)\s*的最大公约/,
          /gcd\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/,
          /(\d+)和(\d+)的\s*最大公约/,
        ],
        canonical: (nums) => `${nums[0]}和${nums[1]}的最大公约数`,
        type: 'gcd',
      },

      // ============ 百分比逆推 ============
      {
        name: 'percent_reverse',
        match: [
          /用了\s*(\d+)\s*%?.*?剩[下余]\s*(\d+)/,
          /花[了掉]\s*(\d+)\s*%?.*?[剩还].*?(\d+)/,
          /用[去掉]\s*(\d+)\s*%.*?剩[下余]\s*(\d+)\s*升?/,
          /剩下\s*(\d+)\s*.*?用了\s*(\d+)\s*%/,
        ],
        canonical: (nums) => `用了${nums[0]}%后剩${nums[1]}，求原来`,
        type: 'percent_reverse',
      },

      // ============ 工程合作 ============
      {
        name: 'work_together',
        match: [
          /甲.*?(\d+)\s*[天时].*?乙.*?(\d+)\s*[天时].*?合作/,
          /甲.*?单独.*?(\d+)\s*天.*?乙.*?单独.*?(\d+)\s*天/,
          /两人合作.*?甲.*?(\d+).*?乙.*?(\d+)/,
          /A.*?(\d+)\s*[天时].*?B.*?(\d+)\s*[天时].*?合作/,
        ],
        canonical: (nums) => `甲单独${nums[0]}天乙单独${nums[1]}天合作几天`,
        type: 'work_together',
      },

      // ============ 水池 ============
      {
        name: 'pool_rate',
        match: [
          /进水.*?(\d+)\s*[时小].*?满.*?出水.*?(\d+)\s*[时小]/,
          /进水管.*?(\d+).*?出水管.*?(\d+)/,
          /注水.*?(\d+).*?排水.*?(\d+)/,
        ],
        canonical: (nums) => `进水管${nums[0]}小时满出水管${nums[1]}小时空`,
        type: 'pool_rate',
      },
    ];
  }

  /**
   * 归一化问题文本 → { canonical, type, numbers }
   */
  normalize(question) {
    for (const pattern of this.patterns) {
      for (const regex of pattern.match) {
        const m = question.match(regex);
        if (m) {
          // 提取所有数字（跳过完整匹配）
          let nums = m.slice(1).filter(n => n !== undefined).map(Number);

          // 如果有 extract 配置，按指定索引取
          if (pattern.extract) {
            const extracted = pattern.extract.map(i => nums[i]).filter(n => n !== undefined);
            if (extracted.length >= 2) nums = extracted;
          }

          const canonical = pattern.canonical(nums);
          return { type: pattern.type, canonical, numbers: nums, matcher: pattern.name };
        }
      }
    }
    return null;
  }

  /**
   * 批量归一化并分类
   */
  classifyProblems(problems) {
    const result = [];
    for (const p of problems) {
      const norm = this.normalize(p.question);
      if (norm) {
        result.push({ ...p, normalized: norm });
      }
    }
    return result;
  }

  getStats() {
    return { patterns: this.patterns.length, types: new Set(this.patterns.map(p => p.type)).size };
  }
}
