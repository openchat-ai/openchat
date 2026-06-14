import { TOOLS, executeTool } from './coding-tools.mjs';

const TOOL_LIST = TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description || '',
  inputSchema: t.function.parameters || { type: 'object', properties: {} },
}));

export class McpServer {
  constructor() {
    this._closed = false;
    this._reqId = 0;
  }

  async handle(line) {
    if (this._closed) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return this._send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (!msg || typeof msg !== 'object') return;
    const { id, method, params } = msg;

    try {
      switch (method) {
        case 'initialize':
          return this._send({ id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'openchat-mcp', version: '0.1.0' } } });
        case 'tools/list':
          return this._send({ id, result: { tools: TOOL_LIST } });
        case 'tools/call': {
          if (!params?.name) return this._send({ id, error: { code: -32602, message: 'Missing tool name' } });
          const args = params.arguments || {};
          try {
            const raw = await executeTool(params.name, args);
            const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            return this._send({ id, result: { content: [{ type: 'text', text: content }] } });
          } catch (e) {
            return this._send({ id, error: { code: -32603, message: e.message?.slice(0, 200) || 'Tool execution failed' } });
          }
        }
        case 'resources/list':
          return this._send({ id, result: { resources: [] } });
        case 'resources/read':
          return this._send({ id, error: { code: -32601, message: 'Not implemented' } });
        case 'notifications/initialized':
          return;
        default:
          return this._send({ id, error: { code: -32601, message: `Unknown method: ${method}` } });
      }
    } catch (e) {
      return this._send({ id, error: { code: -32603, message: e.message?.slice(0, 200) || 'Internal error' } });
    }
  }

  _send(msg) {
    if (this._closed) return;
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  close() { this._closed = true; }
}

export function startStdioServer() {
  const server = new McpServer();
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) server.handle(trimmed);
    }
  });
  process.stdin.on('end', () => server.close());
  return server;
}

export const META = { id: 'mcp-server' };
