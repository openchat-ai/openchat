import { pluginManager } from '../plugin-manager.js';

export class PromptBuilder {
  /**
   * 构造系统提示词：列出可用工具 + 简单格式说明 + 项目 DNA 摘要
   */
  static async buildSystemPrompt(level = 1, { useJSON = false } = {}) {
    const tools = pluginManager?.getTools(level) || [];
    const toolList = tools.length > 0
      ? tools.map(t => `- ${t.name}: ${t.description || ''}`).join('\n')
      : '（无）';

    const toolHint = useJSON
      ? `\n如需调用工具，输出：\n{"tool":"tool_name","args":{"param":"value"}}\n直接回答则输出：\n{"answer":"your response"}\n只输出 JSON，无其他说明。`
      : `\n需要调工具时，输出以下任一格式（解析器都能识别）：\n- ACTION: tool_name {"param":"value"}\n- <tool_call>tool_name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>\n- {"tool":"name","args":{...}}\n\n不需要调工具时，直接自然回答。`;

    let dnaCtx = '';
    try {
      const { getDNAContext } = await import('../../experiments/42.mjs');
      dnaCtx = await getDNAContext();
    } catch (e) { console.debug(`[getDNAContext] failed: ${e?.message}`); }

    const base = `You are a helpful assistant.

可用工具：
${toolList}${toolHint}`;

    return dnaCtx ? `${base}\n\n${dnaCtx}` : base;
  }
}
