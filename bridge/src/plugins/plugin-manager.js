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
    console.log(`[PluginManager] Registering plugin: ${plugin.name}`);
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
    console.log(`[PluginManager] Tool registered: ${tool.name}`);
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
      console.warn(`[PluginManager] Invalid args for ${name}: ${validation.error}`);
      return {
        success: false,
        error: validation.error,
        suggestion: validation.suggestion,
        tool: name,
        providedArgs: args
      };
    }

    const normalizedArgs = validation.normalizedArgs || args;

    console.log(`[PluginManager] Executing tool ${name} with args:`, normalizedArgs);
    
    try {
      const result = await tool.execute(normalizedArgs, context);
      return result;
    } catch (error) {
      // Don't crash on tool errors - return structured error instead
      console.error(`[PluginManager] Tool ${name} error:`, error.message);
      return {
        success: false,
        error: error.message,
        tool: name,
        providedArgs: normalizedArgs,
        stack: error.stack
      };
    }
  }
}

export const pluginManager = new PluginManager();
