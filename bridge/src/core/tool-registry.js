import { vectorMemory } from './vector-memory.js';
import logger from './logger.js';

class Tool {
  constructor(name, description, execute) {
    this.name = name;
    this.description = description;
    this.execute = execute;
  }
}

class ToolRegistry {
  constructor() {
    this._tools = new Map();
    this._registerDefaults();
  }

  _registerDefaults() {
    this.register(new Tool(
      'read_memory',
      'Search the resident\'s memory/knowledge base for relevant past experiences. Input: a search query string. Output: matching memories.',
      async ({ query, scope }) => {
        if (!query) return { error: 'query is required' };
        const results = vectorMemory.search(query, { scope, limit: 5 });
        return { memories: results.map(r => ({ content: r.value, score: r.score, source: r.source })) };
      },
    ));

    this.register(new Tool(
      'web_fetch',
      'Fetch content from a URL. Input: a URL string. Output: the text content of the page.',
      async ({ url }) => {
        if (!url) return { error: 'url is required' };
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
          const text = await resp.text();
          return { content: text.slice(0, 5000) };
        } catch (e) {
          return { error: `fetch failed: ${e.message}` };
        }
      },
    ));

    this.register(new Tool(
      'calculate',
      'Evaluate a mathematical expression. Input: a math expression string (e.g. "2 + 3 * 4"). Output: the numeric result.',
      async ({ expression }) => {
        if (!expression) return { error: 'expression is required' };
        try {
          const result = Function(`"use strict"; return (${expression})`)();
          return { result };
        } catch (e) {
          return { error: `invalid expression: ${e.message}` };
        }
      },
    ));

    this.register(new Tool(
      'finish',
      'Final answer. Call this when you have enough information to answer the user question. Input: your final answer text.',
      async ({ answer }) => {
        return { finished: true, answer: answer || '' };
      },
    ));
  }

  register(tool) {
    this._tools.set(tool.name, tool);
  }

  get(name) {
    return this._tools.get(name);
  }

  list() {
    return Array.from(this._tools.values()).map(t => ({
      name: t.name,
      description: t.description,
    }));
  }

  async call(name, args) {
    const tool = this._tools.get(name);
    if (!tool) return { error: `unknown tool: ${name}` };
    try {
      const result = await tool.execute(args);
      return result;
    } catch (e) {
      logger.error(`[Tool] ${name} failed:`, e);
      return { error: `tool execution failed: ${e.message}` };
    }
  }

  getSystemPrompt() {
    const tools = this.list();
    const lines = tools.map(t => `- ${t.name}: ${t.description}`);
    return [
      'You have access to the following tools:',
      '',
      ...lines,
      '',
      'When you need to use a tool, respond with EXACTLY this JSON format on a single line:',
      '  TOOL_CALL: {"tool":"tool_name","args":{...}}',
      '',
      'When you have the final answer, use the finish tool:',
      '  TOOL_CALL: {"tool":"finish","args":{"answer":"your final answer here"}}',
      '',
      'Think step by step. You can use multiple tools sequentially.',
    ].join('\n');
  }
}

export const toolRegistry = new ToolRegistry();
export default ToolRegistry;
