import { MessageBuilder, MessageType } from '../protocol/message.js';
import { sessionManager } from '../session/session-manager.js';
import { processInput } from '../core/natural-language-parser.js';
import { persistentConfig } from '../memory/persistent-config.js';
import { multiAgentCoordinator } from '../core/multi-agent-coordinator.js';
import { providerManager, PRESET_PROVIDERS } from '../memory/provider-manager.js';

export const commands = {
  help() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                OpenChat Bridge - CLI                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  status              Show current status');
    console.log('  help                Show this help');
    console.log('  clear               Clear screen');
    console.log('  exit                Exit program');
    console.log('');
    console.log('  providers           List configured providers');
    console.log('  use <provider>      Set provider (siliconflow, deepseek, openai, groq)');
    console.log('  use <provider> <key>  Set provider with API key');
    console.log('  config set <k> <v>  Set config value');
    console.log('');
    console.log('  models [provider]   List available models');
    console.log('  switch <p> <model>  Switch to a different model');
    console.log('');
    console.log('  new [provider]      Create new session');
    console.log('  sessions            List sessions');
    console.log('');
    console.log('  spawn [name]        Spawn new agent');
    console.log('  agents              List agents');
    console.log('  parallel <task>     Run task with parallel agents');
    console.log('  do <task>           Execute a task');
    console.log('');
    console.log('  upgrade             Update provider models from network');
    console.log('');
  },

  async providerAdd(args) {
    if (args.length < 2) {
      console.log('Usage: provider add <type> <api_key> [endpoint]');
      console.log('Types: openai, claude, gemini, deepseek');
      console.log('');
      console.log('Local AI Providers:');
      console.log('  provider add local <name> --cmd "<command>"     Command mode');
      console.log('  provider add local <name> --api <url>           API mode');
      return;
    }

    const [type, ...rest] = args;
    
    if (type === 'local') {
      await this.providerAddLocal(rest);
      return;
    }

    const [apiKey, endpoint] = rest;
    try {
      await sessionManager.addProvider(type, apiKey, endpoint);
      console.log(`✓ Provider ${type} added successfully`);
    } catch (error) {
      console.log(`✗ Failed to add provider: ${error.message}`);
    }
  },

  async providerAddLocal(args) {
    if (args.length < 2) {
      console.log('Usage: provider add local <name> --cmd "<command>" OR --api <url>');
      console.log('');
      console.log('Examples:');
      console.log('  provider add local claude -- claude -p');
      console.log('  provider add local opencode -- opencode');
      console.log('  provider add local myai --api http://localhost:8080');
      return;
    }

    const name = args[0];
    const config = { mode: 'command', command: null, args: [], endpoint: null };

    let i = 1;
    while (i < args.length) {
      if (args[i] === '--' && args[i + 1]) {
        const cmdParts = args[i + 1].split(' ');
        config.command = cmdParts[0];
        config.args = cmdParts.slice(1);
        i += 2;
      } else if (args[i] === '--cmd' && args[i + 1]) {
        const cmdParts = args[i + 1].split(' ');
        config.command = cmdParts[0];
        config.args = cmdParts.slice(1);
        i += 2;
      } else if (args[i] === '--api' && args[i + 1]) {
        config.mode = 'api';
        config.endpoint = args[i + 1];
        i += 2;
      } else {
        i++;
      }
    }

    if (!config.command && !config.endpoint) {
      console.log('✗ Must specify command after -- or --api <url>');
      return;
    }

    try {
      const { createLocalProvider } = await import('../providers/local-provider.js');
      const provider = createLocalProvider(name, config);
      await provider.connect(config);
      sessionManager.providers.set(name, provider);
      console.log(`✓ Local provider "${name}" added successfully`);
      console.log(`  Mode: ${config.mode}`);
      if (config.command) console.log(`  Command: ${config.command} ${config.args.join(' ')}`);
      if (config.endpoint) console.log(`  Endpoint: ${config.endpoint}`);
    } catch (error) {
      console.log(`✗ Failed to add local provider: ${error.message}`);
    }
  },

  async providerRemove(args) {
    if (args.length < 1) {
      console.log('Usage: provider remove <type>');
      return;
    }

    const [type] = args;
    try {
      await sessionManager.removeProvider(type);
    } catch (error) {
      console.log(`✗ Failed to remove provider: ${error.message}`);
    }
  },

  providerList() {
    const providers = sessionManager.listProviders();
    if (providers.length === 0) {
      console.log('No providers configured');
      return;
    }

    console.log('');
    console.log('Configured Providers:');
    console.log('──────────────────────');
    providers.forEach(p => {
      console.log(`  ${p.name.padEnd(12)} [${p.connected ? '✓' : '✗'}] ${p.models.join(', ')}`);
    });
    console.log('');
  },

  async sessionCreate(args) {
    if (args.length < 2) {
      console.log('Usage: session create <provider> <model>');
      return;
    }

    const [provider, model] = args;
    try {
      const session = await sessionManager.createSession(provider, model);
      console.log(`✓ Session created: ${session.id}`);
    } catch (error) {
      console.log(`✗ Failed to create session: ${error.message}`);
    }
  },

  sessionClose(args) {
    if (args.length < 1) {
      console.log('Usage: session close <session_id>');
      return;
    }

    const [sessionId] = args;
    if (sessionManager.closeSession(sessionId)) {
      console.log(`✓ Session closed`);
    } else {
      console.log(`✗ Session not found`);
    }
  },

  sessionList() {
    const sessions = sessionManager.listSessions();
    if (sessions.length === 0) {
      console.log('No active sessions');
      return;
    }

    console.log('');
    console.log('Active Sessions:');
    console.log('──────────────────────');
    sessions.forEach(s => {
      const ago = Math.round((Date.now() - s.lastActivity) / 1000);
      console.log(`  ${s.id.substring(0, 8)}...  ${s.providerType}/${s.model}  (${s.messageCount} msgs, ${ago}s ago)`);
    });
    console.log('');
  },

  sessionHistory(args) {
    if (args.length < 1) {
      console.log('Usage: session history <session_id>');
      return;
    }

    const [sessionId] = args;
    try {
      const history = sessionManager.getSessionHistory(sessionId);
      console.log('');
      console.log(`Session ${sessionId} History:`);
      console.log('──────────────────────');
      history.forEach((m, i) => {
        const role = m.role.padEnd(10);
        const content = m.content.length > 60 ? m.content.substring(0, 57) + '...' : m.content;
        console.log(`  ${role}  ${content}`);
      });
      console.log('');
    } catch (error) {
      console.log(`✗ ${error.message}`);
    }
  },

  async chat(args) {
    if (args.length < 2) {
      console.log('Usage: chat <session_id> <message>');
      console.log('       c <message>  (use last session)');
      return;
    }

    const [sessionIdOrShort, ...msgParts] = args;
    const message = msgParts.join(' ');

    // Find session by full ID or short ID
    let sessionId = sessionIdOrShort;
    if (sessionId.length !== 36) {
      // Try to find by short ID (first 8 chars)
      const sessions = sessionManager.listSessions();
      const found = sessions.find(s => s.id.startsWith(sessionIdOrShort));
      if (found) {
        sessionId = found.id;
      } else {
        console.log(`✗ Session not found: ${sessionIdOrShort}`);
        return;
      }
    }

    process.stdout.write('\nThinking');
    
    let dots = null;
    try {
      dots = setInterval(() => process.stdout.write('.'), 300);
      
      const response = await sessionManager.sendMessage(sessionId, message);
      
      if (dots) clearInterval(dots);
      console.log('\n');
      console.log('──────────────────────────────────────');
      console.log(response.message.content);
      console.log('──────────────────────────────────────');
      console.log(`[Model: ${response.response.model}]`);
      if (response.response.usage) {
        const u = response.response.usage;
        console.log(`[Tokens: ${u.prompt_tokens || u.input_tokens || '?'} in, ${u.completion_tokens || u.output_tokens || '?'} out]`);
      }
      console.log('');
    } catch (error) {
      if (dots) clearInterval(dots);
      console.log(`\n✗ Error: ${error.message}`);
    }
  },

  async c(args) {
    if (args.length < 1) {
      console.log('Usage: c <message>');
      return;
    }

    const message = args.join(' ');
    const sessions = sessionManager.listSessions();
    
    if (sessions.length === 0) {
      console.log('✗ No active sessions. Use "session create" first.');
      return;
    }

    // Use most recent session
    sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    const sessionId = sessions[0].id;

    process.stdout.write('\n[Using session: ' + sessionId.substring(0, 8) + '...]\nThinking');
    
    let dots = null;
    try {
      dots = setInterval(() => process.stdout.write('.'), 300);
      
      const response = await sessionManager.sendMessage(sessionId, message);
      
      if (dots) clearInterval(dots);
      console.log('\n');
      console.log('──────────────────────────────────────');
      console.log(response.message.content);
      console.log('──────────────────────────────────────');
      console.log(`[Model: ${response.response.model}]`);
      if (response.response.usage) {
        const u = response.response.usage;
        console.log(`[Tokens: ${u.prompt_tokens || u.input_tokens || '?'} in, ${u.completion_tokens || u.output_tokens || '?'} out]`);
      }
      console.log('');
    } catch (error) {
      if (dots) clearInterval(dots);
      console.log(`\n✗ Error: ${error.message}`);
    }
  },

  status() {
    const providers = sessionManager.listProviders();
    const sessions = sessionManager.listSessions();

    console.log('');
    console.log('========================================');
    console.log('            Bridge Status');
    console.log('========================================');
    console.log(`  Uptime:    ${Math.round(process.uptime())}s`);
    console.log(`  Providers: ${providers.length} configured, ${providers.filter(p => p.connected).length} connected`);
    console.log(`  Sessions:  ${sessions.length} active`);
    console.log('');
  },

  config(args) {
    if (args.length === 0) {
      console.log('');
      console.log('========================================');
      console.log('            Bridge Config');
      console.log('========================================');
      console.log('  API Keys (encrypted in ~/.openchat/):');
      const providers = persistentConfig.listProviders();
      if (providers.length === 0) {
        console.log('    No API keys stored');
      } else {
        providers.forEach(p => console.log(`    ${p}`));
      }
      console.log('');
      console.log('  Usage:');
      console.log('    config set openai <api_key>     Store API key');
      console.log('    config set deepseek <api_key>    Store API key');
      console.log('    config get <key>                 Get value');
      console.log('    config list                      List stored keys');
      console.log('    config recent                    Show recent sessions');
      console.log('');
      return;
    }

    const subCmd = args[0].toLowerCase();

    if (subCmd === 'list' || subCmd === 'ls') {
      const providers = persistentConfig.listProviders();
      console.log('');
      console.log('Stored API Keys:');
      if (providers.length === 0) {
        console.log('  No API keys stored');
      } else {
        providers.forEach(p => console.log(`  ${p}`));
      }
      console.log('');
      return;
    }

    if (subCmd === 'recent') {
      const sessions = persistentConfig.getRecentSessions(5);
      console.log('');
      console.log('Recent Sessions:');
      if (sessions.length === 0) {
        console.log('  No recent sessions');
      } else {
        sessions.forEach(s => {
          const ago = Math.round((Date.now() - s.timestamp) / 1000);
          console.log(`  ${s.provider}/${s.model} - ${s.id.substring(0, 8)}... (${ago}s ago)`);
        });
      }
      console.log('');
      return;
    }

    if (subCmd === 'set' && args.length >= 3) {
      const key = args[1].toLowerCase();
      const value = args.slice(2).join(' ');

      if (['openai', 'claude', 'deepseek', 'siliconflow', 'qwen', 'groq', 'ollama'].includes(key)) {
        persistentConfig.setApiKey(key, value);
        console.log(`✓ API key for ${key} stored encrypted in ~/.openchat/config.json`);
      } else {
        persistentConfig.setPreference(key, value);
        console.log(`✓ ${key} = ${value}`);
      }
      return;
    }

    if (subCmd === 'get' && args.length >= 2) {
      const key = args[1].toLowerCase();
      if (['openai', 'claude', 'deepseek', 'siliconflow', 'qwen', 'groq', 'ollama'].includes(key)) {
        const stored = persistentConfig.getApiKey(key);
        if (stored) {
          console.log(`${key} = ${stored.substring(0, 8)}...${stored.substring(stored.length - 4)}`);
        } else {
          console.log(`${key} = (not set)`);
        }
      } else {
        const val = persistentConfig.getPreference(key);
        console.log(`${key} = ${val || '(not set)'}`);
      }
      return;
    }

    console.log('Usage: config set|get|list|recent');
  },

  async agentSpawn(args) {
    const name = args[0] || null;
    const agent = await multiAgentCoordinator.spawnAgent(name, {
      name,
      provider: args[1] || 'opencode'
    });
    console.log(`✓ Agent spawned: ${agent.agentId}`);
    console.log(`  Name: ${agent.config.name}`);
    console.log(`  Provider: ${agent.config.provider}`);
  },

  agentList() {
    const agents = multiAgentCoordinator.listAgents();
    console.log('');
    console.log('Active Agents:');
    console.log('────────────────────────────────────────');
    if (agents.length === 0) {
      console.log('  No active agents');
    } else {
      agents.forEach(a => {
        console.log(`  ${a.agentId.substring(0, 12)}...`);
        console.log(`    Name:    ${a.name}`);
        console.log(`    State:   ${a.state}`);
        console.log(`    Msgs:    ${a.messageCount}`);
        console.log(`    Iter:    ${a.iterationCount}`);
      });
    }
    console.log('');
  },

  async agentSend(args) {
    if (args.length < 2) {
      console.log('Usage: agent send <agent_id> <message>');
      return;
    }

    const [agentId, ...msgParts] = args;
    const message = msgParts.join(' ');

    const agent = multiAgentCoordinator.getAgent(agentId);
    if (!agent) {
      console.log(`✗ Agent not found: ${agentId}`);
      return;
    }

    try {
      const result = await agent.run(message);
      console.log('');
      console.log('──────────────────────────────────────');
      console.log(result.content);
      console.log('──────────────────────────────────────');
    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
    }
  },

  async agentParallel(args) {
    if (args.length < 1) {
      console.log('Usage: agent parallel <task_description>');
      return;
    }

    const task = args.join(' ');
    console.log('');
    console.log(`[Multi-Agent] Starting parallel execution...`);
    console.log(`Task: ${task}`);

    try {
      const result = await multiAgentCoordinator.parallelExecute(
        { description: task, decompose: true, steps: ['analyze', 'implement', 'test', 'report'] },
        {
          maxAgents: 4,
          onProgress: (progress) => {
            if (progress.phase === 'executing' && progress.task) {
              process.stdout.write(`.`);
            }
          }
        }
      );

      console.log('');
      console.log('');
      console.log('──────────────────────────────────────');
      console.log(result.summary);
      console.log('──────────────────────────────────────');

      if (result.tasks) {
        console.log('');
        console.log('Results:');
        result.tasks.forEach((t, i) => {
          const status = t.result?.success ? '✓' : '✗';
          console.log(`  ${status} Step ${i + 1}: ${t.description.substring(0, 50)}...`);
        });
      }
    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
    }
    console.log('');
  },

  async agentTerminate(args) {
    if (args.length < 1) {
      console.log('Usage: agent terminate <agent_id>');
      return;
    }

    const [agentId] = args;
    const success = await multiAgentCoordinator.terminateAgent(agentId);
    if (success) {
      console.log(`✓ Agent terminated: ${agentId}`);
    } else {
      console.log(`✗ Agent not found: ${agentId}`);
    }
  },

  模型列表(args) {
    const providerName = args[0] || persistentConfig.getPreference('currentProvider') || 'siliconflow';
    const provider = providerManager.getProviderConfig(providerName);

    console.log('');
    console.log(`=== ${provider?.name || providerName} Models ===`);

    if (!provider) {
      console.log(`Unknown provider: ${providerName}`);
      console.log('');
      return;
    }

    const models = providerManager.listModels(providerName);
    models.forEach((model, i) => {
      const isDefault = model === provider.defaultModel;
      const marker = isDefault ? ' (default)' : '';
      console.log(`  ${i + 1}. ${model}${marker}`);
    });
    console.log('');
  },

  切换模型(args) {
    if (args.length < 2) {
      console.log('');
      console.log('Usage: switch <provider> <model>');
      console.log('Example: switch siliconflow Qwen/Qwen2.5-72B-Instruct');
      console.log('');
      const providers = providerManager.listProviders();
      console.log('Available providers:');
      providers.forEach(p => {
        console.log(`  - ${p.name} (${p.nameCn})`);
      });
      console.log('');
      return;
    }

    const [providerName, model] = args;
    const provider = providerManager.getProviderConfig(providerName);

    if (!provider) {
      console.log(`Unknown provider: ${providerName}`);
      return;
    }

    const models = providerManager.listModels(providerName);
    if (!models.includes(model)) {
      console.log(`Model ${model} not in ${provider.nameCn}'s list`);
      console.log(`Available: ${models.join(', ')}`);
      return;
    }

    persistentConfig.setPreference('currentProvider', providerName);
    persistentConfig.setPreference('currentModel', model);
    console.log(`Switched to ${provider.nameCn} / ${model}`);
  },

  添加Provider(args) {
    if (args.length < 3) {
      console.log('');
      console.log('Usage: addprovider <name> <base_url> <api_key> [model]');
      console.log('Example: addprovider myapi https://api.my.com/v1 sk-xxxxx gpt-4');
      console.log('');
      return;
    }

    const [name, baseUrl, apiKey, model] = args;
    providerManager.addCustomProvider(name, baseUrl, apiKey, model);
    persistentConfig.setApiKey(name, apiKey);
    console.log(`Added custom provider: ${name}`);
    console.log(`  URL: ${baseUrl}`);
    console.log(`  Model: ${model || 'default'}`);
  },

  upgrade() {
    console.log('');
    console.log('Fetching latest provider config from network...');
    console.log('(This may take a few seconds)');
    console.log('');

    import('../scripts/upgrade-providers.js').then(() => {}).catch(err => {
      console.log(`Failed to load upgrade script: ${err.message}`);
    });
  }
};

export function parseCommand(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  return { cmd, args, raw: trimmed };
}

export function executeCommand(input) {
  const processed = processInput(input);
  if (processed && processed !== input) {
    console.log(`[NL Parser] "${input}" → "${processed}"`);
    input = processed;
  }

  const parsed = parseCommand(input);
  if (!parsed) return;

  const { cmd, args } = parsed;

  switch (cmd) {
    case 'help':
    case '?':
      commands.help();
      break;

    case 'provider':
      if (args.length === 0) {
        commands.providerList();
      } else {
        const subCmd = args[0].toLowerCase();
        const subArgs = args.slice(1);
        switch (subCmd) {
          case 'add':
            commands.providerAdd(subArgs);
            break;
          case 'remove':
          case 'rm':
          case 'delete':
            commands.providerRemove(subArgs);
            break;
          case 'list':
          case 'ls':
            commands.providerList();
            break;
          default:
            console.log(`Unknown provider command: ${subCmd}`);
            console.log('Usage: provider add|remove|list');
        }
      }
      break;

    case 'session':
      if (args.length === 0) {
        commands.sessionList();
      } else {
        const subCmd = args[0].toLowerCase();
        const subArgs = args.slice(1);
        switch (subCmd) {
          case 'create':
          case 'new':
            commands.sessionCreate(subArgs);
            break;
          case 'close':
          case 'delete':
            commands.sessionClose(subArgs);
            break;
          case 'list':
          case 'ls':
            commands.sessionList();
            break;
          case 'history':
          case 'log':
            commands.sessionHistory(subArgs);
            break;
          default:
            console.log(`Unknown session command: ${subCmd}`);
        }
      }
      break;

    case 'chat':
    case 'send':
      commands.chat(args);
      break;

    case 'c':
      commands.c(args);
      break;

    case 'status':
      commands.status();
      break;

    case 'config':
      commands.config(args);
      break;

    case '模型列表':
    case 'model_list':
      commands.模型列表(args);
      break;

    case '切换模型':
    case 'model_switch':
      commands.切换模型(args);
      break;

    case '添加Provider':
    case 'add_provider':
      commands.添加Provider(args);
      break;

    case 'upgrade':
    case '更新提供商':
    case '更新模型':
      commands.upgrade();
      break;

    case 'agent':
      if (args.length === 0) {
        commands.agentList();
      } else {
        const subCmd = args[0].toLowerCase();
        const subArgs = args.slice(1);
        switch (subCmd) {
          case 'spawn':
            commands.agentSpawn(subArgs);
            break;
          case 'list':
          case 'ls':
            commands.agentList();
            break;
          case 'send':
            commands.agentSend(subArgs);
            break;
          case 'parallel':
            commands.agentParallel(subArgs);
            break;
          case 'terminate':
          case 'kill':
            commands.agentTerminate(subArgs);
            break;
          default:
            console.log(`Unknown agent command: ${subCmd}`);
            console.log('Usage: agent spawn|list|send|parallel|terminate');
        }
      }
      break;

    case 'clear':
    case 'cls':
      console.clear();
      break;

    case 'exit':
    case 'quit':
    case 'q':
      console.log('Goodbye!');
      process.exit(0);
      break;

    default:
      if (cmd.startsWith('provider ') || cmd.startsWith('session ') || cmd.startsWith('chat ')) {
        const subParts = cmd.split(' ');
        const subCmd = subParts[0];
        const combinedArgs = [...subParts.slice(1), ...args];
        executeCommand(`${subCmd} ${combinedArgs.join(' ')}`);
      } else {
        console.log(`Unknown command: ${cmd}`);
        console.log('Type "help" for available commands');
      }
  }
}