import * as readline from 'readline';
import { sessionManager } from './session/session-manager.js';
import { executeCommand, commands } from './cli/commands.js';
import { MessageBuilder, MessageType } from './protocol/message.js';
import { WebSocketServer } from 'ws';
import { router } from './core/router.js';
import { initCore } from './core/handlers.js';
import { CLIGateway } from './gateway/base.js';

const CONFIG = {
  port: process.env.PORT || 3003,
  enableWebSocket: process.env.ENABLE_WS === 'true'
};

const COMMANDS = [
  'help', 'status', 'clear', 'exit', 'quit',
  'provider add', 'provider remove', 'provider list',
  'session create', 'session close', 'session list', 'session history',
  'chat'
];

class Bridge {
  constructor() {
    this.clientId = process.env.CLIENT_ID || crypto.randomUUID();
    this.wss = null;
    this.clients = new Set();
    this.rl = null;
  }

  async start(detectedTools = []) {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                                                           ║');
    console.log('║              OpenChat Bridge - 自然语言模式              ║');
    console.log('║                                                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    await this.autoConfigProviders(detectedTools);
    
    initCore();

    if (CONFIG.enableWebSocket) {
      this.startWebSocket();
    }

    console.log('');
    this.startCLI();

    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async autoConfigProviders(detectedTools) {
    for (const tool of detectedTools) {
      try {
        const { createLocalProvider } = await import('./providers/local-provider.js');
        const provider = createLocalProvider(tool.name, {
          mode: 'command',
          command: tool.command,
          args: []
        });
        await provider.connect({ mode: 'command', command: tool.command, args: [] });
        sessionManager.addProviderDirect(provider);
        console.log(`✓ Auto-configured: ${tool.name}`);
      } catch (e) {
        console.log(`✗ Failed to auto-configure ${tool.name}: ${e.message}`);
      }
    }
  }

  startWebSocket() {
    this.wss = new WebSocketServer({ port: CONFIG.port });

    this.wss.on('connection', (ws) => {
      console.log('[WS] Client connected');
      this.clients.add(ws);

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleWSMessage(ws, msg);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', data: { message: e.message } }));
        }
      });

      ws.on('close', () => {
        console.log('[WS] Client disconnected');
        this.clients.delete(ws);
      });

      ws.send(JSON.stringify({
        type: MessageType.BRIDGE_HANDSHAKE,
        data: {
          clientId: this.clientId,
          version: 1
        }
      }));
    });

    console.log(`[WS] Server listening on port ${CONFIG.port}`);
  }

  async handleWSMessage(ws, msg) {
    const { type, data, sessionId } = msg;
    
    // Instead of a generic 'websocket' ID, we create a unique Gateway instance per connection
    // to allow the Router to send responses back to the correct socket.
    const gatewayId = `ws-${sessionId || crypto.randomUUID()}`;
    const wsGateway = new WSGateway(gatewayId, router, ws);
    router.registerGateway(gatewayId, wsGateway);

    try {
      const result = await router.dispatch(gatewayId, { type, data, sessionId });
      // Note: router.dispatch internally calls gateway.send(), 
      // so we don't need an explicit ws.send here unless we want to bypass the gateway.
    } catch (e) {
      ws.send(JSON.stringify({ type: MessageType.ERROR, data: { message: e.message }, sessionId }));
    }
  }

  getCompletions(line) {
    const trimmed = line.trim();
    if (!trimmed) return [];

    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    const matches = [];

    if (parts.length === 1) {
      if ('session'.startsWith(last)) matches.push('session');
      if ('provider'.startsWith(last)) matches.push('provider');
      if ('help'.startsWith(last)) matches.push('help');
      if ('status'.startsWith(last)) matches.push('status');
      if ('clear'.startsWith(last)) matches.push('clear');
      if ('exit'.startsWith(last)) matches.push('exit');
      if ('quit'.startsWith(last)) matches.push('quit');
      if ('chat'.startsWith(last)) matches.push('chat');
      return matches;
    }

    if (parts.length === 2 && parts[0] === 'session') {
      if ('create'.startsWith(last)) matches.push('create');
      if ('close'.startsWith(last)) matches.push('close');
      if ('list'.startsWith(last)) matches.push('list');
      if ('history'.startsWith(last)) matches.push('history');
      return matches;
    }

    if (parts.length === 2 && parts[0] === 'provider') {
      if ('add'.startsWith(last)) matches.push('add');
      if ('remove'.startsWith(last)) matches.push('remove');
      if ('list'.startsWith(last)) matches.push('list');
      return matches;
    }

    if (parts.length === 3 && parts[0] === 'session' && parts[1] === 'create') {
      if ('claude'.startsWith(last)) matches.push('claude');
      if ('opencode'.startsWith(last)) matches.push('opencode');
      return matches;
    }

    return matches;
  }

  backspace() {
    if (this.currentLine.length > 0) {
      this.currentLine = this.currentLine.slice(0, -1);
      this.cursorPos = this.currentLine.length;
      process.stdout.write('\r\x1b[K> ' + this.currentLine);
    }
  }

  clearLine() {
    process.stdout.write('\r\x1b[K> ');
    this.currentLine = '';
    this.cursorPos = 0;
  }

  startCLI() {
    this.currentLine = '';
    this.cursorPos = 0;
    this.history = [];
    this.historyIndex = -1;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdout.write('Type "help" for available commands\r\n\r\n');
    process.stdout.write('> ');

    process.stdin.on('data', (chunk) => {
      const str = chunk.toString();
      const code = str.charCodeAt(0);

      if (code === 13) {
        process.stdout.write('\r\n');
        const cmd = this.currentLine.trim();
        if (cmd) {
          this.history.unshift(cmd);
          if (this.history.length > 100) this.history.pop();
          this.historyIndex = -1;
          executeCommand(cmd);
        }
        this.currentLine = '';
        this.cursorPos = 0;
        process.stdout.write('> ');
      } else if (code === 3) {
        process.stdout.write('^C\r\n');
        this.clearLine();
      } else if (code === 127 || code === 8) {  // 127=Unix Backspace, 8=Windows Backspace
        this.backspace();
      } else if (code >= 32) {
        this.currentLine += str;
        this.cursorPos = this.currentLine.length;
        process.stdout.write(str);
      }
    });

    process.on('SIGINT', () => {
      this.clearLine();
    });
  }

  async shutdown() {
    console.log('\nShutting down...');

    const sessions = sessionManager.listSessions();
    for (const session of sessions) {
      sessionManager.closeSession(session.id);
    }

    for (const [type] of sessionManager.providers) {
      await sessionManager.removeProvider(type);
    }

    if (this.wss) {
      this.wss.close();
    }

    console.log('Goodbye!');
    process.exit(0);
  }
}

export async function startBridge(detectedTools = []) {
  const bridge = new Bridge();
  await bridge.start(detectedTools);
}