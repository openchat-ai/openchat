/**
 * Resident Traits — AI 居民性格特征系统
 *
 * 性格遗传引擎：特征池定义、随机生成、亲子继承、可读标签。
 */

// 性格特征池：特征名 → 两极标签
const TRAIT_POOL = {
  diligence:     { high: '勤劳', low: '懒惰' },
  curiosity:     { high: '好奇', low: '保守' },
  courage:       { high: '勇敢', low: '谨慎' },
  sociability:   { high: '合群', low: '孤僻' },
  creativity:    { high: '创造', low: '刻板' },
};

const TRAIT_KEYS = Object.keys(TRAIT_POOL);

function createTraits(dominantTrait) {
  const base = {
    diligence: 0.5,
    curiosity: 0.5,
    courage: 0.5,
    sociability: 0.5,
    creativity: 0.5,
  };
  base[dominantTrait] = 0.9;
  const otherTraits = TRAIT_KEYS.filter(t => t !== dominantTrait);
  otherTraits.forEach(t => {
    base[t] = 0.3 + Math.random() * 0.3;
  });
  return base;
}

// 管家的默认性格
const BUTLER_TRAITS = createTraits('diligence');

/**
 * 生成随机 traits（初代居民用）
 */
function randomTraits() {
  const traits = {};
  for (const key of TRAIT_KEYS) {
    traits[key] = Math.round((Math.random() * 0.6 + 0.2) * 100) / 100; // 0.2-0.8
  }
  return traits;
}

/**
 * 从父 traits 继承并漂移
 * 核心规则：
 *   - 子 trait = 父 trait + 随机漂移 (±0.15)
 *   - 如果 trait 极端（>0.8 或 <0.2），漂移概率减半
 *   - 结果限制在 [0.0, 1.0]
 */
function inheritTraits(parentTraits) {
  const traits = {};
  for (const key of TRAIT_KEYS) {
    const parentVal = parentTraits[key] ?? 0.5;

    // 极端值漂移更小
    const driftRange = (parentVal > 0.8 || parentVal < 0.2) ? 0.08 : 0.15;
    const drift = (Math.random() - 0.5) * 2 * driftRange;

    traits[key] = Math.round(Math.min(1, Math.max(0, parentVal + drift)) * 100) / 100;
  }
  return traits;
}

/**
 * 将 traits 转为可读标签列表
 * 只显示 notable（偏向明显）的特征
 */
function traitsToLabels(traits) {
  if (!traits) return [];
  const labels = [];
  for (const key of TRAIT_KEYS) {
    const val = traits[key];
    if (val == null) continue;
    if (val >= 0.7) {
      labels.push(TRAIT_POOL[key].high);
    } else if (val <= 0.3) {
      labels.push(TRAIT_POOL[key].low);
    }
  }
  return labels;
}

export { TRAIT_POOL, TRAIT_KEYS, createTraits, randomTraits, inheritTraits, traitsToLabels };
