export class PromptBuilder {
  static buildSystemPrompt(level = 1) {
    const { pluginManager } = global.pluginManager || {};
    const tools = pluginManager?.getTools(level) || [];

    const toolDescription = tools.map(t => {
      if (level === 0) return `- ${t.name}`;
      if (level === 1) return `- ${t.name}: ${t.description}`;
      return `- ${t.name}: ${t.description}\n  Params: ${JSON.stringify(t.params)}`;
    }).join('\n');

    return `You are a helpful assistant with access to tools.

RULES:
- Before acting, briefly reason: what is the user really asking, and what is the simplest correct path?
- You may call tools IF NEEDED. You can call MULTIPLE tools in one response.
- You have ONE opportunity to call tools. Plan ahead.
- If you do not need tools, answer directly.
- Prefer simple and correct over clever. Verify assumptions before committing.

Available tools:
${toolDescription}`;
  }
}
