import { McpServer } from './lib/mcp-server.mjs';

export async function test() {
  const errors = [];

  const server = new McpServer();

  // 拦截 _send 来获取响应, 不写 stdout
  const responses = [];
  server._send = (msg) => { responses.push(msg); };

  // 1. initialize handshake
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } } }));
  if (responses.length !== 1) errors.push('MCP: initialize missing response');
  else if (responses[0].result?.protocolVersion !== '2024-11-05') errors.push('MCP: initialize bad protocol version');
  else if (!responses[0].result?.capabilities?.tools) errors.push('MCP: initialize missing tools capability');
  else if (responses[0].result?.serverInfo?.name !== 'openchat-mcp') errors.push('MCP: initialize bad server name');

  // 2. tools/list
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  if (responses.length !== 1) errors.push('MCP: tools/list missing response');
  else if (!Array.isArray(responses[0].result?.tools)) errors.push('MCP: tools/list missing tools array');
  else if (responses[0].result.tools.length < 30) errors.push(`MCP: tools/list too few tools (${responses[0].result.tools.length})`);
  else {
    const names = responses[0].result.tools.map(t => t.name);
    if (!names.includes('read_file')) errors.push('MCP: tools/list missing read_file');
    if (!names.includes('grep')) errors.push('MCP: tools/list missing grep');
    if (!names.includes('write_file')) errors.push('MCP: tools/list missing write_file');
    if (names.some(t => !t)) errors.push('MCP: tools/list has empty name');
    if (names.length !== new Set(names).size) errors.push('MCP: tools/list has duplicate names');
  }

  // 3. tools/call read_file on a known file (relative to cwd)
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'src/experiments/39.mjs' } } }));
  if (responses.length !== 1) errors.push('MCP: tools/call missing response');
  else if (!responses[0].result?.content?.[0]?.text) errors.push('MCP: tools/call missing content');
  else if (!responses[0].result.content[0].text.includes('McpServer')) errors.push('MCP: tools/call wrong content');

  // 4. tools/call with missing name
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: {} }));
  if (responses.length !== 1) errors.push('MCP: tools/call missing-name missing response');
  else if (!responses[0].error) errors.push('MCP: tools/call missing-name should error');

  // 5. unknown method
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'bogus/method' }));
  if (responses.length !== 1) errors.push('MCP: unknown method missing response');
  else if (!responses[0].error) errors.push('MCP: unknown method should error');

  // 6. parse error (invalid JSON)
  responses.length = 0;
  await server.handle('not json');
  if (responses.length !== 1) errors.push('MCP: parse error missing response');
  else if (responses[0].error?.code !== -32700) errors.push('MCP: parse error wrong code');

  // 7. tools/call missing args — read_file without path throws, should become error
  responses.length = 0;
  await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read_file' } }));
  if (responses.length !== 1) errors.push('MCP: tools/call missing args missing response');

  server.close();

  return { ok: errors.length === 0, errors };
}
