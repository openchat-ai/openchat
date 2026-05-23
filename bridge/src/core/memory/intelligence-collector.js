/**
 * IntelligenceCollector 类：自动抓取最新技术情报
 */
class IntelligenceCollector {
  constructor() {
    this.intelligence = [];
    this.sources = [
      { id: 'github-trending', name: 'GitHub Trending', type: 'github' },
      { id: 'arxiv-papers', name: 'arXiv Papers', type: 'arxiv' },
    ];
    this.lastCollectionTime = null;
    this.collectionHistory = [];
  }

  /**
   * 抓取 GitHub Trending 数据
   * @returns {Promise<Array>} GitHub trending 项目列表
   */
  async collectGitHubTrending() {
    try {
      // 模拟 HTTP 请求抓取
      const trendingRepos = [
        {
          id: 'repo-1',
          name: 'project-a',
          language: 'TypeScript',
          stars: 5200,
          description: 'Advanced LLM framework',
          url: 'https://github.com/org/project-a',
          trending_since: new Date().toISOString(),
        },
        {
          id: 'repo-2',
          name: 'project-b',
          language: 'Python',
          stars: 3800,
          description: 'ML inference optimization',
          url: 'https://github.com/org/project-b',
          trending_since: new Date().toISOString(),
        },
        {
          id: 'repo-3',
          name: 'project-c',
          language: 'Go',
          stars: 2100,
          description: 'Cloud-native platform',
          url: 'https://github.com/org/project-c',
          trending_since: new Date().toISOString(),
        },
      ];

      return trendingRepos;
    } catch (error) {
      throw new Error(`GitHub Trending 抓取失败: ${error.message}`);
    }
  }

  /**
   * 抓取 arXiv 论文数据
   * @returns {Promise<Array>} arXiv 论文列表
   */
  async collectArXivPapers() {
    try {
      // 模拟论文抓取
      const papers = [
        {
          id: 'paper-1',
          title: 'Advances in Prompt Engineering',
          authors: ['Author A', 'Author B'],
          abstract: 'New techniques for improving LLM prompts...',
          url: 'https://arxiv.org/abs/2406.12345',
          published_date: new Date(Date.now() - 86400000).toISOString(),
          category: 'cs.CL',
        },
        {
          id: 'paper-2',
          title: 'Efficient Fine-tuning Methods',
          authors: ['Author C'],
          abstract: 'Novel approaches to parameter-efficient fine-tuning...',
          url: 'https://arxiv.org/abs/2406.12346',
          published_date: new Date(Date.now() - 172800000).toISOString(),
          category: 'cs.LG',
        },
        {
          id: 'paper-3',
          title: 'Safety in Large Language Models',
          authors: ['Author D', 'Author E', 'Author F'],
          abstract: 'Comprehensive framework for LLM safety...',
          url: 'https://arxiv.org/abs/2406.12347',
          published_date: new Date(Date.now() - 259200000).toISOString(),
          category: 'cs.CY',
        },
      ];

      return papers;
    } catch (error) {
      throw new Error(`arXiv 论文抓取失败: ${error.message}`);
    }
  }

  /**
   * 执行完整的情报收集
   * @returns {Promise<object>} 收集结果
   */
  async collect() {
    const collectionRecord = {
      timestamp: new Date().toISOString(),
      sources: {},
      totalItems: 0,
      status: 'in_progress',
    };

    try {
      // 收集 GitHub Trending
      const gitHubTrending = await this.collectGitHubTrending();
      collectionRecord.sources.github = {
        count: gitHubTrending.length,
        items: gitHubTrending,
      };

      // 收集 arXiv 论文
      const arXivPapers = await this.collectArXivPapers();
      collectionRecord.sources.arxiv = {
        count: arXivPapers.length,
        items: arXivPapers,
      };

      collectionRecord.totalItems = gitHubTrending.length + arXivPapers.length;
      collectionRecord.status = 'success';

      this.lastCollectionTime = Date.now();
      this.intelligence.push(...gitHubTrending, ...arXivPapers);
      this.collectionHistory.push(collectionRecord);

      return collectionRecord;
    } catch (error) {
      collectionRecord.status = 'failed';
      collectionRecord.error = error.message;
      this.collectionHistory.push(collectionRecord);
      throw error;
    }
  }

  /**
   * 获取收集的情报
   * @param {object} filter - 过滤条件
   * @returns {Array} 过滤后的情报
   */
  getIntelligence(filter = {}) {
    let items = [...this.intelligence];

    if (filter.type === 'github') {
      items = items.filter(i => i.language !== undefined);
    } else if (filter.type === 'arxiv') {
      items = items.filter(i => i.authors !== undefined);
    }

    if (filter.limit) {
      items = items.slice(0, filter.limit);
    }

    return items;
  }

  /**
   * 获取收集历史
   * @returns {Array} 历史记录
   */
  getHistory() {
    return this.collectionHistory;
  }

  /**
   * 清空情报
   */
  clear() {
    this.intelligence = [];
  }

  /**
   * 生成情报报告
   * @returns {string} 可读的报告
   */
  generateReport() {
    const lines = [
      '╔════════════════════════════════════════════════════════╗',
      '║        技术情报收集报告                           ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
      '收集统计:',
      `  总收集次数: ${this.collectionHistory.length}`,
      `  成功次数: ${this.collectionHistory.filter(h => h.status === 'success').length}`,
      `  失败次数: ${this.collectionHistory.filter(h => h.status === 'failed').length}`,
      `  情报总数: ${this.intelligence.length}`,
      '',
      '最后收集:',
      `  时间: ${this.lastCollectionTime ? new Date(this.lastCollectionTime).toISOString() : '从未'}`,
      '',
      '数据源:',
    ];

    for (const source of this.sources) {
      lines.push(`  - ${source.name} (${source.id})`);
    }

    return lines.join('\n');
  }

  /**
   * 获取统计信息
   * @returns {object} 统计数据
   */
  getStats() {
    const gitHubCount = this.intelligence.filter(i => i.language !== undefined).length;
    const arXivCount = this.intelligence.filter(i => i.authors !== undefined).length;

    return {
      totalIntelligence: this.intelligence.length,
      githubProjects: gitHubCount,
      arXivPapers: arXivCount,
      totalCollections: this.collectionHistory.length,
      lastCollectionTime: this.lastCollectionTime
        ? new Date(this.lastCollectionTime).toISOString()
        : null,
    };
  }
}

export default IntelligenceCollector;
