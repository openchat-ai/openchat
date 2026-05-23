import axios from 'axios';
import siliconFlowIntegration from './siliconflow-integration.js';
import deepseekIntegration from './deepseek-integration.js';
import ollamaIntegration from './ollama-integration.js';
import groqIntegration from './groq-integration.js';
import { config } from 'dotenv';

config({ path: './.env' });

class LLMIntegration {
  constructor() {
    this.useSiliconFlow = process.env.USE_SILICONFLOW === 'true';
    this.useDeepSeek = process.env.USE_DEEPSEEK === 'true';
    this.useOllama = process.env.USE_OLLAMA === 'true';
    this.useGroq = process.env.USE_GROQ === 'true';
  }

  async callLLM(prompt, systemPrompt = null) {
    // 1. 优先尝试 硅基流动（国内可用）
    if (this.useSiliconFlow) {
      try {
        const status = await siliconFlowIntegration.checkStatus();
        if (status.running) {
          console.log('🎯 使用 硅基流动 模型:', siliconFlowIntegration.model);
          return await siliconFlowIntegration.callLLM(prompt, systemPrompt);
        } else {
          console.warn('⚠️  硅基流动 不可用:', status.error);
        }
      } catch (error) {
        console.warn('硅基流动 检查失败:', error.message);
      }
    }

    // 2. 回退到 DeepSeek
    if (this.useDeepSeek) {
      try {
        const status = await deepseekIntegration.checkDeepSeekStatus();
        if (status.running) {
          console.log('🎯 使用 DeepSeek 模型:', deepseekIntegration.model);
          return await deepseekIntegration.callLLM(prompt, systemPrompt);
        } else {
          console.warn('⚠️  DeepSeek 不可用:', status.error);
        }
      } catch (error) {
        console.warn('DeepSeek 检查失败:', error.message);
      }
    }

    // 3. 回退到 Ollama Cloud
    if (this.useOllama) {
      try {
        const status = await ollamaIntegration.checkOllamaStatus();
        if (status.running && status.modelAvailable) {
          console.log('🎯 使用 Ollama Cloud 模型:', ollamaIntegration.model);
          return await ollamaIntegration.callLLM(prompt, systemPrompt);
        } else {
          console.warn('⚠️  Ollama Cloud 不可用');
        }
      } catch (error) {
        console.warn('Ollama Cloud 检查失败:', error.message);
      }
    }

    // 4. 回退到 Groq
    if (this.useGroq) {
      try {
        const status = await groqIntegration.checkGroqStatus();
        if (status.running) {
          console.log('🎯 使用 Groq 模型:', groqIntegration.model);
          return await groqIntegration.callLLM(prompt, systemPrompt);
        } else {
          console.warn('⚠️  Groq 不可用');
        }
      } catch (error) {
        console.warn('Groq 检查失败:', error.message);
      }
    }

    console.warn('⚠️  所有 LLM API 都不可用，使用模拟响应');
    return this.generateMockResponse(prompt);
  }

  generateMockResponse(prompt) {
    // 智能模拟响应基于提示内容
    if (prompt.includes('评测')) {
      return {
        score: 4,
        feedback: '模拟评测: 执行良好，但有些工具选择可优化',
        breakdown: {
          tool_selection_accuracy: 4,
          parameter_correctness: 5,
          logical_reasoning: 4,
          error_handling: 3,
          efficiency: 4
        }
      };
    }
    return { score: 4, feedback: '默认模拟响应' };
  }

  async evaluateWithLLM(agentResponse, testCase, evaluationConfig) {
    const prompt = this.buildEvaluationPrompt(agentResponse, testCase, evaluationConfig);
    const systemPrompt = '你是一个严格的AI工程师评测专家。请根据提供的评测标准对Agent执行表现进行客观评分，输出JSON格式结果。';

    const result = await this.callLLM(prompt, systemPrompt);
    
    // 验证结果格式
    return this.validateEvaluationResult(result, evaluationConfig);
  }

  buildEvaluationPrompt(agentResponse, testCase, evaluationConfig) {
    return `作为AI工程师评测专家，请评估以下Agent的执行表现：

## 任务信息
- 描述: ${testCase.description}
- 提示: ${testCase.prompt}
- 预期动作: ${testCase.expectedActions.join(', ')}
- 预期结果: ${testCase.expectedOutcome}

## Agent执行轨迹
${JSON.stringify(agentResponse, null, 2)}

## 评测标准
${JSON.stringify(evaluationConfig.evaluationCriteria, null, 2)}

## 评分指南
${JSON.stringify(evaluationConfig.scoringGuide, null, 2)}

请输出严格的JSON格式评测结果，包含:
{
  "score": 1-5,
  "feedback": "详细的技术性反馈",
  "breakdown": {
    "tool_selection_accuracy": 1-5,
    "parameter_correctness": 1-5,
    "logical_reasoning": 1-5,
    "error_handling": 1-5,
    "efficiency": 1-5
  },
  "suggestions": ["具体改进建议1", "具体改进建议2"]
}`;
  }

  validateEvaluationResult(result, evaluationConfig) {
    // 基本验证
    if (typeof result.score !== 'number' || result.score < 1 || result.score > 5) {
      result.score = 3; // 默认值
    }

    // 确保breakdown包含所有标准
    const expectedCriteria = evaluationConfig.evaluationCriteria.map(c => c.name);
    if (!result.breakdown) {
      result.breakdown = {};
    }

    expectedCriteria.forEach(criterion => {
      if (typeof result.breakdown[criterion] !== 'number') {
        result.breakdown[criterion] = 3;
      }
    });

    return result;
  }
}

// 导出单例
const llmIntegration = new LLMIntegration();
export default llmIntegration;