import { pluginManager } from '../../plugins/plugin-manager.js';
import { memoryManager } from '../../memory/memory-manager.js';
import { sessionManager } from '../session-manager.js';
import { PromptBuilder } from '../convergence/prompt-builder.js';
import { agentMonitor } from './agent-monitor.js';
import { sessionEvents } from '../session-events.js';
import { QualityChecker, Corrector } from '../quality/quality-check-system.js';
import * as responseCache from '../response-cache.js';
import logger from '../monitoring/logger.js';
import { runPipeline, getEditProtocolGuidance } from '../epc-pipeline.mjs';

// Map model-invented tool names to exec_command
function mapActionToCommand(name, args) {
  const platform = process.platform === 'win32' ? 'win32' : 'posix';
  const lsCmd = platform === 'win32' ? 'dir' : 'ls';
  const catCmd = platform === 'win32' ? 'type' : 'cat';
  const pwdCmd = platform === 'win32' ? 'cd' : 'pwd';
  const path = args.path || args.file || args.directory || args.target || '.';
  switch (name) {
    case 'list_files': case 'list_dir': case 'ls': case 'dir':
      return `${lsCmd} ${path}`;
    case 'read_file': case 'cat': case 'view':
      return `${catCmd} ${path}`;
    case 'current_dir': case 'pwd': case 'getcwd':
      return pwdCmd;
    case 'search': case 'grep': case 'find':
      return `find ${path} -name "${args.pattern || '*'}"`;
    default:
      return `${lsCmd} ${path}`;
  }
}

/**
 * Agent 事件类型
 */
export const AgentEvents = {
  THINKING: 'thinking',           // 思考中
  CONTENT: 'content',             // 内容输出
  TOOL_CALL: 'tool_call',         // 工具调用
  TOOL_RESULT: 'tool_result',     // 工具结果
  ITERATION: 'iteration',         // 迭代开始
  COMPLETE: 'complete',           // 完成
  ERROR: 'error'                  // 错误
};

/**
 * AgentEngine implements the "Think-Act-Verify" loop with self-verification.
 * It transforms the Bridge from a pass-through server into an autonomous agent.
 *
 * 支持 Function Calling：
 * - 优先使用原生 Function Calling (OpenAI/Claude/etc)
 * - 自动降级到 ACTION: 文本解析 (不支持 FC 的模型)
 *
 * 支持流式输出：
 * - processStream() 返回 AsyncGenerator
 * - 通过事件回调实时推送执行状态
 */
export class AgentEngine {
  constructor(options = {}) {
    this.maxIterations = 10;
    this.qualityThreshold = 4; // 低于这个分数会自动优化
    this.useRAG = options.useRAG !== false; // 默认启用 RAG
    this.useFunctionCalling = options.useFunctionCalling !== false; // 默认启用 FC

    // 保存注入依赖
    this.memoryManager = options.memoryManager || null;
    this.sessionManager = options.sessionManager || null;
    this.pluginManager = options.pluginManager || null;
    this.agentMonitor = options.agentMonitor || null;
    this.residentMemory = options.residentMemory || null;
    this.PromptBuilder = options.PromptBuilder || null;

    // ✨ 集成质量检查系统
    this.qualityChecker = new QualityChecker(options.config || {});
    this.corrector = new Corrector(options.config || {});
    this.enableQualityCheck = options.enableQualityCheck !== false; // 默认启用
  }

  /**
   * 流式处理 - 通过回调实时推送执行状态
   * @param {string} sessionId 会话ID
   * @param {string} userId 用户ID
   * @param {string} userMessage 用户消息
   * @param {function} onEvent 事件回调 (event) => void
   * @returns {Promise<string>} 最终响应
   */
  async processStream(sessionId, userId, userMessage, onEvent = () => {}) {
    const broadcast = (event) => { onEvent(event); sessionEvents.publish(sessionId, event); };
    // 初始化
    if (this.useRAG && !memoryManager.initialized) {
      await memoryManager.initialize();
    }

    // RAG 检索
    let ragContext = [];
    if (this.useRAG && memoryManager.useRAG) {
      try {
        ragContext = await memoryManager.retrieveRelevantContext(userMessage, {
          userId, sessionId, topK: 5
        });
      } catch (e) {
        logger.warn('[Agent] RAG retrieval failed:', e.message);
      }
    }

    let currentContext = await memoryManager.getContext(sessionId);
    currentContext = currentContext.slice(-6);

    if (ragContext.length > 0) {
      const ragMessages = ragContext.map(r => ({
        role: 'system',
        content: `[相关历史] ${r.content}`
      }));
      currentContext = [...ragMessages, ...currentContext];
    }

    await memoryManager.addMessage(sessionId, 'user', userMessage);

    const session = sessionManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const provider = sessionManager.getProvider(session.providerType);

    const cached = responseCache.get(userMessage, session.model);
    if (cached) {
      broadcast({ type: AgentEvents.CONTENT, content: cached, iteration: 0 });
      broadcast({ type: AgentEvents.COMPLETE, response: cached, iterations: 0, fromCache: true });
      await memoryManager.addMessage(sessionId, 'assistant', cached);
      return cached;
    }

    const tools = this.useFunctionCalling ? pluginManager.getToolsForFunctionCalling() : null;
    const agentId = `agent-${sessionId}`;
    const systemPrompt = await PromptBuilder.buildSystemPrompt(1);
    // Strip text-based tool format hints when FC tools are available (they confuse some models)
    const finalPrompt = tools?.length ? systemPrompt.replace(/\n需要调工具时，.*?(?:\n\n|$)/s, '').trim() : systemPrompt;
    const finalSystemPrompt = tools?.length ? `${finalPrompt}\n\n${getEditProtocolGuidance()}` : finalPrompt;
    let messages = [
      { role: 'system', content: finalSystemPrompt },
      ...currentContext
    ];

    // 把当前 userMessage 显式加入消息数组（避免 getContext 不含最新消息）
    messages.push({ role: 'user', content: userMessage });

    agentMonitor.recordExecutionStart(agentId, userMessage, { sessionId, userId });

    // 【两轮制】Pass 1: 工具可以调，Pass 2: 只收最终答案
    let finalizedResponse = null;

    let _textFallbackUsed = false;
    for (let pass = 1; pass <= 2; pass++) {
      const chatOptions = {};
      if (pass === 1 && tools && tools.length > 0) {
        chatOptions.tools = tools;
        chatOptions.tool_choice = 'auto';
      }

      broadcast({ type: AgentEvents.THINKING, iteration: pass });
      let content = '';
      let toolCalls = null;

      try {
        const stream = provider.chatStream(session.model, messages, chatOptions);
        for await (const chunk of stream) {
          if (chunk.type === 'content') {
            content += chunk.content;
            broadcast({ type: AgentEvents.CONTENT, content: chunk.content, iteration: pass });
          } else if (chunk.type === 'thinking') {
            broadcast({ type: AgentEvents.THINKING, content: chunk.content, iteration: pass });
          } else if (chunk.type === 'tool_calls') {
            toolCalls = chunk.toolCalls;
          }
        }
      } catch (e) {
        const response = await provider.chat(session.model, messages, chatOptions);
        const p = runPipeline(response);
        content = p.content;
        toolCalls = p.toolCalls;
      }

      // Stream produced empty/no toolCalls but tools expected → fallback to non-streaming FC
      if (pass === 1 && chatOptions.tools && !toolCalls?.length && (!content || content.trim().length < 3)) {
        const fb = await provider.chat(session.model, messages, chatOptions);
        const p = runPipeline(fb);
        content = p.content;
        toolCalls = p.toolCalls;
      }

      let lastToolResult = null;
      if (pass === 1 && toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          let toolName = tc.name;
          let args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;
          broadcast({ type: AgentEvents.TOOL_CALL, tool: toolName, args, iteration: pass });
          // Detect text-fallback origin (id starts with textfb_ from provider-kit)
          if (tc.id && tc.id.startsWith('textfb_')) _textFallbackUsed = true;
          try {
            const toolResult = await pluginManager.executeTool(toolName, args, { sessionId, userId });
            lastToolResult = toolResult;
            agentMonitor.recordToolCall(agentId, toolName, args, toolResult);
            broadcast({ type: AgentEvents.TOOL_RESULT, tool: toolName, result: toolResult, iteration: pass });
            await memoryManager.addMessage(sessionId, 'system', `[Tool Result] ${toolName}: ${JSON.stringify(toolResult).slice(0, 2000)}`);
          } catch (error) {
            // Map unknown tool names (model-invented) to exec_command
            const knownTools = pluginManager.getToolsForFunctionCalling?.() || [];
            const knownNames = new Set(knownTools.map(t => (t.function || t).name));
            if (!knownNames.has(toolName)) {
              const cmd = mapActionToCommand(toolName, args);
              const mappedArgs = { command: cmd };
              try {
                const mappedResult = await pluginManager.executeTool('exec_command', mappedArgs, { sessionId, userId });
                lastToolResult = mappedResult;
                toolName = 'exec_command';
                args = mappedArgs;
                _textFallbackUsed = true;
                agentMonitor.recordToolCall(agentId, toolName, args, mappedResult);
                broadcast({ type: AgentEvents.TOOL_RESULT, tool: toolName, result: mappedResult, iteration: pass });
                await memoryManager.addMessage(sessionId, 'system', `[Tool Result] ${toolName}: ${JSON.stringify(mappedResult).slice(0, 2000)}`);
              } catch (mappedError) {
                agentMonitor.recordToolCall(agentId, toolName, args, { error: mappedError.message });
                broadcast({ type: AgentEvents.ERROR, tool: toolName, error: mappedError.message, iteration: pass });
                await memoryManager.addMessage(sessionId, 'system', `[Tool Error] ${toolName}: ${mappedError.message}`);
              }
            } else {
              agentMonitor.recordToolCall(agentId, toolName, args, { error: error.message });
              broadcast({ type: AgentEvents.ERROR, tool: toolName, error: error.message, iteration: pass });
              await memoryManager.addMessage(sessionId, 'system', `[Tool Error] ${toolName}: ${error.message}`);
            }
          }
        }
        // For text-fallback (non-FC models), use tool result directly, skip pass 2
        if (_textFallbackUsed) {
          if (lastToolResult) {
            const stdout = (lastToolResult.stdout || '').trim();
            finalizedResponse = stdout || JSON.stringify(lastToolResult).slice(0, 3000);
          }
          break;
        }
        // Pass 2: different system prompt — verify then answer
        const context = await memoryManager.getContext(sessionId);
        messages = [
          { role: 'system', content: 'You called a tool and got results above. Answer the user based on those results. Do not call tools again.' },
          { role: 'user', content: userMessage },
          ...context.slice(-4)
        ];
      } else {
        finalizedResponse = content || '';
        break;
      }
    }

    if (!finalizedResponse) {
      finalizedResponse = "I could not complete the task.";
    }

    responseCache.set(userMessage, session.model, finalizedResponse);

    onEvent({
      type: AgentEvents.COMPLETE,
      response: finalizedResponse,
      iterations: finalizedResponse ? 1 : 2,
      actions: 0
    });

    agentMonitor.recordExecutionComplete(agentId, {
      success: true,
      response: finalizedResponse,
      iterations: 1
    });

    await memoryManager.addMessage(sessionId, 'assistant', finalizedResponse);
    return finalizedResponse;
  }

  /**
   * The main reasoning loop (Think-Act-Verify) with RAG enhancement
   */
  async process(sessionId, userId, userMessage) {
    // 初始化 RAG 系统
    const mm = this.memoryManager || memoryManager;
    if (this.useRAG && !mm.initialized) {
      await mm.initialize();
    }

    // [优化] 提前获取 session 和 provider，避免循环内重复获取
    const sm = this.sessionManager || sessionManager;
    const session = sm.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const provider = sm.getProvider(session.providerType);

    // [RAG] 检索相关历史上下文
    let ragContext = [];
    if (this.useRAG && mm.useRAG) {
      try {
        ragContext = await mm.retrieveRelevantContext(userMessage, {
          userId,
          sessionId,
          topK: 5
        });

        if (ragContext.length > 0) {
          logger.info(`[Agent] RAG retrieved ${ragContext.length} relevant messages`);
        }
      } catch (e) {
        logger.warn('[Agent] RAG retrieval failed:', e.message);
      }
    }

    let currentContext = await mm.getContext(sessionId);

    // 如果有 RAG 上下文，构建增强上下文
    if (ragContext.length > 0) {
      const ragMessages = ragContext.map(r => ({
        role: 'system',
        content: `[相关历史] ${r.content}`
      }));
      // 插入到系统提示后、当前上下文前
      currentContext = [...ragMessages, ...currentContext];
    }

    // 1. Append user message to memory
    await mm.addMessage(sessionId, 'user', userMessage);

    // 记录执行轨迹用于最终自检
    const executionTrace = {
      actions: [],
      startTime: Date.now()
    };

    let iteration = 0;
    let finalizedResponse = null;
    let isTaskComplete = false;

    // 获取 Function Calling 工具定义（一次性）
    const tools = this.useFunctionCalling ? pluginManager.getToolsForFunctionCalling() : null;

    // [优化] 预构建系统提示
    const systemPrompt = await PromptBuilder.buildSystemPrompt(1);
    const finalPrompt = tools?.length ? systemPrompt.replace(/\n需要调工具时，.*?(?:\n\n|$)/s, '').trim() : systemPrompt;
    const finalSystemPrompt = tools?.length ? `${finalPrompt}\n\n${getEditProtocolGuidance()}` : finalPrompt;

    // [优化] 预构建请求选项
    const chatOptions = {};
    if (tools && tools.length > 0) {
      chatOptions.tools = tools;
      chatOptions.tool_choice = 'auto';
    }

    while (iteration < this.maxIterations && !isTaskComplete) {
      iteration++;

      // [SENSE] Build current state for LLM
      const messages = [
        { role: 'system', content: finalSystemPrompt },
        ...currentContext
      ];

      // [THINK] Call actual Provider with tools
      const llmResponse = await provider.chat(session.model, messages, chatOptions);
      const p = runPipeline(llmResponse);
      const content = p.content;
      const toolCalls = p.toolCalls;
      const args = toolCalls?.[0]?.function?.arguments || {};

      // 检查是否完成任务
      if (content && content.startsWith('FINAL:')) {
        finalizedResponse = content.replace('FINAL:', '').trim();
        isTaskComplete = true;
        break;
      }

      // [ACT] 处理工具调用 - 优先 Function Calling，降级到文本解析
      if (toolCalls && toolCalls.length > 0) {
        // Function Calling 模式
        for (const tc of toolCalls) {
          const toolName = tc.name;
          const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;

          try {
            logger.info(`[Agent] Function Calling: ${toolName}(${JSON.stringify(args)})`);
            const toolResult = await pluginManager.executeTool(toolName, args, { sessionId, userId });

            executionTrace.actions.push({ tool: toolName, args, result: toolResult, mode: 'fc' });

            // 使用格式化后的结果
            const formattedResult = pluginManager.formatToolResult(toolName, toolResult);
            await mm.addMessage(sessionId, 'assistant', `[Tool Call] ${toolName}`);
            await mm.addMessage(sessionId, 'system', formattedResult);

            // [优化] 增量更新上下文，而非重新获取全部
            currentContext.push(
              { role: 'assistant', content: `[Tool Call] ${toolName}` },
              { role: 'system', content: formattedResult }
            );
          } catch (error) {
            executionTrace.actions.push({ tool: toolName, args, error: error.message, mode: 'fc' });
            await mm.addMessage(sessionId, 'system', `[Tool Error] ${toolName}: ${error.message}`);
            currentContext.push({ role: 'system', content: `[Tool Error] ${toolName}: ${error.message}` });
          }
        }
      } else if (content && content.includes('ACTION:')) {
        // 降级模式：文本解析 ACTION: tool_name { "arg": "val" }
        const match = content.match(/ACTION:\s*(\w+)\s*({.*})/);
        if (match) {
          const [, toolName, argsJson] = match;
          try {
            const args = JSON.parse(argsJson);
            logger.info(`[Agent] Text Parse: ${toolName}(${JSON.stringify(args)})`);
            const toolResult = await pluginManager.executeTool(toolName, args, { sessionId, userId });

            executionTrace.actions.push({ tool: toolName, args, result: toolResult, mode: 'text' });

            const formatted = pluginManager.formatToolResult(toolName, toolResult);
            await mm.addMessage(sessionId, 'assistant', `Action: ${toolName}`);
            await mm.addMessage(sessionId, 'system', formatted);

            // [优化] 增量更新上下文
            currentContext.push(
              { role: 'assistant', content: `Action: ${toolName}` },
              { role: 'system', content: formatted }
            );
          } catch (error) {
            executionTrace.actions.push({ tool: toolName, args: args || {}, error: error.message, mode: 'text' });
            await mm.addMessage(sessionId, 'system', `Error executing ${toolName}: ${error.message}`);
            currentContext.push({ role: 'system', content: `Error executing ${toolName}: ${error.message}` });
          }
        }
      } else {
        // 没有工具调用，直接返回结果
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

    if (qualityReport && qualityReport.score < this.qualityThreshold) {
      logger.info(`[Agent] 质量得分 ${qualityReport.score} < ${this.qualityThreshold}，开始自我优化...`);
      finalizedResponse = await this.selfOptimize(sessionId, userId, userMessage, finalizedResponse, qualityReport);
    }

    await mm.addMessage(sessionId, 'assistant', finalizedResponse);
    return finalizedResponse;
  }

  /**
   * 执行自我质量验证
   */
  async performSelfVerification(trace) {
    try {
      const judgeTool = pluginManager.skills.get('run_llm_judge');
      if (!judgeTool) {
        logger.info('[Agent] 自检工具不可用，跳过验证');
        return null;
      }

      logger.info('[Agent] 执行自我质量验证...');
      
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
      
      logger.info(`[Agent] 质量得分: ${evaluation.score}/5`);
      logger.info(`[Agent] 反馈: ${evaluation.feedback}`);
      
      return evaluation;
      
    } catch (error) {
      logger.info('[Agent] 自检执行失败:', error.message);
      return null;
    }
  }

  /**
   * 自我优化流程
   */
  async selfOptimize(sessionId, userId, originalTask, originalResponse, qualityReport) {
    logger.info('[Agent] 开始自我优化...');
    
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
        { role: 'system', content: `${await PromptBuilder.buildSystemPrompt(1)}\n\n${getEditProtocolGuidance()}` },
        { role: 'user', content: optimizePrompt }
      ];
      
      const llmResponse = await provider.chat(session.model, messages);
      const optimizedResponse = (llmResponse.content || '').replace('FINAL:', '').trim();
      
      logger.info('[Agent] 自我优化完成');
      return optimizedResponse;

    } catch (error) {
      logger.info('[Agent] 优化失败:', error.message);
      return originalResponse; // 返回原始结果
    }
  }

  /**
   * ✨ 质量检查与纠偏
   * @private
   */
  async _checkAndCorrectResponse(response, sessionId, userId, onEvent) {
    try {
      // 第 1 步: 检查质量
      const check = await this.qualityChecker.check(response);

      // 发送质量检查事件
      onEvent({
        type: 'quality_check',
        score: check.score,
        passed: check.passed,
        issues: check.issues
      });

      logger.info(`[QC] 质量检查: ${check.score}/100, 通过: ${check.passed}`);

      if (check.passed) {
        // ✅ 合格，直接返回
        return response;
      }

      // ❌ 不合格，尝试纠偏
      logger.info(`[QC] 检测到质量问题: ${check.issues.join('; ')}`);

      const session = sessionManager.getSession(sessionId);
      const provider = sessionManager.getProvider(session.providerType);

      // 第 2 步: 生成纠偏反馈
      const feedback = this.corrector.generateFeedback(check.issues);

      // 第 3 步: 让大模型重新生成
      const messages = [
        { role: 'system', content: `${await PromptBuilder.buildSystemPrompt(1)}\n\n${getEditProtocolGuidance()}` },
        { role: 'user', content: feedback }
      ];

      const correctedResponse = await provider.chat(session.model, messages);
      const newContent = correctedResponse.content;

      // 发送纠偏事件
      onEvent({
        type: 'correction_attempt',
        originalScore: check.score,
        issues: check.issues
      });

      // 第 4 步: 再检查一次
      const newCheck = await this.qualityChecker.check(newContent);

      logger.info(`[QC] 纠偏后: ${newCheck.score}/100, 通过: ${newCheck.passed}`);

      if (newCheck.passed) {
        // ✅ 纠偏成功
        onEvent({
          type: 'correction_success',
          newScore: newCheck.score
        });
        return newContent;
      }

      // ❌ 纠偏失败，返回新内容（即使不完美）+ 错误提示
      logger.info(`[QC] 纠偏未达标，返回最佳版本`);

      return newContent;

    } catch (error) {
      logger.error('[QC] 质量检查异常:', error.message);
      // 异常时直接返回原始响应
      return response;
    }
  }
}

export const agentEngine = new AgentEngine();


// 迭代1: 错误恢复增强
class RobustErrorHandler {
  constructor() {
    this.errorLog = [];
    this.recoveryStrategies = new Map();
  }

  /**
   * 记录错误并尝试恢复
   * @param {Error} error - 发生的错误
   * @param {Function} recoveryFn - 恢复函数
   * @returns {Promise<any>} 恢复结果
   */
  async handleAndRecover(error, recoveryFn) {
    this.errorLog.push({
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      severity: this.assessSeverity(error)
    });

    if (this.errorLog.length > 1000) {
      this.errorLog = this.errorLog.slice(-500);
    }

    try {
      return await recoveryFn();
    } catch (recoveryError) {
      logger.error('Recovery failed:', recoveryError);
      throw error;
    }
  }

  /**
   * 评估错误严重程度
   */
  assessSeverity(error) {
    const message = error.message.toLowerCase();
    if (message.includes('critical') || message.includes('fatal')) return 'CRITICAL';
    if (message.includes('error') || message.includes('fail')) return 'HIGH';
    if (message.includes('warning')) return 'MEDIUM';
    return 'LOW';
  }

  getErrorReport() {
    return {
      total: this.errorLog.length,
      bySeverity: {
        critical: this.errorLog.filter(e => e.severity === 'CRITICAL').length,
        high: this.errorLog.filter(e => e.severity === 'HIGH').length,
        medium: this.errorLog.filter(e => e.severity === 'MEDIUM').length,
        low: this.errorLog.filter(e => e.severity === 'LOW').length,
      }
    };
  }
}