import { pluginManager } from '../plugin-manager.js';
import { memoryManager } from '../../memory/memory-manager.js';
import { sessionManager } from '../session-manager.js';
import { PromptBuilder } from '../convergence/prompt-builder.js';
import { agentMonitor } from './agent-monitor.js';
import { sessionEvents } from '../session-events.js';
import { QualityChecker, Corrector } from '../quality/quality-check-system.js';
import * as responseCache from '../response-cache.js';
import logger from '../monitoring/logger.js';
import { runPipeline, getEditProtocolGuidance } from '../epc-pipeline.mjs';
import { GoalManager } from '../goal-manager.mjs';

let _injectedTools = [];
let _injectedExec = null;

export function injectCodingTools(tools, execFn) {
  _injectedTools = tools;
  _injectedExec = execFn;
}

const _CODING_NAMES = () => new Set(_injectedTools.map(t => t.function.name));

function _getFC() {
  const pm = pluginManager.getToolsForFunctionCalling() || [];
  return [...pm, ..._injectedTools];
}

async function _exec(name, args, ctx) {
  if (_CODING_NAMES().has(name)) {
    const r = await _injectedExec(name, args);
    return { success: true, content: typeof r === 'string' ? r : JSON.stringify(r), ...(typeof r === 'object' ? r : {}) };
  }
  return pluginManager.executeTool(name, args, ctx);
}

function _knownNames() {
  const pm = pluginManager.getToolsForFunctionCalling?.() || [];
  return new Set([...pm.map(t => (t.function || t).name), ..._CODING_NAMES()]);
}

function mapActionToCommand(name, args) {
  const platform = process.platform === 'win32' ? 'win32' : 'posix';
  const lsCmd = platform === 'win32' ? 'dir' : 'ls';
  const catCmd = platform === 'win32' ? 'type' : 'cat';
  const pwdCmd = platform === 'win32' ? 'cd' : 'pwd';
  const path = args.path || args.file || args.directory || args.target || '.';
  switch (name) {
    case 'list_files': case 'list_dir': case 'ls': case 'dir': return `${lsCmd} ${path}`;
    case 'read_file': case 'cat': case 'view': return `${catCmd} ${path}`;
    case 'current_dir': case 'pwd': case 'getcwd': return pwdCmd;
    case 'search': case 'grep': case 'find': return `find ${path} -name "${args.pattern || '*'}"`;
    default: return `${lsCmd} ${path}`;
  }
}

export const OrchestratorEvents = {
  THINKING: 'thinking',
  CONTENT: 'content',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  ITERATION: 'iteration',
  COMPLETE: 'complete',
  ERROR: 'error',
};

export const AgentEvents = OrchestratorEvents;

export class Orchestrator {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 10;
    this.qualityThreshold = 4;
    this.useRAG = options.useRAG !== false;
    this.useFunctionCalling = options.useFunctionCalling !== false;
    this.memoryManager = options.memoryManager || null;
    this.sessionManager = options.sessionManager || null;
    this.pluginManager = options.pluginManager || null;
    this.agentMonitor = options.agentMonitor || null;
    this.PromptBuilder = options.PromptBuilder || null;
    this.qualityChecker = options.qualityChecker || new QualityChecker(options.config || {});
    this.corrector = options.corrector || new Corrector(options.config || {});
    this.enableQualityCheck = options.enableQualityCheck !== false;
    this.goalManager = options.goalManager || new GoalManager({
      sessionManager: this.sessionManager || sessionManager,
      memoryManager: this.memoryManager || memoryManager,
      evolutionMemory: options.evolutionMemory || null,
    });
  }

  async processStream(sessionId, userId, userMessage, onEvent = () => {}) {
    const broadcast = (event) => { onEvent(event); sessionEvents.publish(sessionId, event); };
    const mm = this.memoryManager || memoryManager;
    if (this.useRAG && !mm.initialized) await mm.initialize();

    let ragContext = [];
    if (this.useRAG && mm.useRAG) {
      try { ragContext = await mm.retrieveRelevantContext(userMessage, { userId, sessionId, topK: 5 }); }
      catch (e) { logger.warn('[Orchestrator] RAG retrieval failed:', e.message); }
    }

    let currentContext = await mm.getContext(sessionId);
    currentContext = currentContext.slice(-6);
    if (ragContext.length > 0) {
      currentContext = [...ragContext.map(r => ({ role: 'system', content: `[相关历史] ${r.content}` })), ...currentContext];
    }

    await mm.addMessage(sessionId, 'user', userMessage);

    const sm = this.sessionManager || sessionManager;
    const session = sm.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    const provider = sm.getProvider(session.providerType);

    const cached = responseCache.get(userMessage, session.model);
    if (cached) {
      broadcast({ type: OrchestratorEvents.CONTENT, content: cached, iteration: 0 });
      broadcast({ type: OrchestratorEvents.COMPLETE, response: cached, iterations: 0, fromCache: true });
      await mm.addMessage(sessionId, 'assistant', cached);
      return cached;
    }

    const tools = this.useFunctionCalling ? _getFC() : null;
    const agentId = `orch-${sessionId}`;
    const systemPrompt = await PromptBuilder.buildSystemPrompt(1);
    const finalPrompt = tools?.length ? systemPrompt.replace(/\n需要调工具时，.*?(?:\n\n|$)/s, '').trim() : systemPrompt;
    const finalSystemPrompt = tools?.length ? `${finalPrompt}\n\n${getEditProtocolGuidance()}` : finalPrompt;
    let messages = [
      { role: 'system', content: finalSystemPrompt },
      ...currentContext,
    ];
    messages.push({ role: 'user', content: userMessage });

    (this.agentMonitor || agentMonitor).recordExecutionStart(agentId, userMessage, { sessionId, userId });

    let finalizedResponse = null;
    let _textFallbackUsed = false;

    for (let pass = 1; pass <= 2; pass++) {
      const chatOptions = {};
      if (pass === 1 && tools?.length) { chatOptions.tools = tools; chatOptions.tool_choice = 'auto'; }

      broadcast({ type: OrchestratorEvents.THINKING, iteration: pass });
      let content = '';
      let toolCalls = null;

      try {
        const stream = provider.chatStream(session.model, messages, chatOptions);
        for await (const chunk of stream) {
          if (chunk.type === 'content') {
            content += chunk.content;
            broadcast({ type: OrchestratorEvents.CONTENT, content: chunk.content, iteration: pass });
          } else if (chunk.type === 'thinking') {
            broadcast({ type: OrchestratorEvents.THINKING, content: chunk.content, iteration: pass });
          } else if (chunk.type === 'tool_calls') {
            toolCalls = chunk.toolCalls;
          }
        }
      } catch (e) {
        const p = runPipeline(await provider.chat(session.model, messages, chatOptions));
        content = p.content;
        toolCalls = p.toolCalls;
      }

      if (pass === 1 && chatOptions.tools && !toolCalls?.length && (!content || content.trim().length < 3)) {
        const p = runPipeline(await provider.chat(session.model, messages, chatOptions));
        content = p.content;
        toolCalls = p.toolCalls;
      }

      let lastToolResult = null;
      if (pass === 1 && toolCalls?.length) {
        for (const tc of toolCalls) {
          let toolName = tc.name;
          let args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments;
          broadcast({ type: OrchestratorEvents.TOOL_CALL, tool: toolName, args, iteration: pass });
          if (tc.id?.startsWith('textfb_')) _textFallbackUsed = true;
          try {
            const toolResult = await _exec(toolName, args, { sessionId, userId });
            lastToolResult = toolResult;
            (this.agentMonitor || agentMonitor).recordToolCall(agentId, toolName, args, toolResult);
            broadcast({ type: OrchestratorEvents.TOOL_RESULT, tool: toolName, result: toolResult, iteration: pass });
            await mm.addMessage(sessionId, 'system', `[Tool Result] ${toolName}: ${JSON.stringify(toolResult).slice(0, 2000)}`);
          } catch (error) {
            const knownNames = _knownNames();
            if (!knownNames.has(toolName)) {
              const cmd = mapActionToCommand(toolName, args);
              try {
                const mappedResult = await _exec('exec_command', { command: cmd }, { sessionId, userId });
                lastToolResult = mappedResult;
                toolName = 'exec_command';
                args = { command: cmd };
                _textFallbackUsed = true;
                (this.agentMonitor || agentMonitor).recordToolCall(agentId, toolName, args, mappedResult);
                broadcast({ type: OrchestratorEvents.TOOL_RESULT, tool: toolName, result: mappedResult, iteration: pass });
                await mm.addMessage(sessionId, 'system', `[Tool Result] ${toolName}: ${JSON.stringify(mappedResult).slice(0, 2000)}`);
              } catch (mappedError) {
                (this.agentMonitor || agentMonitor).recordToolCall(agentId, toolName, args, { error: mappedError.message });
                broadcast({ type: OrchestratorEvents.ERROR, tool: toolName, error: mappedError.message, iteration: pass });
                await mm.addMessage(sessionId, 'system', `[Tool Error] ${toolName}: ${mappedError.message}`);
              }
            } else {
              (this.agentMonitor || agentMonitor).recordToolCall(agentId, toolName, args, { error: error.message });
              broadcast({ type: OrchestratorEvents.ERROR, tool: toolName, error: error.message, iteration: pass });
              await mm.addMessage(sessionId, 'system', `[Tool Error] ${toolName}: ${error.message}`);
            }
          }
        }
        if (_textFallbackUsed) {
          if (lastToolResult) {
            finalizedResponse = (lastToolResult.stdout || '').trim() || JSON.stringify(lastToolResult).slice(0, 3000);
          }
          break;
        }
        const context = await mm.getContext(sessionId);
        messages = [
          { role: 'system', content: 'You called a tool and got results above. Answer the user based on those results. Do not call tools again.' },
          { role: 'user', content: userMessage },
          ...context.slice(-4),
        ];
      } else {
        finalizedResponse = content || '';
        break;
      }
    }

    if (!finalizedResponse) finalizedResponse = 'I could not complete the task.';
    responseCache.set(userMessage, session.model, finalizedResponse);

    broadcast({ type: OrchestratorEvents.COMPLETE, response: finalizedResponse, iterations: 1, actions: 0 });
    (this.agentMonitor || agentMonitor).recordExecutionComplete(agentId, { success: true, response: finalizedResponse, iterations: 1 });
    await mm.addMessage(sessionId, 'assistant', finalizedResponse);
    return finalizedResponse;
  }

  async process(sessionId, userId, userMessage) {
    let result = '';
    await this.processStream(sessionId, userId, userMessage, (event) => {
      if (event.type === OrchestratorEvents.COMPLETE && event.response) {
        result = event.response;
      }
    });
    return result;
  }

  async executeGoal(sessionId, userId, goalDescription, onEvent = () => {}) {
    const broadcast = (e) => { onEvent(e); sessionEvents.publish(sessionId, e); };
    const gm = this.goalManager;

    const activeGoal = gm.getActiveGoal(sessionId);
    if (activeGoal) {
      broadcast({ type: 'goal_resume', goalId: activeGoal.id, description: activeGoal.description });
    }

    const goal = activeGoal || gm.createGoal(sessionId, userId, goalDescription);
    if (!activeGoal) {
      broadcast({ type: 'goal_created', goalId: goal.id, description: goalDescription });
    }

    if (goal.steps.length === 0) {
      broadcast({ type: 'goal_decompose', goalId: goal.id });
      try {
        await gm.decomposeGoal(goal.id);
        broadcast({ type: 'goal_decomposed', goalId: goal.id, steps: goal.steps.map(s => ({ id: s.id, action: s.action })) });
      } catch (e) {
        broadcast({ type: 'goal_error', goalId: goal.id, error: e.message });
        return `Goal decomposition failed: ${e.message}`;
      }
    }

    const sm = this.sessionManager || sessionManager;
    const session = sm.getSession(sessionId);
    const provider = sm.getProvider(session.providerType);
    const results = [];

    for (let i = 0; i < goal.steps.length; i++) {
      const step = goal.steps[i];
      if (step.status === 'done') { results.push(step.result); continue; }

      const stepResult = await gm.executeNextStep(goal.id, async (s) => {
        const stepPrompt = `You are executing step ${s.id} of a goal.\n\nGoal: ${goal.description}\nStep: ${s.action}\nExpected: ${s.expected}\n\nExecute this step now.`;
        const resp = await provider.chat(session.model, [
          { role: 'system', content: 'You execute a single step of a plan concisely.' },
          { role: 'user', content: stepPrompt },
        ]);
        broadcast({ type: OrchestratorEvents.CONTENT, content: resp.content || '', stepId: s.id });
        return resp.content || '';
      }, broadcast);

      if (stepResult) results.push(stepResult.result || stepResult.error);
    }

    const finalStatus = gm.getStatus(goal.id);
    const summary = finalStatus.failed > 0
      ? `Goal "${goal.description}" completed with ${finalStatus.done}/${finalStatus.total} steps done, ${finalStatus.failed} failed.`
      : `Goal "${goal.description}" completed: ${finalStatus.done} steps done.`;

    broadcast({ type: 'goal_complete', goalId: goal.id, summary, status: finalStatus });
    return results.join('\n') || summary;
  }

  async _checkAndCorrectResponse(response, sessionId, userId, onEvent) {
    try {
      const check = await this.qualityChecker.check(response);
      onEvent({ type: 'quality_check', score: check.score, passed: check.passed, issues: check.issues });
      logger.info(`[QC] 质量检查: ${check.score}/100, 通过: ${check.passed}`);
      if (check.passed) return response;

      logger.info(`[QC] 检测到质量问题: ${check.issues.join('; ')}`);
      const feedback = this.corrector.generateFeedback(check.issues);

      const sm = this.sessionManager || sessionManager;
      const session = sm.getSession(sessionId);
      const provider = sm.getProvider(session.providerType);

      const messages = [
        { role: 'system', content: `${await PromptBuilder.buildSystemPrompt(1)}\n\n${getEditProtocolGuidance()}` },
        { role: 'user', content: feedback },
      ];

      const correctedResponse = await provider.chat(session.model, messages);
      const newContent = correctedResponse.content;
      onEvent({ type: 'correction_attempt', originalScore: check.score, issues: check.issues });

      const newCheck = await this.qualityChecker.check(newContent);
      logger.info(`[QC] 纠偏后: ${newCheck.score}/100, 通过: ${newCheck.passed}`);
      if (newCheck.passed) { onEvent({ type: 'correction_success', newScore: newCheck.score }); return newContent; }

      logger.info('[QC] 纠偏未达标，返回最佳版本');
      return newContent;
    } catch (error) {
      logger.error('[QC] 质量检查异常:', error.message);
      return response;
    }
  }
}

export const orchestrator = new Orchestrator();
