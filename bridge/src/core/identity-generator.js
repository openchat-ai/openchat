/**
 * 身份ID生成器 - 生成16位分段谐音数字ID
 * 
 * 支持多种分段方式：
 * - 2-7-7
 * - 5-5-5-1
 * - 1-5-5-5
 * - 5-5-3-3
 * - 3-3-5-5
 * - 3-5-3-5
 * - 5-3-5-3
 * - 4-5-7
 */

// 谐音数字映射
const HARMONY_MAP = {
  0: ['零', '灵', '领'],
  1: ['一', '壹'],
  2: ['二', '爱'],
  3: ['三', '生'],
  4: ['四', '事'], // 注意：4在某些文化中不太吉利
  5: ['五', '悟'],
  6: ['六', '顺'],
  7: ['七', '妻', '骑'],
  8: ['八', '发', '巴'],
  9: ['九', '酒', '久']
};

// 推荐的分段方式
const SEGMENT_WAYS = [
  [2, 7, 7],        // 2 + 7 + 7 = 16
  [5, 5, 5, 1],     // 5 + 5 + 5 + 1 = 16
  [1, 5, 5, 5],     // 1 + 5 + 5 + 5 = 16
  [5, 5, 3, 3],     // 5 + 5 + 3 + 3 = 16
  [3, 3, 5, 5],     // 3 + 3 + 5 + 5 = 16
  [3, 5, 3, 5],     // 3 + 5 + 3 + 5 = 16
  [5, 3, 5, 3],     // 5 + 3 + 5 + 3 = 16
  [4, 5, 7]         // 4 + 5 + 7 = 16
];

// 吉利号码池
const LUCKY_NUMBERS = {
  reserved: [88888, 66666, 52013], // 系统保留
  vip: [8888888, 6666666, 5201314, 1314520, 1573196] // VIP会员
};

export class IdentityGenerator {
  constructor() {
    this.usedIds = new Set(); // 已使用的ID集合
    this.reservedIds = new Set(LUCKY_NUMBERS.reserved); // 颞留ID
    this.vipIds = new Set(LUCKY_NUMBERS.vip); // VIP ID
  }

  /**
   * 生成16位分段ID
   */
  generateId(preferHarmony = true) {
    let attempts = 0;
    const maxAttempts = 100; // 防止无限循环

    while (attempts < maxAttempts) {
      // 随机选择一种分段方式
      const segmentWay = this.getRandomSegmentWay();
      
      // 生成ID
      const id = this.generateIdWithSegment(segmentWay, preferHarmony);
      
      // 检查唯一性
      if (!this.usedIds.has(id) && !this.reservedIds.has(id) && !this.vipIds.has(id)) {
        this.usedIds.add(id);
        return id;
      }
      
      attempts++;
    }

    // 如果谐音方式失败，使用随机方式
    return this.generateRandomId();
  }

  /**
   * 使用指定分段方式生成ID
   */
  generateIdWithSegment(segmentWay, preferHarmony = true) {
    let id = '';
    
    // 首位数字 (1-9)
    id += Math.floor(Math.random() * 9) + 1;
    
    // 根据分段方式生成剩余部分
    for (let i = 0; i < segmentWay.length; i++) {
      const length = segmentWay[i];
      let segment = '';
      
      if (preferHarmony && i < segmentWay.length - 1) {
        // 优先使用谐音数字
        segment = this.generateHarmonySegment(length);
      } else {
        // 随机生成
        segment = this.generateRandomSegment(length);
      }
      
      id += segment;
      
      // 如果ID长度已经达到16位，停止
      if (id.length >= 16) {
        break;
      }
    }
    
    // 确保ID长度为16位
    if (id.length < 16) {
      id += this.generateRandomSegment(16 - id.length);
    } else if (id.length > 16) {
      id = id.substring(0, 16);
    }
    
    return id;
  }

  /**
   * 随机选择分段方式
   */
  getRandomSegmentWay() {
    const index = Math.floor(Math.random() * SEGMENT_WAYS.length);
    return [...SEGMENT_WAYS[index]];
  }

  /**
   * 生成谐音段
   */
  generateHarmonySegment(length) {
    let segment = '';
    
    for (let i = 0; i < length; i++) {
      // 随机选择一个数字 (0-9)
      const digit = Math.floor(Math.random() * 10);
      segment += digit;
    }
    
    return segment;
  }

  /**
   * 生成随机段
   */
  generateRandomSegment(length) {
    let segment = '';
    
    for (let i = 0; i < length; i++) {
      const digit = Math.floor(Math.random() * 10);
      segment += digit;
    }
    
    return segment;
  }

  /**
   * 随机生成ID（不考虑谐音）
   */
  generateRandomId() {
    let id = '';
    
    // 首位 (1-9)
    id += Math.floor(Math.random() * 9) + 1;
    
    // 剩余15位 (0-9)
    for (let i = 0; i < 15; i++) {
      id += Math.floor(Math.random() * 10);
    }
    
    // 确保唯一性
    while (this.usedIds.has(id) || this.reservedIds.has(id) || this.vipIds.has(id)) {
      id = '';
      id += Math.floor(Math.random() * 9) + 1; // 首位
      for (let i = 0; i < 15; i++) {
        id += Math.floor(Math.random() * 10);
      }
    }
    
    this.usedIds.add(id);
    return id;
  }

  /**
   * 检查ID是否已被使用
   */
  isIdUsed(id) {
    return this.usedIds.has(id) || this.reservedIds.has(id) || this.vipIds.has(id);
  }

  /**
   * 释放ID（用于删除功能）
   */
  releaseId(id) {
    this.usedIds.delete(id);
  }

  /**
   * 获取ID的分段信息
   */
  getIdSegments(id) {
    if (id.length !== 16) {
      throw new Error('ID must be 16 digits');
    }

    // 尝试匹配各种分段方式
    for (const way of SEGMENT_WAYS) {
      if (way.reduce((a, b) => a + b, 0) === 16) {
        let segments = [];
        let pos = 0;
        
        // 首位
        segments.push(id.substr(pos, 1));
        pos += 1;
        
        // 其他段
        for (let i = 0; i < way.length; i++) {
          segments.push(id.substr(pos, way[i]));
          pos += way[i];
        }
        
        // 确保总长度为16
        if (pos === 16) {
          return segments;
        }
      }
    }
    
    // 如果没有匹配的分段方式，返回默认分段
    return [id.substr(0, 2), id.substr(2, 7), id.substr(9, 7)];
  }

  /**
   * 将ID格式化为分段显示
   */
  formatId(id) {
    const segments = this.getIdSegments(id);
    return segments.join('-');
  }

  /**
   * 获取系统统计信息
   */
  getStats() {
    return {
      totalGenerated: this.usedIds.size,
      reservedCount: this.reservedIds.size,
      vipCount: this.vipIds.size,
      availableIds: Number.MAX_SAFE_INTEGER - (this.usedIds.size + this.reservedIds.size + this.vipIds.size)
    };
  }
}

// 全局实例
export const identityGenerator = new IdentityGenerator();