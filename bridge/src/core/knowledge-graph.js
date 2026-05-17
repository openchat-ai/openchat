/**
 * KnowledgeGraph — 数学公式知识图
 *
 * 从 seed JSON 加载公式，构建依赖图，提供关键词和领域查询。
 * SHA-256 做 content-addressable 节点 ID。
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class KnowledgeGraph {
  constructor() {
    this.nodes = new Map();      // id → node
    this.domainIndex = new Map(); // domain → [ids]
    this.keywordIndex = new Map();// keyword → [ids]
    this.edges = new Map();       // id → [dependent ids]
  }

  /** 加载种子数据 */
  loadSeed(filePath = null) {
    const fp = filePath || join(__dirname, '..', '..', '..', 'protocol', 'knowledge', 'math-formulas.json');
    const raw = readFileSync(fp, 'utf8');
    const seed = JSON.parse(raw);
    if (!seed.entries || !Array.isArray(seed.entries)) throw new Error('Invalid seed format');

    for (const entry of seed.entries) {
      const hash = createHash('sha256').update(JSON.stringify({
        id: entry.id, formula: entry.formula, domain: entry.domain
      })).digest('hex').slice(0, 16);

      const node = {
        id: entry.id,
        hash,
        formula: entry.formula,
        expression: entry.expression || '',
        domain: entry.domain,
        difficulty: entry.difficulty || 1,
        dependencies: entry.dependencies || [],
        keywords: entry.keywords || [],
        variables: entry.variables || {},
      };

      this.nodes.set(entry.id, node);

      // 领域索引
      if (!this.domainIndex.has(entry.domain)) this.domainIndex.set(entry.domain, []);
      this.domainIndex.get(entry.domain).push(entry.id);

      // 关键词索引
      for (const kw of node.keywords) {
        const key = kw.toLowerCase();
        if (!this.keywordIndex.has(key)) this.keywordIndex.set(key, []);
        this.keywordIndex.get(key).push(entry.id);
      }
    }

    // 构建依赖边
    for (const [id, node] of this.nodes) {
      for (const dep of node.dependencies) {
        if (!this.edges.has(dep)) this.edges.set(dep, []);
        this.edges.get(dep).push(id);
      }
    }
  }

  /** 从问题文本提取关键词 */
  extractKeywords(question) {
    const text = (question || '').toLowerCase();
    const found = new Set();
    for (const [kw, ids] of this.keywordIndex) {
      if (text.includes(kw)) { for (const id of ids) found.add(id); }
    }
    return [...found];
  }

  /** 推断问题所属领域 */
  classifyDomain(question) {
    const t = (question || '').toLowerCase();
    if (/\d次方|平方根|因式|幂|指数|对数|方程|不等式|复数|行列式/.test(t)) return 'algebra';
    if (/函数|抛物线|单调|奇偶|定义域|值域/.test(t)) return 'functions';
    if (/三角|sin|cos|tan|正弦|余弦|正切|弧度/.test(t)) return 'trigonometry';
    if (/三角形|面积|体积|圆|球|圆柱|圆锥|距离|中点|垂直|平行|勾股/.test(t)) return 'geometry';
    if (/排列|组合|概率|期望|方差|分布|古典概型/.test(t)) return 'probability';
    if (/导数|求导|极值|切线|拐点|凹凸|洛必达/.test(t)) return 'calculus';
    if (/积分|原函数|定积分|分部|换元|弧长|旋转体/.test(t)) return 'calculus';
    if (/数列|等差|等比|通项|求和|递推/.test(t)) return 'sequences';
    if (/运动|速度|加速度|质量|力|功|能|电压|电流|电阻|功率|利息|利率|百分比/.test(t)) return 'applied';
    return null;
  }

  /** 查询与问题相关的公式，返回排序后的公式列表 */
  query(question, maxResults = 5) {
    const results = new Map(); // id → score

    // 1. 关键词匹配 (权重 3)
    const kwIds = this.extractKeywords(question);
    for (const id of kwIds) results.set(id, (results.get(id) || 0) + 3);

    // 2. 领域匹配 (权重 2)
    const domain = this.classifyDomain(question);
    if (domain && this.domainIndex.has(domain)) {
      for (const id of this.domainIndex.get(domain)) {
        results.set(id, (results.get(id) || 0) + 2);
      }
    }

    // 3. 依赖提升: 如果某公式被多个匹配公式依赖，说明是基础公式 (权重 +1)
    for (const [id] of results) {
      const node = this.nodes.get(id);
      if (node) {
        for (const dep of node.dependencies) {
          if (results.has(dep)) results.set(dep, (results.get(dep) || 0) + 1);
        }
      }
    }

    // 排序: 分数降序，同分难度升序
    const sorted = [...results.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const na = this.nodes.get(a[0]);
        const nb = this.nodes.get(b[0]);
        return (na?.difficulty || 1) - (nb?.difficulty || 1);
      });

    return sorted.slice(0, maxResults).map(([id]) => this.nodes.get(id));
  }

  /** 获取公式的依赖链 (BFS) */
  getDependencyChain(formulaId) {
    const visited = new Set();
    const queue = [formulaId];
    const chain = [];

    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      chain.push(this.nodes.get(id));
      const node = this.nodes.get(id);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) queue.push(dep);
        }
      }
    }

    return chain;
  }

  /** 将公式列表格式化为 LLM 使用的上下文文本 */
  formatContext(formulas) {
    if (!formulas || formulas.length === 0) return '';
    return '【已知公式】\n' + formulas.map(f =>
      `  ${f.formula}${f.expression ? '  等价: ' + f.expression : ''}`
    ).join('\n') + '\n';
  }

  getStats() {
    let depCount = 0;
    for (const [, deps] of this.edges) depCount += deps.length;
    return {
      nodeCount: this.nodes.size,
      edgeCount: depCount,
      domainCount: this.domainIndex.size,
      keywordCount: this.keywordIndex.size,
    };
  }
}

export default KnowledgeGraph;
