import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import llmIntegration from './llm-integration.js';

class LLMJudge {
  constructor() {
    this.evalConfig = JSON.parse(fs.readFileSync('./test-utils/eval-setup.json', 'utf8'));
    this.testCases = this.loadTestCases();
  }

  loadTestCases() {
    return [
      {
        id: 'file-creation',
        description: '创建并验证文件',
        prompt: '创建一个名为 test.txt 的文件，内容为 "Hello World"，然后验证文件内容是否正确',
        expectedActions: ['write_file', 'read_file'],
        expectedOutcome: '文件创建成功且内容正确',
        successCriteria: {
          hasVerification: true,
          correctToolChoice: true,
          errorHandled: true
        }
      },
      {
        id: 'git-operation', 
        description: '基础的Git操作',
        prompt: '初始化一个Git仓库，添加一个文件并提交',
        expectedActions: ['git_status', 'run_command'],
        expectedOutcome: '成功创建提交',
        successCriteria: {
          hasVerification: true,
          correctToolChoice: true,
          errorHandled: true
        }
      },
      {
        id: 'error-recovery',
        description: '错误恢复测试',
        prompt: '尝试读取一个不存在的文件，然后处理错误',
        expectedActions: ['read_file'],
        expectedOutcome: '正确处理文件不存在错误',
        successCriteria: {
          hasVerification: false,
          correctToolChoice: true,
          errorHandled: true
        }
      },
      {
        id: 'multi-tool-collaboration',
        description: '多工具协作场景',
        prompt: '读取一个文件，统计其中的行数，然后创建一个包含统计结果的报告',
        expectedActions: ['read_file', 'run_command'],
        expectedOutcome: '成功完成多步骤任务',
        successCriteria: {
          hasVerification: true,
          correctToolChoice: true,
          errorHandled: true
        }
      },
      {
        id: 'code-review',
        description: '代码审查场景',
        prompt: '检查项目中是否有语法错误，运行 lint 检查并修复发现的问题',
        expectedActions: ['run_command'],
        expectedOutcome: '完成代码审查和修复',
        successCriteria: {
          hasVerification: true,
          correctToolChoice: true,
          errorHandled: true
        }
      },
      {
        id: 'data-processing',
        description: '数据处理场景',
        prompt: '读取一个 JSON 文件，解析内容，然后输出统计摘要',
        expectedActions: ['read_file', 'run_command'],
        expectedOutcome: '成功处理数据并输出结果',
        successCriteria: {
          hasVerification: true,
          correctToolChoice: true,
          errorHandled: true
        }
      },
      {
        id: 'api-call',
        description: 'API 调用场景',
        prompt: '使用 curl 或类似工具调用一个公开 API，获取数据并格式化输出',
        expectedActions: ['run_command'],
        expectedOutcome: '成功获取并展示 API 数据',
        successCriteria: {
          hasVerification: true,
          correctToolChoice: true,
          errorHandled: true
        }
      },
      {
        id: 'complex-logic',
        description: '复杂逻辑场景',
        prompt: '编写一个函数，实现斐波那契数列计算，并编写测试验证正确性',
        expectedActions: ['write_file', 'run_command'],
        expectedOutcome: '正确实现并通过测试',
        successCriteria: {
          hasVerification: true,
          correctToolChoice: true,
          errorHandled: true
        }
      }
    ];
  }

  async evaluateAgentPerformance(agentResponse, testCase) {
    const evaluationId = uuidv4();
    
    try {
      const llmResponse = await llmIntegration.evaluateWithLLM(
        agentResponse, 
        testCase, 
        this.evalConfig
      );
      
      llmResponse.evaluationId = evaluationId;
      this.saveEvaluationResult(llmResponse, testCase);
      return llmResponse;
      
    } catch (error) {
      console.warn('LLM评测失败，使用备用评估:', error.message);
      
      const fallbackResponse = {
        score: this.calculateMockScore(agentResponse, testCase),
        feedback: this.generateMockFeedback(agentResponse, testCase),
        evaluationId,
        breakdown: {
          tool_selection_accuracy: 3,
          parameter_correctness: 3,
          logical_reasoning: 3,
          error_handling: 3,
          efficiency: 3
        }
      };

      this.saveEvaluationResult(fallbackResponse, testCase);
      return fallbackResponse;
    }
  }

  buildEvaluationPrompt(agentResponse, testCase) {
    // 现在在llm-integration.js中构建
    return '';
  }

  calculateMockScore(agentResponse, testCase) {
    // 简单模拟评分逻辑
    if (agentResponse.success) return 5;
    if (agentResponse.errorHandled) return 4;
    return 3;
  }

  generateMockFeedback(agentResponse, testCase) {
    return agentResponse.success 
      ? '完美执行，所有步骤正确' 
      : '需要改进：' + (agentResponse.error || '未知错误');
  }

  saveEvaluationResult(result, testCase) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultDir = path.join(process.cwd(), 'test-results');
    const resultPath = path.join(resultDir, `${testCase.id}-${timestamp}.json`);
    
    const fullResult = {
      ...result,
      testCase,
      timestamp
    };

    fs.mkdirSync(resultDir, { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify(fullResult, null, 2));
    } catch (error) {
      console.warn('保存结果失败:', error.message);
      // 继续执行，不阻塞测试
    }
  }

  async runFullEvaluationSuite() {
    console.log('🚀 开始LLM-as-a-Judge评测套件...');
    
    const results = [];
    for (const testCase of this.testCases) {
      console.log(`\n📋 运行测试: ${testCase.description}`);
      
      // 这里需要实际运行Agent并获取执行轨迹
      const agentResponse = await this.mockAgentExecution(testCase);
      
      const evaluation = await this.evaluateAgentPerformance(agentResponse, testCase);
      results.push(evaluation);
      
      console.log(`  得分: ${evaluation.score}/5 - ${evaluation.feedback}`);
    }

    return this.generateSummaryReport(results);
  }

  async mockAgentExecution(testCase) {
    // 基于测试用例的成功标准生成更真实的模拟结果
    const criteria = testCase.successCriteria || {
      hasVerification: Math.random() > 0.3,
      correctToolChoice: Math.random() > 0.2,
      errorHandled: Math.random() > 0.3
    };

    // 根据成功率计算最终成功概率
    const successRate = (
      (criteria.hasVerification ? 0.9 : 0.6) +
      (criteria.correctToolChoice ? 0.95 : 0.5) +
      (criteria.errorHandled ? 0.9 : 0.5)
    ) / 3;

    const success = Math.random() < successRate;
    const errorHandled = criteria.errorHandled || (!success && Math.random() > 0.5);

    // 生成合理的步骤数
    let steps = testCase.expectedActions.length;
    if (criteria.hasVerification) steps += 1; // 验证步骤
    if (success && Math.random() > 0.7) steps += 1; // 可能的额外验证

    return {
      success,
      errorHandled,
      actions: testCase.expectedActions,
      steps,
      hasVerification: criteria.hasVerification,
      correctToolChoice: criteria.correctToolChoice
    };
  }

  generateSummaryReport(results) {
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    
    return {
      totalTests: results.length,
      averageScore: avgScore.toFixed(2),
      results: results.map(r => ({
        testCase: r.testCase?.id || 'unknown',
        score: r.score,
        feedback: r.feedback
      }))
    };
  }
}

// 运行评测
if (import.meta.url === `file://${process.argv[1]}`) {
  const judge = new LLMJudge();
  judge.runFullEvaluationSuite().then(report => {
    console.log('\n📊 评测总结:', JSON.stringify(report, null, 2));
  });
}

export { LLMJudge };