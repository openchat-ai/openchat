/**
 * ProblemDecomposer — 任意问题拆解为布尔子问题树
 *
 * 核心理念：任何复杂问题可拆分为 N 个 0/1 子问题。
 * 每个子问题只有两种可能的答案（0 或 1），多个子问题的答案组合 = 原问题答案。
 *
 * 模式：
 *   推理模式  — LLM 分解（通用）
 *   领域模式  — 规则引擎分解（代码/系统/数学等已知领域）
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ==================== 领域分解器 ====================

/**
 * 已知领域的规则型分解器
 * 每个返回 { question, hint, domain } 数组
 */
const DOMAIN_DECOMPOSERS = {
  /** 代码质量分析 */
  code_quality(code) {
    return [
      { question: '是否有未初始化的变量?',          hint: '扫描所有变量声明和使用位置',   domain: 'syntax' },
      { question: '是否有越界数组访问?',            hint: '检查所有 [index] 访问',       domain: 'runtime' },
      { question: '是否有内存泄漏风险?',             hint: '检查未释放的事件监听/定时器', domain: 'resource' },
      { question: '是否有空指针/undefined 访问?',    hint: '检查 . 和 [] 前的对象是否可为空', domain: 'runtime' },
      { question: '函数嵌套深度是否 >5?',            hint: '遍历 AST 计算最大嵌套层级',   domain: 'complexity' },
      { question: '单函数行数是否 >100?',            hint: '统计每个函数的行数',           domain: 'complexity' },
      { question: '是否使用了 eval() 或类似动态执行?', hint: '搜索 eval/Function/exec 调用', domain: 'security' },
      { question: '是否有硬编码的密钥/密码?',         hint: '正则匹配 password/secret/key = 字面量', domain: 'security' },
      { question: '依赖库是否有已知漏洞?',            hint: '检查 package.json 依赖版本号', domain: 'dependency' },
      { question: '是否有同步阻塞操作 (死循环)?',      hint: '搜索 while(true)/无限递归',  domain: 'performance' },
      { question: '异步操作是否有错误处理?',          hint: '检查 .catch()/try-catch',    domain: 'robustness' },
      { question: '是否有循环内创建函数?',            hint: '检查 for/while 内的 function/()=>', domain: 'performance' },
    ];
  },

  /** 系统健康检查 */
  house_health(stats) {
    return [
      { question: '内存使用率 >80%?',    hint: 'process.memoryUsage().heapUsed / heapTotal', domain: 'resource' },
      { question: 'CPU 负载 >70%?',      hint: 'os.cpus() 计算平均负载',                     domain: 'resource' },
      { question: '磁盘剩余空间 <1GB?',  hint: 'fs.statfs() 检查可用空间',                   domain: 'resource' },
      { question: 'P2P 连接数 <2?',      hint: 'swarm.connectedPeers.size',                   domain: 'network' },
      { question: '居民活动停止 >5分钟?', hint: '检查最后 activity 时间戳',                    domain: 'lifecycle' },
      { question: 'API 限流 429 次数 >10?', hint: '统计最近 429 错误次数',                    domain: 'throttle' },
      { question: '进程运行时间 >24小时?',  hint: 'process.uptime() > 86400',                 domain: 'lifecycle' },
    ];
  },

  /** 居民社交 */
  resident_dating(profile) {
    return [
      { question: '和我同家族吗?',        hint: '检查 parentId/lineage',            domain: 'family' },
      { question: '协作过 >3次吗?',       hint: '统计协作历史',                     domain: 'social' },
      { question: '在线超过 1 小时了吗?',  hint: '检查 lastSeen',                     domain: 'availability' },
      { question: '有相似 traits 吗?',     hint: 'traits 差异 <0.3',                domain: 'personality' },
      { question: '住在不同机器上吗?',     hint: 'hostId 是否不同',                   domain: 'diversity' },
    ];
  },

  /** 数据压缩 */
  data_compression(data) {
    return [
      { question: '是否包含重复模式?',      hint: '分析字符串/字节流中的重复子串',    domain: 'pattern' },
      { question: '是否可以无损压缩?',      hint: '检查数据是否已经是压缩格式',        domain: 'format' },
      { question: '文本占比 >50%?',        hint: '统计非二进制字节比例',              domain: 'content' },
      { question: 'JSON/XML 可读格式?',    hint: '尝试 JSON.parse()',                domain: 'format' },
    ];
  },

  /** 安全审计 */
  security_audit(target) {
    return [
      { question: '有未授权访问点?',        hint: '检查公开端点是否有认证',           domain: 'access' },
      { question: '有 SQL/XSS 注入?',      hint: '检查输入拼接字符串',               domain: 'injection' },
      { question: '有敏感信息外泄?',        hint: '检查日志/响应中是否含密钥',         domain: 'leakage' },
      { question: '依赖有已知 CVE?',        hint: '检查依赖包版本与 CVE 库',          domain: 'dependency' },
      { question: 'HTTPS 已配置?',          hint: '检查 TLS/SSL 证书',               domain: 'transport' },
    ];
  },
};

// ==================== 通用分解器 ====================

class ProblemDecomposer {
  constructor(options = {}) {
    this.maxSubQuestions = options.maxSubQuestions || 1000;
    this.autoDetectDomain = options.autoDetectDomain !== false;
  }

  /**
   * 分解问题
   * @param {string} problem       — 原始问题描述
   * @param {string} domain        — 领域提示 (可选)
   * @param {object} context       — 领域上下文
   * @param {object} knowledgeBase — KnowledgeBase 实例 (可选，查重去冗余)
   * @returns {{ id, problem, domain, subQuestions[], total, fromKb, new }}
   */
  decompose(problem, domain = null, context = {}, knowledgeBase = null) {
    const id = require('crypto').randomUUID();
    let rawQuestions = [];

    const detectedDomain = domain || this.detectDomain(problem);
    const deco = DOMAIN_DECOMPOSERS[detectedDomain];
    if (deco) {
      rawQuestions = deco(context.body || context.stats || context.profile || context.data || context.target || problem);
    }
    if (rawQuestions.length < 5) {
      rawQuestions = rawQuestions.concat(this.genericDecompose(problem));
    }
    if (rawQuestions.length > this.maxSubQuestions) {
      rawQuestions = rawQuestions.slice(0, this.maxSubQuestions);
    }

    // 去重：逐条查知识库，已有答案的直接标记为已解
    let fromKb = 0;
    let newCount = 0;
    const subQuestions = [];

    for (let i = 0; i < rawQuestions.length; i++) {
      const q = rawQuestions[i];
      const sq = {
        id: `${id}_q${i}`,
        question: q.question,
        hint: q.hint || '',
        domain: q.domain || 'general',
        answer: null,
        solved: false,
        fromKb: false,
        solutions: [],
      };

      // 查知识库
      if (knowledgeBase) {
        const cached = knowledgeBase.answer(detectedDomain, q.question);
        if (cached) {
          sq.answer = cached.answer;
          sq.solved = true;
          sq.fromKb = true;
          sq.solutions = [{
            answer: cached.answer,
            method: cached.method,
            size: cached.size,
            residentId: 'knowledge_base',
            residentName: '知识库',
            timestamp: Date.now(),
          }];
          fromKb++;
        } else {
          newCount++;
        }
      } else {
        newCount++;
      }

      subQuestions.push(sq);
    }

    const answered = subQuestions.filter(q => q.solved).length;
    return {
      id,
      problem,
      domain: detectedDomain,
      subQuestions,
      total: subQuestions.length,
      answered,
      fromKb,
      new: newCount,
      status: answered >= subQuestions.length * 0.8 ? 'solved' : 'open',
    };
  }

  /**
   * 自动检测问题领域
   */
  detectDomain(problem) {
    const lower = problem.toLowerCase();
    if (/代码|code|bug|函数|变量|内存|语法|编译|js|javascript|python/.test(lower)) return 'code_quality';
    if (/健康|内存|cpu|磁盘|负载|p2p|连接|限流|进程/.test(lower)) return 'house_health';
    if (/社交|交友|邻居|协作|聊天|匹配|性格/.test(lower)) return 'resident_dating';
    if (/压缩|数据|大小|字节|存储|重复/.test(lower)) return 'data_compression';
    if (/安全|漏洞|攻击|注入|密钥|密码|https|ssl|认证/.test(lower)) return 'security_audit';
    return 'general';
  }

  /**
   * 通用布尔化 — 任何抽象问题尝试生成基础判断
   */
  genericDecompose(problem) {
    const questions = [];
    const words = problem.split(/[\s,，。！？?]+/).filter(w => w.length > 1);

    for (const word of words.slice(0, 20)) {
      if (/[a-zA-Z\u4e00-\u9fff]{2,}/.test(word)) {
        questions.push({
          question: `涉及「${word}」吗?`,
          hint: `分析是否与关键词"${word}"相关`,
          domain: 'general',
        });
      }
    }
    return questions;
  }
}

export { ProblemDecomposer, DOMAIN_DECOMPOSERS };
export default ProblemDecomposer;
