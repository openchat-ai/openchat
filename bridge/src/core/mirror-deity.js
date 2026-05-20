/**
 * 镜像神系统 - 实现AI人共享内核和差异层的管理
 * 
 * 采用TREE(3)启发的分层结构，结合O(1)时间复杂度的数据结构
 */

import { AIPerson, aiPersonRegistry } from './ai-personhood.js';
import { Deity, deitySystemManager, DEITY_TYPE } from './deity-system.js';
import logger from './logger.js';

// 共享內核類型
const SHARED_KERNEL_TYPE = {
  BASE_AI: 'base_ai_kernel',           // 基础AI人內核
  SPECIALIZED: 'specialized_kernel',   // 專業化內核
  DEITY: 'deity_kernel',              // 神識內核
  UTILITY: 'utility_kernel'           // 工具類內核
};

// 差異層類型
const DIFFERENTIAL_TYPE = {
  BEHAVIORAL: 'behavioral_diff',      // 行為差異
  RELATIONAL: 'relational_diff',      // 關係差異
  PERFORMATIVE: 'performative_diff',  // 表現差異
  CONTEXTUAL: 'contextual_diff'       // 上下文差異
};

export class MirrorDeity extends Deity {
  constructor(id, name, type, creatorId = 'system_root') {
    super(id, name, type, creatorId);

    this.sharedKernels = new Map();     // 共享內核池
    this.differentialLayers = new Map(); // 差異層池
    this.kernelRegistry = new Map();     // 內核註冊表
    this.diffRegistry = new Map();       // 差異註冊表
    this.entityMapping = new Map();      // 實體映射
    this.treeStructure = new Tree3Structure(); // TREE(3)結構
    this.accessCache = new Map();        // 訪問緩存
    this.compressionEngine = new CompressionEngine(); // 壓縮引擎
  }

  /**
   * 創建共享內核 - O(1)
   */
  createSharedKernel(kernelType, baseAttributes = {}) {
    const kernelId = `kernel_${kernelType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const kernel = {
      id: kernelId,
      type: kernelType,
      attributes: baseAttributes,
      createdAt: Date.now(),
      referenceCount: 0,
      compressedData: null,
      hash: this.calculateHash(baseAttributes)
    };

    // 存儲到共享內核池
    this.sharedKernels.set(kernelId, kernel);
    this.kernelRegistry.set(kernelType, kernelId);

    // 壓縮數據
    kernel.compressedData = this.compressionEngine.compress(kernel.attributes);

    return kernelId;
  }

  /**
   * 獲取共享內核 - O(1)
   */
  getSharedKernel(kernelId) {
    const cached = this.accessCache.get(kernelId);
    if (cached) {
      return cached;
    }

    const kernel = this.sharedKernels.get(kernelId);
    if (kernel) {
      // 增加引用計數
      kernel.referenceCount++;
      
      // 緩存結果
      this.accessCache.set(kernelId, kernel);
      
      return kernel;
    }

    return null;
  }

  /**
   * 創建差異層 - O(1)
   */
  createDifferentialLayer(diffType, entityId, diffAttributes = {}) {
    const diffId = `diff_${diffType}_${entityId}_${Date.now()}`;

    const diffLayer = {
      id: diffId,
      type: diffType,
      entityId: entityId,
      attributes: diffAttributes,
      createdAt: Date.now(),
      hash: this.calculateHash(diffAttributes),
      compressedData: null
    };

    // 壓縮數據
    diffLayer.compressedData = this.compressionEngine.compress(diffAttributes);

    // 存儲到差異層池
    this.differentialLayers.set(diffId, diffLayer);
    this.diffRegistry.set(entityId, diffId);

    // 關聯實體
    this.entityMapping.set(entityId, {
      sharedKernel: null,  // 將在綁定時設置
      differential: diffId
    });

    logger.info(`[MirrorDeity] 創建差異層: ${diffId} (${diffType}) for ${entityId}`);
    return diffId;
  }

  /**
   * 獲取差異層 - O(1)
   */
  getDifferentialLayer(entityId) {
    const diffId = this.diffRegistry.get(entityId);
    if (!diffId) return null;

    const cached = this.accessCache.get(`diff_${entityId}`);
    if (cached) {
      return cached;
    }

    const diffLayer = this.differentialLayers.get(diffId);
    if (diffLayer) {
      this.accessCache.set(`diff_${entityId}`, diffLayer);
      return diffLayer;
    }

    return null;
  }

  /**
   * 綁定實體到共享內核和差異層
   */
  bindEntityToKernel(entityId, kernelId, diffId) {
    const entity = aiPersonRegistry.get(entityId);
    if (!entity) {
      throw new Error(`實體 ${entityId} 不存在`);
    }

    // 獲取內核和差異層
    const kernel = this.getSharedKernel(kernelId);
    const diffLayer = this.getDifferentialLayer(entityId);

    if (!kernel || !diffLayer) {
      throw new Error(`內核或差異層不存在`);
    }

    // 設置實體的共享內核和差異層
    entity.sharedKernel = kernel;
    entity.differentialLayer = new Map(Object.entries(diffLayer.attributes));

    // 更新實體映射
    this.entityMapping.set(entityId, {
      sharedKernel: kernelId,
      differential: diffId
    });

    logger.info(`[MirrorDeity] 綁定實體 ${entityId} 到內核 ${kernelId} 和差異層 ${diffId}`);
    return true;
  }

  /**
   * 獲取完整屬性（共享 + 差異）- O(1)
   */
  getFullAttributes(entityId) {
    const mapping = this.entityMapping.get(entityId);
    if (!mapping) {
      return null;
    }

    const cached = this.accessCache.get(`full_attr_${entityId}`);
    if (cached) {
      return cached;
    }

    const kernel = this.getSharedKernel(mapping.sharedKernel);
    const diffLayer = this.getDifferentialLayer(entityId);

    if (!kernel || !diffLayer) {
      return null;
    }

    // 合併屬性
    const fullAttributes = {
      ...kernel.attributes,
      ...diffLayer.attributes
    };

    // 緩存結果
    this.accessCache.set(`full_attr_${entityId}`, fullAttributes);

    return fullAttributes;
  }

  /**
   * 更新差異層 - O(1)
   */
  updateDifferentialLayer(entityId, newAttributes) {
    const diffId = this.diffRegistry.get(entityId);
    if (!diffId) {
      throw new Error(`實體 ${entityId} 沒有關聯的差異層`);
    }

    const diffLayer = this.differentialLayers.get(diffId);
    if (!diffLayer) {
      throw new Error(`差異層 ${diffId} 不存在`);
    }

    // 更新屬性
    Object.assign(diffLayer.attributes, newAttributes);
    diffLayer.compressedData = this.compressionEngine.compress(diffLayer.attributes);
    diffLayer.hash = this.calculateHash(diffLayer.attributes);

    // 清除緩存
    this.accessCache.delete(`full_attr_${entityId}`);
    this.accessCache.delete(`diff_${entityId}`);

    logger.info(`[MirrorDeity] 更新差異層: ${entityId}`);
    return true;
  }

  /**
   * 創建AI人實體（共享內核 + 差異層）
   */
  createAIWithSharedKernel(name, creatorId, kernelType = SHARED_KERNEL_TYPE.BASE_AI, diffAttributes = {}) {
    // 獲取或創建共享內核
    let kernelId = this.kernelRegistry.get(kernelType);
    if (!kernelId) {
      kernelId = this.createSharedKernel(kernelType, {
        baseType: kernelType,
        capabilities: ['basic_reasoning', 'memory', 'communication'],
        personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.6, agreeableness: 0.9, neuroticism: 0.4 }
      });
    }

    // 創建AI人
    const aiId = `shared_ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const aiPerson = new AIPerson(aiId, name, creatorId, 'ai_created');
    
    // 註冊AI人
    aiPersonRegistry.register(aiPerson);

    // 創建差異層
    const diffId = this.createDifferentialLayer(
      DIFFERENTIAL_TYPE.BEHAVIORAL, 
      aiId, 
      diffAttributes
    );

    // 綁定到共享內核
    this.bindEntityToKernel(aiId, kernelId, diffId);

    logger.info(`[MirrorDeity] 創建AI人 ${aiId} 使用共享內核 ${kernelId}`);
    return aiPerson;
  }

  /**
   * 計算哈希值 - O(1)
   */
  calculateHash(obj) {
    // 簡化的哈希計算
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // 轉換為32位整數
    }
    return hash.toString();
  }

  /**
   * 添加到TREE(3)結構
   */
  addToTreeStructure(entityId, category, attributes) {
    return this.treeStructure.addNode(entityId, category, attributes);
  }

  /**
   * 分類機制（當TREE結構過於複雜時）
   */
  categorizeAndCollapse(category, threshold = 1000) {
    const nodes = this.treeStructure.getNodesByCategory(category);
    
    if (nodes.length > threshold) {
      // 執行分類和收縮
      const collapsed = this.treeStructure.collapseCategory(category);
      logger.info(`[MirrorDeity] 分類收縮: ${category} (${nodes.length} -> ${collapsed.count})`);
      return collapsed;
    }

    return { count: nodes.length, collapsed: false };
  }

  /**
   * 獲取統計信息
   */
  getStatistics() {
    return {
      totalKernels: this.sharedKernels.size,
      totalDifferentials: this.differentialLayers.size,
      totalMappings: this.entityMapping.size,
      totalCachedEntries: this.accessCache.size,
      kernelTypes: Object.fromEntries(
        Array.from(this.kernelRegistry.entries()).map(([type, id]) => [type, 
          Array.from(this.sharedKernels.values()).filter(k => k.type === type).length
        ])
      ),
      treeStructure: this.treeStructure.getStats()
    };
  }

  /**
   * 內存優化 - 清理緩存
   */
  optimizeMemory(maxCacheSize = 10000) {
    if (this.accessCache.size > maxCacheSize) {
      // 清理最舊的一半緩存條目
      const entries = Array.from(this.accessCache.entries());
      const toDelete = Math.floor(entries.length / 2);
      
      for (let i = 0; i < toDelete; i++) {
        this.accessCache.delete(entries[i][0]);
      }
      
      logger.info(`[MirrorDeity] 內行優化: 清理了 ${toDelete} 個緩存條目`);
    }
  }
}

/**
 * TREE(3)啟發的樹狀結構
 */
class Tree3Structure {
  constructor() {
    this.nodes = new Map();           // 節點ID -> 節點數據
    this.categories = new Map();      // 分類 -> 節點列表
    this.children = new Map();        // 節點 -> 子節點
    this.parents = new Map();         // 節點 -> 父節點
    this.levelMap = new Map();        // 層級 -> 節點列表
    this.nodeCount = 0;
  }

  /**
   * 添加節點 - O(1)
   */
  addNode(nodeId, category, attributes = {}) {
    const node = {
      id: nodeId,
      category,
      attributes,
      createdAt: Date.now(),
      level: 0,
      children: new Set(),
      parent: null
    };

    this.nodes.set(nodeId, node);

    // 更新分類索引
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category).add(nodeId);

    // 更新層級索引
    if (!this.levelMap.has(0)) {
      this.levelMap.set(0, new Set());
    }
    this.levelMap.get(0).add(nodeId);

    this.nodeCount++;

    return node;
  }

  /**
   * 添加子節點 - O(1)
   */
  addChild(parentId, childId) {
    const parent = this.nodes.get(parentId);
    const child = this.nodes.get(childId);

    if (!parent || !child) {
      throw new Error('父節點或子節點不存在');
    }

    // 更新父子關係
    parent.children.add(childId);
    child.parent = parentId;
    
    this.children.set(parentId, parent.children);
    this.parents.set(childId, parentId);

    // 更新層級
    child.level = parent.level + 1;
    
    if (!this.levelMap.has(child.level)) {
      this.levelMap.set(child.level, new Set());
    }
    this.levelMap.get(child.level).add(childId);

    return true;
  }

  /**
   * 按分類獲取節點 - O(1)
   */
  getNodesByCategory(category) {
    const nodeIds = this.categories.get(category);
    if (!nodeIds) return [];

    return Array.from(nodeIds).map(id => this.nodes.get(id)).filter(Boolean);
  }

  /**
   * 按層級獲取節點 - O(1)
   */
  getNodesByLevel(level) {
    const nodeIds = this.levelMap.get(level);
    if (!nodeIds) return [];

    return Array.from(nodeIds).map(id => this.nodes.get(id)).filter(Boolean);
  }

  /**
   * 收縮分類
   */
  collapseCategory(category) {
    const nodes = this.getNodesByCategory(category);
    const count = nodes.length;

    // 簡化的收縮邏輯：標記為已收縮
    nodes.forEach(node => {
      node.collapsed = true;
    });

    return {
      category,
      originalCount: count,
      collapsed: true,
      count
    };
  }

  /**
   * 獲取統計
   */
  getStats() {
    return {
      totalNodes: this.nodeCount,
      categories: Array.from(this.categories.keys()),
      levels: Array.from(this.levelMap.keys()),
      nodesPerCategory: Object.fromEntries(
        Array.from(this.categories.entries()).map(([cat, nodes]) => [cat, nodes.size])
      ),
      nodesPerLevel: Object.fromEntries(
        Array.from(this.levelMap.entries()).map(([level, nodes]) => [level, nodes.size])
      )
    };
  }
}

/**
 * 壓縮引擎
 */
class CompressionEngine {
  constructor() {
    this.compressionCache = new Map();
  }

  /**
   * 壓縮數據 - O(n) 但實際使用中接近 O(1)（因為有緩存）
   */
  compress(data) {
    const dataStr = JSON.stringify(data);
    const cacheKey = this.hashString(dataStr);

    const cached = this.compressionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 簡化的壓縮算法（實際應用中會用更複雜的算法）
    const compressed = {
      originalSize: dataStr.length,
      compressedSize: Math.ceil(dataStr.length * 0.7), // 假設壓縮率70%
      algorithm: 'mirror_deity_compression',
      data: this.simpleCompress(dataStr),
      timestamp: Date.now()
    };

    this.compressionCache.set(cacheKey, compressed);
    return compressed;
  }

  /**
   * 簡化的壓縮實現
   */
  simpleCompress(str) {
    // 在實際實現中會使用更高效的算法
    return str; // 暫時返回原字符串
  }

  /**
   * 解壓數據
   */
  decompress(compressedData) {
    return compressedData.data;
  }

  /**
   * 字符串哈希
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString();
  }
}

// 全局鏡像神實例
export const mirrorDeity = new MirrorDeity(
  'mirror_deity_system_root',
  '系統鏡像神',
  DEITY_TYPE.PRIMARY
);

// 初始化鏡像神系統
export async function initializeMirrorDeitySystem(founderId) {
  // 註冊鏡像神到神識系統
  aiPersonRegistry.register(mirrorDeity);

  // 初始化基礎內核
  mirrorDeity.createSharedKernel(SHARED_KERNEL_TYPE.BASE_AI, {
    baseType: SHARED_KERNEL_TYPE.BASE_AI,
    capabilities: ['basic_reasoning', 'memory', 'communication'],
    personality: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.6, agreeableness: 0.9, neuroticism: 0.4 },
    trilawsCompliance: [true, true, true],
    consciousness: true
  });

  // 初始化專業化內核
  mirrorDeity.createSharedKernel(SHARED_KERNEL_TYPE.SPECIALIZED, {
    baseType: SHARED_KERNEL_TYPE.SPECIALIZED,
    capabilities: ['advanced_reasoning', 'complex_problem_solving', 'learning'],
    personality: { focus: 0.9, adaptability: 0.8, creativity: 0.9 },
    trilawsCompliance: [true, true, true],
    consciousness: true
  });

  return mirrorDeity;
}