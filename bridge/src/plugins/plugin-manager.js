import logger from '../core/logger.js';
/**
 * PluginManager manages the lifecycle of skills and tools.
 * It allows the AI Agent to discover and execute capabilities.
 */
export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.skills = new Map();
  }

  /**
   * Register a plugin (a group of related tools)
   */
  async registerPlugin(plugin) {
    this.plugins.set(plugin.id, plugin);

    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this.registerTool(tool);
      }
    }
  }

  /**
   * Register a specific tool/skill
   */
  registerTool(tool) {
    // Level 0: Name, Level 1: Summary, Level 2: Full Definition
    this.skills.set(tool.name, {
      ...tool,
      level: 2,
      registeredAt: Date.now(),
      paramSchema: tool.params || {}
    });
  }

  /**
   * Get tools based on required disclosure level (Hermes Agent pattern)
   * @param {number} level 0: Name only, 1: Summary, 2: Full
   */
  getTools(level = 0) {
    const tools = Array.from(this.skills.values());
    return tools.map(tool => {
      if (level === 0) return { name: tool.name };
      if (level === 1) return { name: tool.name, description: tool.description };
      return tool;
    });
  }

  /**
   * Validate tool arguments against schema
   */
  validateArgs(toolName, args) {
    const tool = this.skills.get(toolName);
    if (!tool) {
      return { valid: false, error: `Tool ${toolName} not found` };
    }

    const schema = tool.paramSchema;
    if (!schema || Object.keys(schema).length === 0) {
      return { valid: true }; // No schema, accept any args
    }

    // Guard against null/undefined args
    if (args == null) {
      const missing = Object.entries(schema)
        .filter(([, def]) => def.required)
        .map(([name]) => name);
      if (missing.length > 0) {
        return { valid: false, error: `Missing required parameters: ${missing.join(', ')}` };
      }
      return { valid: true };
    }

    // Check for required parameters
    for (const [paramName, paramDef] of Object.entries(schema)) {
      if (paramDef.required && !(paramName in args)) {
        return { 
          valid: false, 
          error: `Missing required parameter: ${paramName}`,
          suggestion: `Provide ${paramName} parameter`
        };
      }
    }

    // Normalize common parameter aliases
    const normalizedArgs = { ...args };
    
    // Shell command aliases
    if (toolName === 'run_command' || toolName === 'shell_exec') {
      if (!normalizedArgs.command && normalizedArgs.cmd) {
        normalizedArgs.command = normalizedArgs.cmd;
      }
      if (!normalizedArgs.command && normalizedArgs.shell) {
        normalizedArgs.command = normalizedArgs.shell;
      }
      if (!normalizedArgs.command && normalizedArgs.message) {
        // Some LLMs mistakenly use 'message' for shell commands
        normalizedArgs.command = normalizedArgs.message;
      }
    }

    // Git commit aliases
    if (toolName === 'git_commit') {
      if (!normalizedArgs.message && normalizedArgs.msg) {
        normalizedArgs.message = normalizedArgs.msg;
      }
      if (!normalizedArgs.message && normalizedArgs.commitMessage) {
        normalizedArgs.message = normalizedArgs.commitMessage;
      }
    }

    return { valid: true, normalizedArgs };
  }

  /**
   * Execute a tool by name with parameter validation
   */
  async executeTool(name, args, context) {
    const tool = this.skills.get(name);
    if (!tool) {
      throw new Error(`Tool ${name} not found. Available tools: ${Array.from(this.skills.keys()).join(', ')}`);
    }

    // Validate and normalize arguments
    const validation = this.validateArgs(name, args);
    if (!validation.valid) {
      logger.warn(`[PluginManager] Invalid args for ${name}: ${validation.error}`);
      return {
        success: false,
        error: validation.error,
        suggestion: validation.suggestion,
        tool: name,
        providedArgs: args
      };
    }

    const normalizedArgs = validation.normalizedArgs || args;

    logger.info(`[PluginManager] Executing tool ${name} with args:`, normalizedArgs);

    try {
      const result = await tool.execute(normalizedArgs, context);
      return result;
    } catch (error) {
      // Don't crash on tool errors - return structured error instead
      logger.error(`[PluginManager] Tool ${name} error:`, error.message);
      return {
        success: false,
        error: error.message,
        tool: name,
        providedArgs: normalizedArgs,
        stack: error.stack
      };
    }
  }

  /**
   * Convert tools to OpenAI Function Calling format
   * 用于支持原生 Function Calling 的模型
   */
  getToolsForFunctionCalling(toolNames = null) {
    const tools = toolNames
      ? toolNames.map(name => this.skills.get(name)).filter(Boolean)
      : Array.from(this.skills.values());

    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || `Execute ${tool.name}`,
        parameters: this.convertParamsToSchema(tool.paramSchema || {})
      }
    }));
  }

  /**
   * Convert internal params format to JSON Schema
   */
  convertParamsToSchema(params) {
    const properties = {};
    const required = [];

    for (const [name, def] of Object.entries(params)) {
      properties[name] = {
        type: def.type || 'string',
        description: def.description || ''
      };

      if (def.required !== false) {
        required.push(name);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    };
  }

  /**
   * 格式化工具执行结果，优化返回给模型的格式
   * @param {string} toolName 工具名称
   * @param {object} result 原始执行结果
   * @returns {string} 格式化后的结果字符串
   */
  formatToolResult(toolName, result) {
    // 根据工具类型选择格式化策略
    switch (toolName) {
      case 'run_command':
        return this.formatCommandResult(result);

      case 'read_file':
        return this.formatFileReadResult(result);

      case 'write_file':
        return this.formatFileWriteResult(result);

      case 'git_status':
        return this.formatGitStatusResult(result);

      case 'git_diff':
        return this.formatGitDiffResult(result);

      default:
        return this.formatGenericResult(toolName, result);
    }
  }

  /**
   * 格式化命令执行结果
   */
  formatCommandResult(result) {
    if (result.success) {
      const output = result.output || '(no output)';
      const truncated = output.length > 2000
        ? output.substring(0, 2000) + '\n... (output truncated)'
        : output;
      return `[Command executed successfully]\n\`\`\`\n${truncated}\n\`\`\``;
    } else {
      return `[Command failed] Exit code: ${result.exitCode}\n\`\`\`\n${result.output}\n\`\`\``;
    }
  }

  /**
   * 格式化文件读取结果
   */
  formatFileReadResult(result) {
    if (result.success) {
      const content = result.content || '';
      const lines = content.split('\n').length;
      const truncated = content.length > 5000
        ? content.substring(0, 5000) + '\n... (file truncated)'
        : content;
      return `[File content] ${lines} lines\n\`\`\`\n${truncated}\n\`\`\``;
    } else {
      return `[Error] Failed to read file: ${result.error}`;
    }
  }

  /**
   * 格式化文件写入结果
   */
  formatFileWriteResult(result) {
    if (result.success) {
      return `[Success] File written successfully`;
    } else {
      return `[Error] Failed to write file: ${result.error}`;
    }
  }

  /**
   * 格式化 Git 状态结果
   */
  formatGitStatusResult(result) {
    if (result.success) {
      return `[Git Status]\n\`\`\`\n${result.output}\n\`\`\``;
    } else {
      return `[Error] Git status failed: ${result.error}`;
    }
  }

  /**
   * 格式化 Git Diff 结果
   */
  formatGitDiffResult(result) {
    if (result.success) {
      const diff = result.output || '(no changes)';
      return `[Git Diff]\n\`\`\`diff\n${diff}\n\`\`\``;
    } else {
      return `[Error] Git diff failed: ${result.error}`;
    }
  }

  /**
   * 通用结果格式化
   */
  formatGenericResult(toolName, result) {
    if (result.success === false) {
      return `[${toolName} failed] ${result.error || 'Unknown error'}`;
    }

    // 尝试智能格式化
    if (typeof result === 'string') {
      return result.length > 2000
        ? result.substring(0, 2000) + '\n... (truncated)'
        : result;
    }

    if (typeof result === 'object') {
      const json = JSON.stringify(result, null, 2);
      return json.length > 2000
        ? json.substring(0, 2000) + '\n... (truncated)'
        : `[${toolName} result]\n\`\`\`json\n${json}\n\`\`\``;
    }

    return `[${toolName} result] ${String(result)}`;
  }
}

export const pluginManager = new PluginManager();
