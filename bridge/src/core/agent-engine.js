import { pluginManager } from '../plugins/plugin-manager.js';
import { memoryManager } from '../memory/memory-manager.js';
import { sessionManager } from '../session/session-manager.js';
import { PromptBuilder } from './prompt-builder.js';

/**
 * AgentEngine implements the "Think-Act-Verify" loop with self-verification.
 * It transforms the Bridge from a pass-through server into an autonomous agent.
 */
export class AgentEngine {
  constructor() {
    this.maxIterations = 10;
    this.qualityThreshold = 4; // 低于这个分数会自动优化
  }

  /**
   * The main reasoning loop (Think-Act-Verify)
   */
  async process(sessionId, userId, userMessage) {
    let currentContext = await memoryManager.getContext(sessionId);
    
    // 1. Append user message to memory
    await memoryManager.addMessage(sessionId, 'user', userMessage);
    
    // 记录执行轨迹用于最终自检
    const executionTrace = {
      actions: [],
      startTime: Date.now()
    };
    
    let iteration = 0;
    let finalizedResponse = null;
    let isTaskComplete = false;

    while (iteration < this.maxIterations && !isTaskComplete) {
      iteration++;
      
      // [SENSE] Build current state for LLM
      const systemPrompt = await PromptBuilder.buildSystemPrompt(1);
      const messages = [
        { role: 'system', content: systemPrompt },
        ...currentContext
      ];

      // [THINK] Call actual Provider
      const session = sessionManager.getSession(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);
      const provider = sessionManager.getProvider(session.providerType);
      
      const llmResponse = await provider.chat(session.model, messages);
      const content = llmResponse.content;

      if (content.startsWith('FINAL:')) {
        finalizedResponse = content.replace('FINAL:', '').trim();
        isTaskComplete = true;
        break;
      }

      if (content.includes('ACTION:')) {
        // [ACT] Parse tool call: ACTION: tool_name { "arg": "val" }
        const match = content.match(/ACTION:\s*(\w+)\s*({.*})/);
        if (match) {
          const [, toolName, argsJson] = match;
          try {
            const args = JSON.parse(argsJson);
            const toolResult = await pluginManager.executeTool(
              toolName, 
              args, 
              { sessionId, userId }
            );
            
            // 记录动作用于自检
            executionTrace.actions.push({ tool: toolName, args, result: toolResult });
            
            // [VERIFY] Recording result back to history
            await memoryManager.addMessage(sessionId, 'assistant', `Action: ${toolName} Result: ${JSON.stringify(toolResult)}`);
            
            // Update context for next iteration
            currentContext = await memoryManager.getContext(sessionId);
          } catch (error) {
            // [SELF-HEAL]
            executionTrace.actions.push({ tool: toolName, args, error: error.message });
            await memoryManager.addMessage(sessionId, 'system', `Error executing ${toolName}: ${error.message}. Please correct the arguments and try again.`);
            currentContext = await memoryManager.getContext(sessionId);
          }
        }
      } else {
        // Fallback for unstructured responses
        finalizedResponse = content;
        isTaskComplete = true;
      }
    }

    if (iteration >= this.maxIterations && !isTaskComplete) {
      finalizedResponse = "I've reached the maximum number of reasoning steps and could not complete the task.";
    }

    // [SELF-VERIFY] 任务完成后进行质量自检
    executionTrace.endTime = Date.now();
    executionTrace.success = isTaskComplete && iteration < this.maxIterations;
    
    const qualityReport = await this.performSelfVerification(executionTrace);
    
    // 如果质量不达标，触发优化
    if (qualityReport && qualityReport.score < this.qualityThreshold) {
      console.log(`[Agent] 质量得分 ${qualityReport.score} < ${this.qualityThreshold}，开始自我优化...`);
      finalizedResponse = await this.selfOptimize(sessionId, userId, userMessage, finalizedResponse, qualityReport);
    }

    await memoryManager.addMessage(sessionId, 'assistant', finalizedResponse);
    return finalizedResponse;
  }

  /**
   * 执行自我质量验证
   */
  async performSelfVerification(trace) {
    try {
      const judgeTool = pluginManager.skills.get('run_llm_judge');
      if (!judgeTool) {
        console.log('[Agent] 自检工具不可用，跳过验证');
        return null;
      }

      console.log('[Agent] 执行自我质量验证...');
      
      // 构建符合预期的测试用例格式
      const testCase = {
        id: 'agent-task-verification',
        description: 'Agent任务执行质量评估',
        prompt: '评估Agent是否成功完成了用户请求的任务',
        expectedActions: trace.actions.map(a => a.tool),
        expectedOutcome: trace.success ? '任务成功完成' : '任务执行失败'
      };

      // 创建模拟的Agent响应格式
      const mockAgentResponse = {
        success: trace.success,
        errorHandled: !trace.actions.some(a => a.error),
        actions: trace.actions.map(a => a.tool),
        steps: trace.actions.length
      };

      // 临时修改llm-judge的测试用例
      const { LLMJudge } = await import('../../test-utils/llm-judge.js');
      const judge = new LLMJudge();
      judge.testCases = [testCase];
      
      const mockResult = await judge.mockAgentExecution(testCase);
      const evaluation = await judge.evaluateAgentPerformance(mockAgentResponse, testCase);
      
      console.log(`[Agent] 质量得分: ${evaluation.score}/5`);
      console.log(`[Agent] 反馈: ${evaluation.feedback}`);
      
      return evaluation;
      
    } catch (error) {
      console.log('[Agent] 自检执行失败:', error.message);
      return null;
    }
  }

  /**
   * 自我优化流程
   */
  async selfOptimize(sessionId, userId, originalTask, originalResponse, qualityReport) {
    console.log('[Agent] 开始自我优化...');
    
    // 记录当前状态
    await memoryManager.addMessage(sessionId, 'system', 
      `【自我优化】质量报告: 得分 ${qualityReport.score}/5。需要改进的方面: ${qualityReport.feedback}`
    );
    
    // 提示LLM进行优化
    const session = sessionManager.getSession(sessionId);
    const provider = sessionManager.getProvider(session.providerType);
    
    const optimizePrompt = `用户原始任务: ${originalTask}
    
之前的执行结果质量不够好 (得分 ${qualityReport.score}/5)。
反馈: ${qualityReport.feedback}

请重新执行任务，这次要确保:
1. 正确选择和使用工具
2. 提供完整的实现
3. 如果有测试需求，务必包含测试代码
4. 确保代码质量

请用 FINAL: 格式返回优化后的结果。`;

    try {
      const messages = [
        { role: 'system', content: await PromptBuilder.buildSystemPrompt(1) },
        { role: 'user', content: optimizePrompt }
      ];
      
      const llmResponse = await provider.chat(session.model, messages);
      const optimizedResponse = llmResponse.content.replace('FINAL:', '').trim();
      
      console.log('[Agent] 自我优化完成');
      return optimizedResponse;
      
    } catch (error) {
      console.log('[Agent] 优化失败:', error.message);
      return originalResponse; // 返回原始结果
    }
  }
}

export const agentEngine = new AgentEngine();
