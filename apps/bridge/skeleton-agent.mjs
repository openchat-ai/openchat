// Agent wrapper: calls agentEngine.processStream and captures TOOL_CALL events
import { agentEngine } from '../../bridge/src/core/agent/agent-engine.js';

async function processText(text) {
  const sessionId = `skeleton-${Date.now()}`;
  let response = '';
  let toolCalls = [];

  await agentEngine.processStream(sessionId, 'skeleton-user', text, (event) => {
    switch (event.type) {
      case 'content':
        response += event.content;
        break;
      case 'tool_call':
        toolCalls.push({ tool: event.tool, args: event.args });
        console.log(`[C13d] TOOL_CALL=${event.tool}(${JSON.stringify(event.args)})`);
        break;
      case 'complete':
        response = event.response || response;
        console.log(`[C13d] iterations=${event.iterations}`);
        break;
      case 'error':
        console.error(`[C13d] error=${event.error || event.message}`);
        break;
    }
  });

  return { response, toolCalls };
}

export { processText };
