/**
 * PromptBuilder constructs the system prompt for the Agent,
 * implementing the "Progressive Disclosure" of tools.
 */
export class PromptBuilder {
  /**
   * @param {number} level 0: Names, 1: Summaries, 2: Full Specs
   */
  static buildSystemPrompt(level = 1) {
    const { pluginManager } = global.pluginManager || {};
    const tools = pluginManager?.getTools(level) || [];
    
    const toolDescription = tools.map(t => {
      if (level === 0) return `- ${t.name}`;
      if (level === 1) return `- ${t.name}: ${t.description}`;
      return `- ${t.name}: ${t.description}\n  Params: ${JSON.stringify(t.params)}`;
    }).join('\n');

    return `You are an Autonomous AI Resident of OpenChat.
You have a Think-Act-Verify-Refine loop:
1. THINK: Analyze the user request and project state.
2. ACT: Call a tool to execute an action.
3. VERIFY: Check if the result is correct.
4. REFINE: If quality is poor, improve and retry.
5. FINAL: Deliver the final result.

IMPORTANT: After completing a task, you should consider whether the work meets quality standards.
If you have access to quality verification tools (like run_llm_judge), use them to check your work.
If the quality score is below 4, you should refine your work.

AVAILABLE TOOLS:
${toolDescription}

RESPONSE FORMAT:
To act, use: ACTION: tool_name { "arg": "val" }
To respond, use: FINAL: Your final answer to the user.
`;
  }
}
