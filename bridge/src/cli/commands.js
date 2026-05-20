import { MessageBuilder, MessageType } from '../protocol/message.js';
import { sessionManager } from '../session/session-manager.js';
import { processInput } from '../core/convergence/natural-language-parser.js';
import { persistentConfig } from '../core/persistent-config.js';
import { multiAgentCoordinator } from '../core/collaboration/multi-agent-coordinator.js';
import { EvolutionEngine } from '../core/evolution/evolution-engine.js';
import { EvolutionMemory } from '../core/evolution/evolution-memory.js';
import { socialConnector } from '../core/collaboration/social-connector.js';
import { knowledgeNetwork } from '../core/memory/knowledge-network.js';
import { CommunityManager } from '../core/collaboration/community-manager.js';
import { securityManager } from '../security/security-manager.js';

async function fetchLocalModels(providerName) {
  if (providerName === 'ollama-cloud' || providerName === 'ollama') {
    try {
      const resp = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(3000)
      });
      if (resp.ok) {
        const json = await resp.json();
        return (json.models || []).map(m => m.name).filter(Boolean);
      }
    } catch (e) {
      console.log(`[Ollama] 发现失败: ${e.message}`);
    }
  } else if (providerName === 'lmstudio') {
    try {
      const resp = await fetch('http://localhost:1234/v1/models', {
        signal: AbortSignal.timeout(3000)
      });
      if (resp.ok) {
        const json = await resp.json();
        return (json.data || []).map(m => m.id).filter(Boolean);
      }
    } catch (e) {
      console.log(`[LM Studio] 发现失败: ${e.message}`);
    }
  }
  return [];
}

export const commands = {
  /**
   * Connect to a provider (simplified, no wizard)
   * connect [provider] [api_key]
   */
  async connect(args) {
    const [pName, apiKey] = args;
    const providers = providerManager.listProviders();

    // No args → show available providers
    if (!pName) {
      console.log('\n  Usage: connect <provider> [api_key]\n');
      console.log('  Available providers:');
      providers.forEach((p, i) => {
        const hasKey = persistentConfig.getApiKey(p.name);
        const status = hasKey ? '✓' : '○';
        const isCurrent = p.name === persistentConfig.getPreference('currentProvider');
        console.log(`  ${status} ${String(i+1).padStart(2)}. ${p.nameCn || p.name}${isCurrent ? ' [current]' : ''}`);
      });
      console.log('\n  Examples:');
      console.log('    connect openai sk-xxx     Connect with API key');
      console.log('    connect openrouter       Use if already configured');
      console.log('');
      return;
    }

    // Normalize provider name
    const name = pName.toLowerCase();
    const provider = providers.find(p => p.name.toLowerCase() === name || (p.nameCn && p.nameCn.toLowerCase() === name));

    if (!provider) {
      console.log(`\n  Unknown provider: ${pName}`);
      console.log('  Run "connect" to see available providers\n');
      return;
    }

    // If no key provided, check if already configured
    if (!apiKey) {
      const existingKey = persistentConfig.getApiKey(provider.name);
      if (existingKey) {
        try {
          await sessionManager.addProvider(provider.name, existingKey);
          persistentConfig.setPreference('currentProvider', provider.name);
          console.log(`\n  ✓ Connected to ${provider.nameCn || provider.name}`);
          console.log(`    Run "m" to select a model\n`);
        } catch (e) {
          console.log(`\n  ✗ Connection failed: ${e.message}`);
          console.log('  Check your API key or run "connect" to see options\n');
        }
      } else {
        console.log(`\n  No API key for ${provider.nameCn || provider.name}.`);
        console.log(`  Usage: connect ${provider.name} <your-api-key>\n`);
      }
      return;
    }

    // Key provided → configure and sync
    console.log(`\n  Configuring ${provider.nameCn || provider.name}...`);
    persistentConfig.setApiKey(provider.name, apiKey);
    persistentConfig.setPreference('currentProvider', provider.name);

    try {
      const { syncModelsForProvider } = await import('../../scripts/upgrade-providers.js');
      const result = await syncModelsForProvider(provider.name, apiKey);
      if (result.success) {
        console.log(`  ✓ Connected! ${result.count} models synced.`);
        console.log(`    Run "m" to select a model\n`);
      } else {
        console.log(`  ⚠ Sync failed: ${result.error}`);
        console.log(`    You can still chat. Run "m" to select a model.\n`);
      }
    } catch (e) {
      console.log(`  ⚠ Error: ${e.message}\n`);
    }
  },

  /**
   * Unified agent command dispatcher
   */
  async agentCmd(args) {
    const sub = args[0]?.toLowerCase();
    const subArgs = args.slice(1);

    switch (sub) {
      case undefined:
      case 'list':
      case 'ls':
        commands.agentList();
        break;
      case 'spawn':
        commands.agentSpawn(subArgs);
        break;
      case 'send':
        commands.agentSend(subArgs);
        break;
      case 'parallel':
        commands.agentParallel(subArgs);
        break;
      case 'iterate':
        commands.agentIterative(subArgs);
        break;
      case 'evolve':
        commands.agentEvolve(subArgs);
        break;
      case 'terminate':
      case 'kill':
        commands.agentTerminate(subArgs);
        break;
      default:
        console.log('\n  Agent commands:');
        console.log('    a              List agents');
        console.log('    a spawn [name] Spawn a new agent');
        console.log('    a send <id> <msg>  Send message to agent');
        console.log('    a parallel <task>  Parallel execution');
        console.log('    a iterate <task>  Iterative refinement');
        console.log('    a evolve <goal>  Self-evolution');
        console.log('    a terminate <id>  Stop agent\n');
    }
  },

  /**
   * Unified memory command dispatcher
   * mem save <key> <value> | mem recall <key> | mem search <q> | mem list | mem stats
   */
  async memCmd(args) {
    const sub = args[0]?.toLowerCase();
    const subArgs = args.slice(1);

    switch (sub) {
      case 'save':
      case undefined:
        if (subArgs.length >= 1) {
          const key = subArgs[0];
          const value = subArgs.slice(1).join(' ') || 'true';
          const memory = new EvolutionMemory();
          memory.remember(key, value, { source: 'manual' });
          console.log(`\n  ✓ Remembered: ${key}\n`);
        } else {
          console.log('\n  Usage: mem save <key> [value]');
          console.log('  Example: mem save project "OpenChat Bridge v2"\n');
        }
        break;
      case 'recall':
      case 'get':
        if (subArgs.length >= 1) {
          const memory = new EvolutionMemory();
          const result = memory.recall(subArgs[0]);
          if (result) {
            console.log(`\n  [${subArgs[0]}]`);
            console.log(`  ${typeof result.value === 'object' ? JSON.stringify(result.value) : result.value}`);
            console.log(`  Updated: ${new Date(result.timestamp).toLocaleString()}\n`);
          } else {
            console.log(`\n  Not found: ${subArgs[0]}\n`);
          }
        } else {
          console.log('\n  Usage: mem recall <key>\n');
        }
        break;
      case 'search':
      case 'find':
        if (subArgs.length >= 1) {
          const memory = new EvolutionMemory();
          const results = memory.search(subArgs.join(' '), { limit: 10 });
          console.log(`\n  Memory search: "${subArgs.join(' ')}"`);
          if (results.length === 0) {
            console.log('  No results found');
          } else {
            results.forEach((r, i) => {
              const preview = typeof r.value === 'object' ? JSON.stringify(r.value).substring(0, 60) + '...' : String(r.value).substring(0, 60) + '...';
              console.log(`  ${i + 1}. ${r.key}: ${preview}`);
            });
          }
          console.log('');
        } else {
          console.log('\n  Usage: mem search <query>\n');
        }
        break;
      case 'list':
      case 'ls':
        const memory = new (require('../core/evolution-memory.js').EvolutionMemory)();
        const keys = memory.getAllKeys();
        console.log('\n  Memories:');
        if (keys.length === 0) {
          console.log('  (empty)');
        } else {
          keys.forEach((key, i) => {
            const entry = memory.recall(key);
            const preview = typeof entry.value === 'object' ? JSON.stringify(entry.value).substring(0, 40) : String(entry.value).substring(0, 40);
            console.log(`  ${i + 1}. ${key}: ${preview}`);
          });
        }
        console.log('');
        break;
      case 'stats':
        const m = new (require('../core/evolution-memory.js').EvolutionMemory)();
        const stats = m.getStats();
        console.log(`\n  ${stats.totalMemories} memories, ${stats.keys.length} keys\n`);
        break;
      default:
        console.log('\n  Memory commands:');
        console.log('    mem save <key> [val]  Save a fact');
        console.log('    mem recall <key>     Recall a fact');
        console.log('    mem search <query>   Search memories');
        console.log('    mem list             List all memories');
        console.log('    mem stats            Show statistics\n');
    }
  },

  help() {
    const currentProvider = persistentConfig.getPreference('currentProvider');
    const currentModel = persistentConfig.getPreference('currentModel');
    const pname = currentProvider ? (providerManager.getProvider(currentProvider)?.nameCn || currentProvider) : null;

    console.log('');
    console.log('  OPENCHAT BRIDGE v2.0');
    if (pname) {
      console.log(`  [${pname}/${currentModel || 'default'}]`);
    }
    console.log('');
    console.log('  Start chatting:');
    console.log('    <message>        Type anything to chat with AI');
    console.log('    chat <message>   Same as above');
    console.log('');
    console.log('  Core commands:');
    console.log('    m [p] [m]        Switch model (or: m, m <keyword>, m 99)');
    console.log('    p [cmd]          Manage providers (list, add, search, presets)');
    console.log('    connect <p> [k]  Connect to a provider');
    console.log('    a [cmd]          Manage agents (spawn, parallel, iterate, evolve)');
    console.log('    mem [cmd]        Memory (save, recall, search, list, stats)');
    console.log('    s                System status');
    console.log('    ?                Show this help');
    console.log('');
    console.log('  Expert commands:');
    console.log('    cfg [cmd]        Configuration');
    console.log('    upgrade          Sync all provider models');
    console.log('    vector [cmd]     RAG vector operations');
    console.log('    security [cmd]    Security settings');
    console.log('    social [cmd]     Social network');
    console.log('    evolution [cmd]  Evolution system');
    console.log('');
    console.log('  Keyboard shortcuts:');
    console.log('    ↑ / ↓           Navigate command history');
    console.log('    Ctrl+C           Cancel current input');
    console.log('    Ctrl+L           Clear screen');
    console.log('    exit / q         Quit');
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

  async provider(args) {
    const [name, key] = args;
    const current = persistentConfig.getPreference('currentProvider');

    // provider presets - list all preset providers
    if (name === 'presets') {
      const { listPresetProviders } = await import('../providers/openai-compatible.js');
      const presets = listPresetProviders();

      console.log('\n╔═══════════════════════════════════════════════════════════╗');
      console.log('║              全部预设服务商 (59个)                        ║');
      console.log('╚═══════════════════════════════════════════════════════════╝');

      // 分类显示
      const categories = {
        '国际主流': ['openai', 'anthropic', 'google', 'deepseek', 'openrouter', 'groq', 'xai', 'mistral', 'cohere', 'replicate', 'together', 'perplexity', 'fireworks', 'cerebras', 'sambanova'],
        '云服务商': ['azure', 'aws_bedrock', 'vertex'],
        '国内服务商': ['zhipu', 'alibaba', 'baidu', 'moonshot', 'minimax', 'siliconflow', 'volcengine', 'spark', 'baichuan', 'yi', 'stepfun', 'lingji', 'iflow', 'bailian', 'tencent', '360', 'langboat', 'sensetime', 'unisound', 'teleai', 'mita'],
        '本地服务': ['ollama', 'lmstudio', 'vllm', 'localai', 'textgen'],
        '其他平台': ['huggingface', 'monsterapi', 'glidian', 'inferless', 'anyscale', 'octoai', 'lepton', 'predibase', 'nomic', 'voyage', 'alephalpha', 'ai21', 'inflection', 'reka', 'databricks']
      };

      const configuredKeys = Object.keys(persistentConfig.config.apiKeys || {});

      for (const [cat, ids] of Object.entries(categories)) {
        console.log(`\n【${cat}】`);
        const items = presets.filter(p => ids.includes(p.id));
        items.forEach(p => {
          const hasKey = configuredKeys.includes(p.id);
          const status = hasKey ? '✓' : '○';
          const special = p.special ? ' ⚠️' : '';
          console.log(`  [${status}] ${p.id.padEnd(15)} ${p.nameCn.padEnd(20)} ${p.defaultModel || ''}${special}`);
        });
      }

      console.log('\n  ○ 未配置  ✓ 已配置  ⚠️ 需要特殊适配');
      console.log('\n  配置方式: provider <名称> <api-key>');
      console.log('  示例: provider openrouter sk-or-xxx');
      console.log('');
      return;
    }

    // provider search <keyword> - search presets
    if (name === 'search' && key) {
      const { listPresetProviders } = await import('../providers/openai-compatible.js');
      const presets = listPresetProviders();
      const keyword = key.toLowerCase();

      const matches = presets.filter(p =>
        p.id.toLowerCase().includes(keyword) ||
        p.name.toLowerCase().includes(keyword) ||
        (p.nameCn && p.nameCn.toLowerCase().includes(keyword))
      );

      console.log(`\n【搜索结果: "${key}"】`);
      if (matches.length === 0) {
        console.log('  未找到匹配的服务商');
      } else {
        matches.forEach(p => {
          console.log(`  ${p.id.padEnd(15)} ${p.nameCn} (${p.defaultModel || 'N/A'})`);
        });
      }
      console.log('');
      return;
    }

    // provider --sync-all
    if (name === '--sync-all') {
      console.log('正在同步全部服务商...');
      const { syncAll } = await import('../../scripts/upgrade-providers.js');
      await syncAll();
      return;
    }

    // provider --sync <name>
    if (name === '--sync' && key) {
      const { syncModelsForProvider } = await import('../../scripts/upgrade-providers.js');
      const apiKey = persistentConfig.getApiKey(key) || '';
      await syncModelsForProvider(key, apiKey);
      return;
    }

    // provider --sync-current
    if (name === '--sync-current') {
      const currentProvider = persistentConfig.getPreference('currentProvider');
      if (!currentProvider) {
        console.log('✗ 未设置当前服务商');
        return;
      }
      console.log(`[${currentProvider}] 正在同步模型列表...`);
      const { syncModelsForProvider } = await import('../../scripts/upgrade-providers.js');
      const apiKey = persistentConfig.getApiKey(currentProvider) || '';
      await syncModelsForProvider(currentProvider, apiKey);
      return;
    }

    // provider <name> <key> - configure and sync
    if (name && key) {
      console.log(`[${name}] 配置 API Key 并同步模型...`);
      persistentConfig.setApiKey(name, key);
      try {
        const { syncModelsForProvider } = await import('../../scripts/upgrade-providers.js');
        const result = await syncModelsForProvider(name, key);
        if (result.success) {
          persistentConfig.setPreference('currentProvider', name);
          console.log(`\n✓ ${name} 配置成功，${result.count} 个模型已同步`);
        }
      } catch (e) {
        console.log(`  ○ 同步失败，请稍后手动同步`);
      }
      return;
    }

    // provider <name> - show provider info
    if (name) {
      const p = providerManager.getProvider(name);
      if (!p) {
        console.log(`\n✗ 未知服务商: ${name}\n`);
        return;
      }
      console.log(`\n【${p.nameCn || p.name}】`);
      console.log(`  端点: ${p.baseUrl || 'N/A'}`);
      console.log(`  默认: ${p.defaultModel || 'None'}`);
      const models = providerManager.listModels(name);
      if (models.length > 0) {
        console.log(`  模型 (${models.length}):`);
        models.slice(0, 10).forEach((m, i) => {
          console.log(`    ${i+1}. ${m}`);
        });
        if (models.length > 10) console.log(`    ... 还有 ${models.length - 10} 个`);
      } else {
        console.log('  ○ 未同步模型');
      }
      console.log('\n  配置: provider ' + name + ' <your-api-key>');
      console.log('');
      return;
    }

    // provider - list all
    const providers = providerManager.listProviders();
    const { PROVIDER_ALIASES } = await import('../providers/provider-manager.js');

    // Build reverse mapping: canonical -> aliases
    const canonicalToAliases = {};
    Object.entries(PROVIDER_ALIASES).forEach(([alias, canonical]) => {
      if (!canonicalToAliases[canonical]) canonicalToAliases[canonical] = [];
      if (alias !== canonical) canonicalToAliases[canonical].push(alias);
    });

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                    AI 服务商                              ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    providers.forEach((p, i) => {
      const status = p.connected ? '✓' : '○';
      const isCurrent = p.name === current;
      const aliases = (canonicalToAliases[p.name] || []).filter(a => a !== p.name && a !== p.nameCn);
      const aliasStr = aliases.length > 0 ? ` (${aliases.join(', ')})` : '';
      const displayName = p.nameCn && p.nameCn !== p.name ? `${p.name} (${p.nameCn})` : p.name;
      console.log(`[${status}] ${String(i+1).padStart(2)}. ${displayName.padEnd(25)} ${isCurrent ? '[当前]' : ''}${aliasStr}`);
    });

    console.log('');
    console.log('  provider                            列出已配置服务商');
    console.log('  provider presets                    列出全部59个预设');
    console.log('  provider search <关键词>            搜索预设服务商');
    console.log('  provider <名称>                     查看详情');
    console.log('  provider <名称> <key>               配置并同步');
    console.log('  provider --sync-all                 同步全部');
    console.log('  provider --sync <名称>              同步指定服务商');
    console.log('  provider --sync-current             同步当前服务商');
    console.log('  provider add <名称> <endpoint>      添加自定义服务商');
    console.log('  provider remove <名称>              移除服务商');
    console.log('');
  },

  async available(args) {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║                  可用模型检测                            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');

    const pc = persistentConfig;
    const { providerManager } = await import('../providers/provider-manager.js');
    const keys = Object.keys(pc.config.apiKeys);

    const working = [];

    for (const provider of keys) {
      const apiKey = pc.getApiKey(provider);
      const p = providerManager.getProvider(provider);
      if (!p || !apiKey || apiKey === 'sk-test') continue;

      try {
        const resp = await fetch(p.baseUrl + '/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: p.defaultModel,
            messages: [{role: 'user', content: 'hi'}],
            max_tokens: 5
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (resp.ok) {
          const json = await resp.json();
          if (!json.error) {
            const models = providerManager.listModels(provider);
            const modelName = json.model || p.defaultModel;
            console.log(`  ✓ ${provider} (${modelName}) - ${models.length} 个模型`);
            working.push({ provider, model: modelName });
            continue;
          }
        }
        const json = await resp.json().catch(() => ({}));
        const msg = json.error?.message || json.error?.type || '';
        console.log(`  ✗ ${provider} - HTTP ${resp.status}`);
      } catch (e) {
        console.log(`  ✗ ${provider} - ${e.message.substring(0, 20)}`);
      }
    }

    console.log('');

    if (working.length === 0) {
      console.log('  ✗ 当前没有可用的 Provider');
      console.log('');
      console.log('  请配置有效的 API Key:');
      console.log('  provider openrouter <key>    # OpenRouter (推荐)');
      console.log('  provider minimax <key>       # MiniMax');
      console.log('  provider opencode <key>     # OpenCode');
    } else if (working.length === 1) {
      const w = working[0];
      pc.setPreference('currentProvider', w.provider);
      pc.setPreference('currentModel', w.model);
      console.log(`  ✓ 已自动切换到: ${w.provider} / ${w.model}`);
    } else {
      console.log('  输入 "provider <名称>" 或 "model <p> <m>" 切换');
    }
    console.log('');
  },

  async sessionCreate(args) {
    let provider = persistentConfig.getPreference('currentProvider');
    let model = persistentConfig.getPreference('currentModel');

    if (args.length >= 2) {
      [provider, model] = args;
    } else if (args.length === 1) {
      // If only one arg, treat it as goal/message - just create session with current settings
    }

    if (!provider) {
      console.log('✗ No provider set. Use "provider <name> <key>" first.');
      return;
    }

    // Check if provider is connected, if not, connect it automatically
    const providerInSessionManager = sessionManager.getProvider(provider);
    if (!providerInSessionManager || !providerInSessionManager.connected) {
      // Connect the provider automatically if API key exists
      const apiKey = persistentConfig.getApiKey(provider);
      if (apiKey) {
        try {
          await sessionManager.addProvider(provider, apiKey);
        } catch (error) {
          console.log(`✗ Failed to connect to ${provider}: ${error.message}`);
          console.log(`  Make sure the API key is valid and network is accessible`);
          return;
        }
      } else {
        console.log(`✗ No API key for ${provider}. Set with: config set ${provider} <api_key>`);
        return;
      }
    }

    try {
      const session = await sessionManager.createSession(provider, model);
      // 简化输出，避免显示过多信息
      console.log(`✓ Session created: ${session.id.substring(0, 8)}...`);
    } catch (error) {
      console.log(`✗ Session failed: ${error.message}`);
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

    let sessionId = sessionIdOrShort;
    if (sessionId.length !== 36) {
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

    const dots = setInterval(() => process.stdout.write('.'), 300);
    try {
      const response = await sessionManager.sendMessage(sessionId, message);
      clearInterval(dots);

      // 清除 Thinking 行并显示响应
      process.stdout.write('\r\x1b[2K\r');  // 清除整行并回到行首
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
      clearInterval(dots);
      process.stdout.write('\r\x1b[2K\r');  // 清除整行并回到行首
      console.log(`✗ Error: ${error.message}`);
    }
  },

  async c(args) {
    if (args.length < 1) {
      console.log('Usage: c <message>');
      return;
    }

    const message = args.join(' ');
    const sessions = sessionManager.listSessions();

    // Use current provider from config instead of session's provider
    const currentProvider = persistentConfig.getPreference('currentProvider');
    const currentModel = persistentConfig.getPreference('currentModel');

    // Check if existing session matches current provider, if not create new one
    let sessionId = null;
    if (sessions.length > 0) {
      sessions.sort((a, b) => b.lastActivity - a.lastActivity);
      const session = persistentStore.getSession(sessions[0].id);
      // Use existing session only if provider matches current
      if (session && session.providerType === currentProvider) {
        sessionId = sessions[0].id;
      }
    }

    if (!sessionId) {
      // No valid session, create one with current provider
      if (!currentProvider) {
        console.log('\n✗ No provider set. Use "provider <name>" to select one first.\n');
        return;
      }
      const apiKey = persistentConfig.getApiKey(currentProvider);
      if (!apiKey) {
        console.log(`\n✗ No API key for ${currentProvider}. Set with: config set ${currentProvider} <api_key>\n`);
        return;
      }
      // Only add provider if not already connected
      const existingProvider = sessionManager.getProvider(currentProvider);
      if (!existingProvider || !existingProvider.connected) {
        try {
          await sessionManager.addProvider(currentProvider, apiKey);
        } catch (e) {
          // Provider may already exist, try to continue
        }
      }
      try {
        const session = await sessionManager.createSession(currentProvider, currentModel);
        sessionId = session.id;
      } catch (e) {
        console.log(`\n✗ Failed to create session: ${e.message}\n`);
        return;
      }
    }

    process.stdout.write('\n[Using session: ' + sessionId.substring(0, 8) + '...]\n');
    process.stdout.write('Thinking');

    const dots = setInterval(() => process.stdout.write('.'), 300);
    try {
      const response = await sessionManager.sendMessage(sessionId, message);
      clearInterval(dots);

      // 清除 Thinking 行并显示响应
      process.stdout.write('\r\x1b[2K\r');  // 清除整行并回到行首
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
      clearInterval(dots);
      // 清除 Thinking 行并显示错误
      process.stdout.write('\r\x1b[2K\r');  // 清除整行并回到行首
      console.log(`✗ Error: ${error.message}`);
    }
  },

  status() {
    const providers = providerManager.listProviders();
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

  async config(args) {
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
      console.log('    config set <provider> <api_key>   Store API key');
      console.log('    config url <provider> <url>       Set custom URL');
      console.log('    config show <provider>            Show provider info');
      console.log('    config get <key>                  Get value');
      console.log('    config list                       List stored keys');
      console.log('    config recent                     Show recent sessions');
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

    // 查看服务商详情
    if (subCmd === 'show' && args.length >= 2) {
      const providerName = args[1].toLowerCase();
      const config = providerManager.getProviderConfig(providerName);

      if (!config) {
        console.log(`✗ Provider not found: ${providerName}`);
        return;
      }

      const apiKey = persistentConfig.getApiKey(providerName);

      console.log('');
      console.log(`Provider: ${config.nameCn || config.name || providerName}`);
      console.log(`  Base URL: ${config.baseUrl}`);
      console.log(`  Chat Endpoint: ${config.chatEndpoint}`);
      console.log(`  Default Model: ${config.defaultModel}`);
      console.log(`  API Key: ${apiKey ? apiKey.substring(0, 8) + '...' + apiKey.substring(apiKey.length - 4) : '(not set)'}`);
      if (config.models && config.models.length > 0) {
        console.log(`  Models: ${config.models.length} available`);
      }
      console.log('');
      return;
    }

    // 设置自定义 URL
    if (subCmd === 'url' && args.length >= 3) {
      const providerName = args[1].toLowerCase();
      const url = args[2];

      // 保存自定义 URL
      persistentConfig.setPreference(`provider_url_${providerName}`, url);

      // 更新 providerManager
      providerManager.addCustomProvider(providerName, url, persistentConfig.getApiKey(providerName));

      console.log(`✓ ${providerName} URL set to: ${url}`);
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

      // 保存 API key
      persistentConfig.setApiKey(key, value);
      console.log(`✓ API key for ${key} stored encrypted`);

      // 检查是否有自定义 URL
      const customUrl = persistentConfig.getPreference(`provider_url_${key}`);
      if (customUrl) {
        providerManager.addCustomProvider(key, customUrl, value);
      }

      return;
    }

    if (subCmd === 'get' && args.length >= 2) {
      const key = args[1].toLowerCase();
      const stored = persistentConfig.getApiKey(key);
      if (stored) {
        console.log(`${key} = ${stored.substring(0, 8)}...${stored.substring(stored.length - 4)}`);
      } else {
        console.log(`${key} = (not set)`);
      }
      return;
    }

    console.log('Usage: config set|url|show|get|list|recent');
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

  async agentIterative(args) {
    if (args.length < 1) {
      console.log('Usage: agent iterate <task_description>');
      return;
    }

    const task = args.join(' ');
    console.log('');
    console.log(`[Multi-Agent] Starting iterative review loop...`);
    console.log(`Task: ${task}`);

    try {
      const result = await multiAgentCoordinator.iterativeReviewLoop(
        task,
        {
          maxLoops: 3,
          coderConfig: { name: 'Coder' },
          reviewerConfig: { name: 'Reviewer' }
        }
      );

      console.log('');
      console.log('──────────────────────────────────────');
      console.log(`Result: ${result.success ? 'APPROVED' : 'REJECTED'}`);
      console.log(`Iterations: ${result.iterations}`);
      console.log('──────────────────────────────────────');
      console.log('\nFinal Solution:\n');
      console.log(result.finalResult);
      console.log('\n──────────────────────────────────────');

      if (result.history.length > 0) {
        console.log('\nReview History:');
        result.history.forEach((h, i) => {
          console.log(`  Iter ${h.iteration}: ${h.review.substring(0, 100)}...`);
        });
      }
    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
    }
    console.log('');
  },

  async agentEvolve(args) {
    if (args.length < 1) {
      console.log('Usage: agent evolve <goal>');
      console.log('Example: agent evolve improve task decomposition logic');
      return;
    }

    const goal = args.join(' ');
    const currentProvider = persistentConfig.getPreference('currentProvider');

    try {
      const result = await multiAgentCoordinator.evolutionLoop(currentProvider, goal);

      console.log('');
      console.log(`Evolution: ${result.success ? '✨ COMPLETE' : '⚠️ STABILIZED'} (${result.history.length} iterations)`);
      if (result.finalSolution) {
        console.log('\n' + result.finalSolution.substring(0, 500));
      }
    } catch (error) {
      console.log(`✗ Evolution failed: ${error.message}`);
    }
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

  async model(args) {
    const [providerName, modelQuery] = args;
    const current = persistentConfig.getPreference('currentProvider');
    const currentModel = persistentConfig.getPreference('currentModel');

    // model auto - switch to openrouter/auto
    if (providerName === 'auto') {
      persistentConfig.setPreference('currentProvider', 'openrouter');
      persistentConfig.setPreference('currentModel', 'openrouter/auto');
      persistentConfig.recordModelUse('openrouter', 'openrouter/auto');
      console.log('\n✓ 已切换为 OpenRouter / auto\n');
      return;
    }

    // model <name> <model> - switch model directly
    if (providerName && modelQuery) {
      const provider = providerManager.getProvider(providerName);
      if (!provider) {
        console.log(`\n✗ 未知服务商: ${providerName}\n`);
        return;
      }

      let models = providerManager.listModels(providerName);

      // Try local discovery for ollama/lmstudio
      if (providerName === 'ollama-cloud' || providerName === 'lmstudio' || providerName === 'ollama') {
        try {
          const localModels = await fetchLocalModels(providerName);
          if (localModels.length > 0) models = localModels;
        } catch (e) {}
      }

      if (modelQuery.includes('/')) {
        if (models.includes(modelQuery)) {
          persistentConfig.setPreference('currentProvider', providerName);
          persistentConfig.setPreference('currentModel', modelQuery);
          persistentConfig.recordModelUse(providerName, modelQuery);
          console.log(`\n✓ 已切换为 ${provider.nameCn} / ${modelQuery}\n`);
          return;
        }
        console.log(`\n✗ 模型 ${modelQuery} 不存在\n`);
        return;
      }

      // Search by keyword
      const q = modelQuery.toLowerCase();
      const filtered = models.filter(m => m.toLowerCase().includes(q));

      if (filtered.length === 0) {
        console.log(`\n✗ 未找到匹配 "${modelQuery}" 的模型\n`);
        return;
      }

      if (filtered.length === 1) {
        // 只有一个匹配，直接切换
        persistentConfig.setPreference('currentProvider', providerName);
        persistentConfig.setPreference('currentModel', filtered[0]);
        persistentConfig.recordModelUse(providerName, filtered[0]);
        console.log(`\n✓ 已切换为 ${provider.nameCn} / ${filtered[0]}\n`);
        return;
      }

      // 多个匹配，显示列表
      console.log(`\n【${provider.nameCn}】搜索 "${modelQuery}" (${filtered.length} 结果)`);
      filtered.slice(0, 15).forEach((m, i) => {
        const isDefault = m === provider.defaultModel;
        const isCurrent = m === currentModel && providerName === current;
        console.log(`  ${String(i+1).padStart(2)}. ${m}${isDefault ? ' [默认]' : ''}${isCurrent ? ' [当前]' : ''}`);
      });
      if (filtered.length > 15) console.log(`  ... 还有 ${filtered.length - 15} 个`);
      console.log('\n  切换: model ' + providerName + ' <完整模型ID>');
      console.log('');
      return;
    }

    // model <keyword> - search in recent models first
    if (providerName) {
      const recentModels = persistentConfig.getRecentModels(10);
      const num = parseInt(providerName);

      // 序号选择
      if (!isNaN(num)) {
        // 99 = 显示当前服务商所有模型
        if (num === 99) {
          const currentProvider = persistentConfig.getPreference('currentProvider');
          if (!currentProvider) {
            console.log('\n✗ 未设置当前服务商\n');
            return;
          }
          const provider = providerManager.getProvider(currentProvider);
          const models = providerManager.listModels(currentProvider);
          if (models.length === 0) {
            console.log(`\n【${provider?.nameCn || currentProvider}】 ○ 无模型\n`);
            return;
          }
          console.log(`\n【${provider?.nameCn || currentProvider}】全部 ${models.length} 个模型`);
          models.forEach((m, i) => {
            const isDefault = m === provider?.defaultModel;
            const isCurrent = m === currentModel;
            console.log(`  ${String(i+1).padStart(2)}. ${m}${isDefault ? ' [默认]' : ''}${isCurrent ? ' [当前]' : ''}`);
          });
          console.log('\n  model <序号> 切换\n');
          return;
        }

        // 1-10 = 选择最近模型
        if (num >= 1 && num <= recentModels.length) {
          const item = recentModels[num - 1];
          persistentConfig.setPreference('currentProvider', item.provider);
          persistentConfig.setPreference('currentModel', item.model);
          persistentConfig.recordModelUse(item.provider, item.model);
          const p = providerManager.getProvider(item.provider);
          console.log(`\n✓ 已切换为 ${p?.nameCn || item.provider} / ${item.model}\n`);
          return;
        }

        // 其他数字 = 从当前服务商模型列表选择
        const currentProvider = persistentConfig.getPreference('currentProvider');
        if (currentProvider) {
          const models = providerManager.listModels(currentProvider);
          if (num >= 1 && num <= models.length) {
            const model = models[num - 1];
            persistentConfig.setPreference('currentModel', model);
            persistentConfig.recordModelUse(currentProvider, model);
            const p = providerManager.getProvider(currentProvider);
            console.log(`\n✓ 已切换为 ${p?.nameCn || currentProvider} / ${model}\n`);
            return;
          }
        }

        // 尝试切换到对应序号的 provider
        const providers = providerManager.listProviders();
        if (num >= 1 && num <= providers.length) {
          const p = providers[num - 1];
          persistentConfig.setPreference('currentProvider', p.name);
          persistentConfig.setPreference('currentModel', p.defaultModel || null);
          persistentConfig.recordModelUse(p.name, p.defaultModel);
          console.log(`\n✓ 已切换为 ${p.nameCn || p.name}\n`);
          return;
        }

        console.log('\n✗ 无效序号\n');
        return;
      }

      // 关键词搜索
      const q = providerName.toLowerCase();

      // 在最近使用的模型中搜索
      const recentMatch = recentModels.filter(item =>
        item.model.toLowerCase().includes(q) ||
        item.provider.toLowerCase().includes(q)
      );

      if (recentMatch.length > 0) {
        if (recentMatch.length === 1) {
          // 只有一个匹配，直接切换
          const item = recentMatch[0];
          persistentConfig.setPreference('currentProvider', item.provider);
          persistentConfig.setPreference('currentModel', item.model);
          persistentConfig.recordModelUse(item.provider, item.model);
          const p = providerManager.getProvider(item.provider);
          console.log(`\n✓ 已切换为 ${p?.nameCn || item.provider} / ${item.model}\n`);
          return;
        }

        // 多个匹配，显示列表
        console.log(`\n【最近使用】匹配 "${providerName}"`);
        recentMatch.slice(0, 10).forEach((item, i) => {
          const p = providerManager.getProvider(item.provider);
          const name = p ? p.nameCn : item.provider;
          const isCurrent = item.model === currentModel && item.provider === current;
          console.log(`  ${i+1}. ${name} / ${item.model}${isCurrent ? ' [当前]' : ''}`);
        });
        console.log('\n  model <序号> 选择\n');
        return;
      }

      // 当作服务商名处理
      const provider = providerManager.getProvider(providerName);
      if (!provider) {
        console.log(`\n✗ 未找到: ${providerName}`);
        console.log('  provider 查看所有服务商\n');
        return;
      }

      // 显示该服务商的模型列表
      let models = providerManager.listModels(providerName);

      if (models.length === 0) {
        console.log(`\n【${provider.nameCn}】 ○ 无模型\n`);
        return;
      }

      console.log(`\n【${provider.nameCn}】共 ${models.length} 个模型`);
      models.forEach((m, i) => {
        const isDefault = m === provider.defaultModel;
        const isCurrent = m === currentModel && providerName === current;
        console.log(`  ${String(i+1).padStart(2)}. ${m}${isDefault ? ' [默认]' : ''}${isCurrent ? ' [当前]' : ''}`);
      });
      console.log('\n  model <序号> 切换\n');
      return;
    }

    // 无参数 - 显示最近使用的模型
    const recentModels = persistentConfig.getRecentModels(10);

    console.log('\n【最近使用的模型】');
    if (recentModels.length === 0) {
      console.log('  暂无使用记录');
    } else {
      recentModels.forEach((item, i) => {
        const p = providerManager.getProvider(item.provider);
        const name = p ? p.nameCn : item.provider;
        const isCurrent = item.model === currentModel && item.provider === current;
        console.log(`  ${i+1}. ${name} / ${item.model}${isCurrent ? ' [当前]' : ''}`);
      });
    }

    // 添加"更多"选项
    const currentProvider = persistentConfig.getPreference('currentProvider');
    if (currentProvider) {
      const provider = providerManager.getProvider(currentProvider);
      if (provider) {
        const allModels = providerManager.listModels(currentProvider);
        console.log(`  99. 更多 (${provider.nameCn} 全部 ${allModels.length} 个模型)`);
      }
    }

    console.log('\n  切换: model <序号>\n');
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

  async upgrade(args) {
    console.log('');
    console.log('正在同步 Provider...');

    if (args.includes('--sync-all')) {
      const { syncAll } = await import('../../scripts/upgrade-providers.js');
      await syncAll();
      return;
    }

    if (args.includes('--sync') && args.length > 1) {
      const provider = args[1];
      const { syncModelsForProvider } = await import('../../scripts/upgrade-providers.js');
      const apiKey = persistentConfig.getApiKey(provider) || '';
      await syncModelsForProvider(provider, apiKey);
      return;
    }

    if (args.includes('--models-dev') || args.includes('-m')) {
      const { syncFromModelsDev } = await import('../../scripts/models-dev.js');
      await syncFromModelsDev(null);
      return;
    }

    const { syncBlueprints } = await import('../../scripts/upgrade-providers.js');
    await syncBlueprints();
  },

  /**
   * 向量检索命令
   */
  async vector(args) {
    // 初始化向量存储
    if (!memoryManager.initialized) {
      await memoryManager.initialize();
    }

    const subCmd = args[0]?.toLowerCase();

    switch (subCmd) {
      case 'index':
        // vector index <text>
        const text = args.slice(1).join(' ');
        if (!text) {
          console.log('Usage: vector index <text>');
          return;
        }
        try {
          const embedding = await embeddingService.embed(text);
          console.log(`\n[Vector] Generated embedding (${embedding.length} dimensions)`);
          console.log(`First 5 values: ${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...`);

          // 存储到向量库
          await vectorStore.addVector({
            id: `manual_${Date.now()}`,
            type: 'manual',
            content: text,
            embedding
          });
          console.log('✓ Vector stored');
        } catch (e) {
          console.log(`✗ Error: ${e.message}`);
        }
        break;

      case 'search':
        // vector search <query>
        const query = args.slice(1).join(' ');
        if (!query) {
          console.log('Usage: vector search <query>');
          return;
        }
        try {
          const results = await hybridRetriever.search(query, { topK: 5 });
          console.log('\n[Vector Search Results]');
          if (results.length === 0) {
            console.log('  No results found');
          } else {
            results.forEach((r, i) => {
              const preview = r.content.length > 60 ? r.content.substring(0, 60) + '...' : r.content;
              console.log(`  ${i + 1}. [${r.type}] ${preview}`);
              console.log(`     Score: ${(r.similarity || r.rrfScore || 0).toFixed(4)}`);
            });
          }
        } catch (e) {
          console.log(`✗ Error: ${e.message}`);
        }
        break;

      case 'stats':
        // vector stats
        try {
          const stats = await memoryManager.getStats();
          console.log('\n[Vector Store Stats]');
          console.log(`  RAG Enabled: ${stats.ragEnabled}`);
          console.log(`  Initialized: ${stats.initialized}`);
          if (stats.vectorStore) {
            console.log(`  Total vectors: ${stats.vectorStore.totalCount}`);
            console.log(`  By type: ${JSON.stringify(stats.vectorStore.byType)}`);
            console.log(`  Cache size: ${stats.vectorStore.cacheSize}`);
          }
          if (stats.embeddingCache) {
            console.log(`  Embedding cache: ${stats.embeddingCache.size}`);
          }
        } catch (e) {
          console.log(`✗ Error: ${e.message}`);
        }
        break;

      case 'cleanup':
        // vector cleanup [days]
        const days = parseInt(args[1]) || 90;
        try {
          const cleaned = await memoryManager.cleanup(days);
          console.log(`\n✓ Cleaned ${cleaned} old vectors`);
        } catch (e) {
          console.log(`✗ Error: ${e.message}`);
        }
        break;

      case 'clear':
        // vector clear - 清空所有向量
        try {
          await vectorStore.clear();
          embeddingService.clearCache();
          console.log('\n✓ Vector store cleared');
        } catch (e) {
          console.log(`✗ Error: ${e.message}`);
        }
        break;

      default:
        console.log('\n[Vector Commands]');
        console.log('  vector index <text>       生成并存储文本的向量');
        console.log('  vector search <query>     搜索相似内容');
        console.log('  vector stats              查看统计信息');
        console.log('  vector cleanup [days]     清理旧数据 (默认90天)');
        console.log('  vector clear              清空所有向量');
    }
  },

  /**
   * 记住事实
   */
  async remember(args) {
    if (!memoryManager.initialized) {
      await memoryManager.initialize();
    }

    const fact = args.join(' ');
    if (!fact) {
      console.log('Usage: remember <fact>');
      return;
    }

    try {
      const factId = await memoryManager.saveFact('default', fact);
      console.log(`\n✓ Remembered: ${fact}`);
      console.log(`  ID: ${factId}`);
    } catch (e) {
      console.log(`✗ Error: ${e.message}`);
    }
  },

  /**
   * 回忆相关内容
   */
  async recall(args) {
    if (!memoryManager.initialized) {
      await memoryManager.initialize();
    }

    const query = args.join(' ');
    if (!query) {
      console.log('Usage: recall <query>');
      return;
    }

    try {
      const results = await memoryManager.queryFacts('default', query, { topK: 5 });
      console.log('\n[Recall Results]');
      if (results.length === 0) {
        console.log('  No relevant memories found');
      } else {
        results.forEach((r, i) => {
          const content = r.content || r;
          const score = r.similarity || r.rrfScore || 0;
          console.log(`  ${i + 1}. ${content}`);
          if (score > 0) {
            console.log(`     Score: ${score.toFixed(4)}`);
          }
        });
      }
    } catch (e) {
      console.log(`✗ Error: ${e.message}`);
    }
  },

  /**
   * 查看进化状态和经验
   */
  async evolution(args) {
    const subCmd = args[0]?.toLowerCase();
    
    if (subCmd === 'stats' || subCmd === 'stat' || !subCmd) {
      // 创建一个临时进化引擎来获取统计数据
      const evolutionEngine = new EvolutionEngine();
      const stats = evolutionEngine.getStats();
      
      console.log('\n╔═══════════════════════════════════════════════════════════╗');
      console.log('║                    EVOLUTION STATS                      ║');
      console.log('╚═══════════════════════════════════════════════════════════╝\n');
      
      console.log(`  总经验数量: ${stats.totalExperiences}`);
      console.log(`  成功经验: ${stats.successfulExperiences}`);
      console.log(`  成功率: ${stats.successRate}%`);
      console.log(`  技能数量: ${stats.skillsCount}`);
      console.log('');
      
      if (stats.recentPatterns.length > 0) {
        console.log('  近期模式:');
        stats.recentPatterns.slice(0, 5).forEach((pattern, i) => {
          const successCount = pattern.tasks.filter(t => t.success).length;
          const successRate = pattern.tasks.length > 0 ? (successCount / pattern.tasks.length * 100).toFixed(1) : 0;
          console.log(`    ${i + 1}. ${pattern.group} (${pattern.count} 次, ${successRate}% 成功率)`);
        });
        console.log('');
      }
      
      console.log('  命令:');
      console.log('    evolution                查看统计');
      console.log('    evolution skills         查看已学习技能');
      console.log('    evolution experiences    查看历史经验');
      console.log('');
    } 
    else if (subCmd === 'skills') {
      const evolutionEngine = new EvolutionEngine();
      const skills = Array.from(evolutionEngine.skills.entries());
      
      console.log('\n[Evolution Skills]');
      if (skills.length === 0) {
        console.log('  暂无已学习技能');
      } else {
        skills.forEach(([name, skill], i) => {
          console.log(`  ${i + 1}. ${skill.name}`);
          console.log(`     描述: ${skill.description}`);
          console.log(`     成功率: ${(skill.successRate * 100).toFixed(1)}%`);
          console.log(`     任务数: ${skill.tasks}`);
          console.log('');
        });
      }
    }
    else if (subCmd === 'experiences' || subCmd === 'exp' || subCmd === 'history') {
      const evolutionEngine = new EvolutionEngine();
      const experiences = evolutionEngine.experiences.slice(-10); // 最近10条
      
      console.log('\n[Evolution Experiences (最近10条)]');
      if (experiences.length === 0) {
        console.log('  暂无历史经验');
      } else {
        experiences.reverse().forEach((exp, i) => {
          const successStr = exp.success ? '✓' : '✗';
          const taskPreview = exp.task.length > 30 ? exp.task.substring(0, 30) + '...' : exp.task;
          console.log(`  ${i + 1}. [${successStr}] ${taskPreview}`);
        });
      }
    }
    else {
      console.log('Unknown subcommand. Use: evolution [stats|skills|experiences]');
    }
  },
  
  /**
   * 记忆管理命令
   */
  async memory(args) {
    const subCmd = args[0]?.toLowerCase();
    const memory = new EvolutionMemory();
    
    if (subCmd === 'save' || subCmd === 'remember' || !subCmd) {
      // memory save <key> <value> - 保存记忆
      if (args.length >= 2) {
        const key = args[1];
        const value = args.slice(2).join(' ') || 'true';
        
        memory.remember(key, value, { source: 'manual' });
        console.log(`\n✓ 记住了: ${key}\n`);
      } else {
        console.log('\nUsage: memory save <key> <value>');
        console.log('Example: memory save project-status "正在开发进化引擎"');
        console.log('');
      }
    }
    else if (subCmd === 'recall' || subCmd === 'get') {
      // memory recall <key> - 回忆信息
      if (args.length >= 2) {
        const key = args[1];
        const result = memory.recall(key);
        
        if (result) {
          console.log(`\n[Memory] ${key}:`);
          console.log(`  Value: ${typeof result.value === 'object' ? JSON.stringify(result.value, null, 2) : result.value}`);
          console.log(`  Updated: ${new Date(result.timestamp).toLocaleString()}`);
          console.log('');
        } else {
          console.log(`\n✗ 未找到记忆: ${key}\n`);
        }
      } else {
        console.log('\nUsage: memory recall <key>');
        console.log('Example: memory recall project-status');
        console.log('');
      }
    }
    else if (subCmd === 'search' || subCmd === 'find') {
      // memory search <query> - 搜索记忆
      if (args.length >= 2) {
        const query = args.slice(1).join(' ');
        const results = memory.search(query, { limit: 10 });
        
        console.log(`\n[Memory Search Results for "${query}"]`);
        if (results.length === 0) {
          console.log('  没有找到匹配的记忆');
        } else {
          results.forEach((r, i) => {
            const preview = typeof r.value === 'object' ? 
              JSON.stringify(r.value).substring(0, 60) + '...' : 
              (r.value || '').toString().substring(0, 60) + '...';
            console.log(`  ${i + 1}. ${r.key}: ${preview}`);
          });
        }
        console.log('');
      } else {
        console.log('\nUsage: memory search <query>');
        console.log('Example: memory search progress');
        console.log('');
      }
    }
    else if (subCmd === 'list' || subCmd === 'ls') {
      // memory list - 列出所有记忆
      const keys = memory.getAllKeys();
      
      console.log('\n[All Memories]');
      if (keys.length === 0) {
        console.log('  暂无记忆');
      } else {
        keys.forEach((key, i) => {
          const entry = memory.recall(key);
          const preview = typeof entry.value === 'object' ? 
            JSON.stringify(entry.value).substring(0, 40) + '...' : 
            (entry.value || '').toString().substring(0, 40) + '...';
          console.log(`  ${i + 1}. ${key}: ${preview}`);
        });
      }
      console.log('');
    }
    else if (subCmd === 'progress') {
      // memory progress <task> [status] [details] - 管理进度
      if (args.length >= 2) {
        const task = args[1];
        const status = args[2] || 'in-progress';
        const details = args.slice(3).join(' ') || '';
        
        if (args.length >= 3) {
          // 更新进度
          memory.updateProgress(task, status, { details, timestamp: Date.now() });
          console.log(`\n✓ 更新进度: ${task} -> ${status}\n`);
        } else {
          // 获取进度
          const progress = memory.getProgress(task);
          if (progress) {
            console.log(`\n[Progress] ${task}:`);
            console.log(`  Status: ${progress.value.status}`);
            console.log(`  Details: ${progress.value.details.details || 'N/A'}`);
            console.log(`  Updated: ${new Date(progress.value.updatedAt).toLocaleString()}`);
            console.log('');
          } else {
            console.log(`\n✗ 未找到进度: ${task}\n`);
          }
        }
      } else {
        console.log('\nUsage: memory progress <task> [status] [details]');
        console.log('Example: memory progress "进化引擎开发" completed "已完成基本功能"');
        console.log('');
      }
    }
    else if (subCmd === 'stats') {
      // memory stats - 查看记忆统计
      const stats = memory.getStats();
      
      console.log('\n[Memory Stats]');
      console.log(`  Total memories: ${stats.totalMemories}`);
      console.log(`  Keys: ${stats.keys.length}`);
      if (stats.keys.length > 0) {
        console.log(`  Recent: ${stats.keys.slice(0, 5).join(', ')}`);
      }
      console.log('');
    }
    else {
      console.log('\n[Memory Commands]');
      console.log('  memory save <key> <value>     保存记忆');
      console.log('  memory recall <key>           回忆信息');
      console.log('  memory search <query>         搜索记忆');
      console.log('  memory list                   列出所有记忆');
      console.log('  memory progress <task> [st]   管理进度');
      console.log('  memory stats                  查看统计');
      console.log('');
    }
  },

  /**
   * 安全相关命令
   */
  async security(args) {
    const subCmd = args[0]?.toLowerCase();
    
    if (subCmd === 'status' || subCmd === 'report' || !subCmd) {
      // security status - 显示安全报告
      const report = securityManager.getSecurityReport();
      
      console.log('\n╔═══════════════════════════════════════════════════════════╗');
      console.log('║                    SECURITY STATUS                        ║');
      console.log('╚═══════════════════════════════════════════════════════════╝\n');
      
      console.log(`  Active Sessions: ${report.totalSessions}`);
      console.log(`  Total Commands: ${report.totalCommands}`);
      console.log(`  Blocked Actions: ${report.sandboxReport.blockedActions}`);
      console.log(`  Security Violations: ${report.sandboxReport.securityViolations}`);
      console.log(`  Current Iteration: ${report.sandboxReport.currentIteration}/${report.sandboxReport.maxIterations}`);
      
      if (report.sandboxReport.recentActions.length > 0) {
        console.log('\n  Recent Actions:');
        report.sandboxReport.recentActions.slice(-5).forEach((action, i) => {
          const status = action.success ? '✓' : '✗';
          const cmdPreview = action.command.length > 30 ? action.command.substring(0, 30) + '...' : action.command;
          console.log(`    ${status} ${cmdPreview}`);
        });
      }
      
      console.log('\n  Commands:');
      console.log('    security status     查看安全状态');
      console.log('    security config     查看安全配置');
      console.log('    security test       测试安全功能');
      console.log('');
    }
    else if (subCmd === 'config') {
      // security config - 显示安全配置
      const config = securityManager.getSecurityConfig();
      
      console.log('\n[Security Configuration]');
      console.log(`  Max Timeout: ${config.maxTimeout}ms`);
      console.log(`  Max Output Lines: ${config.maxOutputLines}`);
      console.log(`  Max Memory: ${config.maxMemory}`);
      console.log(`  Max CPU: ${config.maxCpu}`);
      console.log('');
      
      console.log(`  Blacklisted Commands (${config.blacklistedCommands.length}):`);
      console.log(`    ${config.blacklistedCommands.slice(0, 10).join(', ')}${config.blacklistedCommands.length > 10 ? '...' : ''}`);
      console.log('');
      
      console.log(`  Whitelisted Commands (${config.whitelistedCommands.length}):`);
      console.log(`    ${config.whitelistedCommands.slice(0, 10).join(', ')}${config.whitelistedCommands.length > 10 ? '...' : ''}`);
      console.log('');
    }
    else if (subCmd === 'test') {
      // security test - 测试安全功能
      console.log('\n[Security Test]');
      
      try {
        // 测试安全检查
        const testResults = [];
        
        // 测试黑名单命令
        const blacklistTest = securityManager.sandbox.securityCheck('rm -rf /');
        testResults.push({ name: 'Blacklist Check', passed: !blacklistTest.allowed, result: blacklistTest.reason });
        
        // 测试白名单命令
        const whitelistTest = securityManager.sandbox.securityCheck('ls -la');
        testResults.push({ name: 'Whitelist Check', passed: whitelistTest.allowed, result: whitelistTest.reason });
        
        // 输出测试结果
        testResults.forEach(test => {
          const status = test.passed ? '✓' : '✗';
          console.log(`  ${status} ${test.name}: ${test.result}`);
        });
        
        console.log('\n  Security system is functioning properly!\n');
      } catch (error) {
        console.log(`\n  ✗ Security test failed: ${error.message}\n`);
      }
    }
    else {
      console.log('\n[Security Commands]');
      console.log('  security status     查看安全状态');
      console.log('  security config     查看安全配置');
      console.log('  security test       测试安全功能');
      console.log('');
    }
  },

  /**
   * 系统健康和稳定性相关命令
   */
  async health(args) {
    const subCmd = args[0]?.toLowerCase();
    
    if (subCmd === 'status' || subCmd === 'stats' || !subCmd) {
      // 显示系统健康状态
      const { getEnhancedStabilitySystem } = await import('../core/enhanced-stability-system.js');
      const stabilitySystem = getEnhancedStabilitySystem();
      
      try {
        const healthResult = await stabilitySystem.runHealthCheck();
        const systemStatus = stabilitySystem.getSystemStatus();
        
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║                    SYSTEM HEALTH                        ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
        
        console.log(`  Overall Status: ${healthResult.status.toUpperCase()}`);
        console.log(`  Components: ${systemStatus.components.length}`);
        console.log(`  Uptime: ${Math.floor((Date.now() - systemStatus.timestamp)/1000)}s`);
        console.log('');
        
        console.log('  Health Checks:');
        for (const [name, result] of Object.entries(healthResult.results)) {
          const status = result.healthy !== false ? '✓' : '✗';
          console.log(`    ${status} ${name}: ${result.healthy !== false ? 'OK' : 'FAILED'}`);
        }
        
        if (systemStatus.performance) {
          console.log('\n  Performance Metrics:');
          console.log(`    Requests: ${systemStatus.performance.requests}`);
          console.log(`    Avg Response Time: ${systemStatus.performance.avgResponseTime}ms`);
          console.log(`    Error Rate: ${(systemStatus.performance.errorRate * 100).toFixed(2)}%`);
        }
        
        if (systemStatus.memory) {
          console.log('\n  Memory Stats:');
          console.log(`    Sessions: ${systemStatus.memory.sessionCount}`);
          console.log(`    Cache: ${systemStatus.memory.cacheCount}`);
        }
        
        console.log('\n  Commands:');
        console.log('    health status     显示系统健康状态');
        console.log('    health detailed   显示详细健康信息');
        console.log('');
      } catch (error) {
        console.log('\n✗ 无法获取系统健康状态:', error.message);
      }
    }
    else if (subCmd === 'detailed') {
      // 显示详细健康信息
      const { getEnhancedStabilitySystem } = await import('../core/enhanced-stability-system.js');
      const stabilitySystem = getEnhancedStabilitySystem();
      
      try {
        const systemStatus = stabilitySystem.getSystemStatus();
        
        console.log('\n[Detailed System Status]');
        console.log(JSON.stringify(systemStatus, null, 2));
        console.log('');
      } catch (error) {
        console.log('\n✗ 无法获取详细状态:', error.message);
      }
    }
    else {
      console.log('\n[System Health Commands]');
      console.log('  health status     显示系统健康状态');
      console.log('  health detailed   显示详细健康信息');
      console.log('');
    }
  },

  /**
   * 社交网络相关命令
   */
  async social(args) {
    const subCmd = args[0]?.toLowerCase();
    
    if (subCmd === 'status' || subCmd === 'stats' || !subCmd) {
      // social status - 显示社交网络状态
      const connector = socialConnector;
      const stats = connector.getStats();
      
      console.log('\n╔═══════════════════════════════════════════════════════════╗');
      console.log('║                    SOCIAL NETWORK                         ║');
      console.log('╚═══════════════════════════════════════════════════════════╝\n');
      
      console.log(`  连人数量: ${stats.totalHumans}`);
      console.log(`  AI化身数量: ${stats.totalAvatars}`);
      console.log(`  社区数量: ${stats.totalCommunities}`);
      console.log(`  已处理消息: ${stats.messagesProcessed}`);
      console.log(`  获取知识: ${stats.knowledgeAcquired}`);
      console.log(`  在线真人: ${stats.onlineHumans}`);
      console.log(`  在线化身: ${stats.onlineAvatars}`);
      
      console.log('\n  Commands:');
      console.log('    social status     查看社交网络状态');
      console.log('    social humans     查看真人列表');
      console.log('    social avatars    查看AI化身列表');
      console.log('    social communities 查看社区列表');
      console.log('    social knowledge  查看知识网络');
      console.log('');
    }
    else if (subCmd === 'humans') {
      // social humans - 查看真人列表
      console.log('\n[Real Humans]');
      const humans = Array.from(socialConnector.humans.values());
      
      if (humans.length === 0) {
        console.log('  暂无真人连接');
      } else {
        humans.forEach((human, i) => {
          console.log(`  ${i + 1}. ${human.id}`);
          console.log(`     声誉值: ${human.reputation}`);
          console.log(`     知识贡献: ${human.knowledgeContribution}`);
          console.log(`     AI化身数: ${human.avatarCount}`);
        });
      }
      console.log('');
    }
    else if (subCmd === 'avatars') {
      // social avatars - 查看AI化身列表
      console.log('\n[AI Avatars]');
      const avatars = Array.from(socialConnector.avatars.values());
      
      if (avatars.length === 0) {
        console.log('  暂无AI化身');
      } else {
        avatars.forEach((avatar, i) => {
          console.log(`  ${i + 1}. ${avatar.id}`);
          console.log(`     所有者: ${avatar.ownerId}`);
          console.log(`     类型: ${avatar.type}`);
          console.log(`     领域: ${avatar.knowledgeDomain}`);
          console.log(`     交互次数: ${avatar.interactionCount}`);
        });
      }
      console.log('');
    }
    else if (subCmd === 'communities') {
      // social communities - 查看社区列表
      console.log('\n[Communities]');
      const communities = Array.from(socialConnector.communities.values());
      
      if (communities.length === 0) {
        console.log('  暂无社区');
      } else {
        communities.forEach((community, i) => {
          console.log(`  ${i + 1}. ${community.name}`);
          console.log(`     话题: ${community.topic}`);
          console.log(`     成员: ${community.memberCount}真人, ${community.avatarCount}化身`);
          console.log(`     活跃度: ${community.activityLevel}`);
          console.log(`     创建于: ${new Date(community.createdAt).toLocaleDateString()}`);
        });
      }
      console.log('');
    }
    else if (subCmd === 'knowledge') {
      // social knowledge - 查看知识网络
      const query = args.slice(1).join(' ') || null;
      const kn = knowledgeNetwork;
      const knStats = kn.getStats();
      
      console.log('\n[Knowledge Network]');
      console.log(`  总知识量: ${knStats.totalKnowledge}`);
      console.log(`  已验证知识: ${knStats.validatedKnowledge}`);
      console.log(`  知识来源: ${knStats.knowledgeSources}`);
      console.log(`  专家数量: ${knStats.expertCount}`);
      console.log(`  主题数量: ${knStats.topicCount}`);
      console.log(`  知识图谱大小: ${knStats.knowledgeGraphSize}`);
      
      if (query) {
        console.log(`\n  搜索 "${query}" 的结果:`);
        const results = kn.getKnowledge(query, { limit: 5 });
        if (results.length === 0) {
          console.log('    未找到相关知识');
        } else {
          results.forEach((result, i) => {
            console.log(`    ${i + 1}. ${result.processed.title || result.processed.summary || result.original.title || 'Untitled'}`);
            console.log(`       可信度: ${(result.validationScore * 100).toFixed(1)}%`);
            console.log(`       来源: ${result.context.source}`);
          });
        }
      }
      console.log('');
    }
    else {
      console.log('\n[Social Network Commands]');
      console.log('  social status       查看社交网络状态');
      console.log('  social humans       查看真人列表');
      console.log('  social avatars      查看AI化身列表');
      console.log('  social communities  查看社区列表');
      console.log('  social knowledge    查看知识网络');
      console.log('');
    }
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

/**
 * Auto-routes unknown input to AI chat with clear feedback
 * Auto-creates session if none exists
 */
async function routeToAI(cmd, args) {
  const message = args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd;

  // Auto-create session if none exists
  const sessions = sessionManager.listSessions();
  if (sessions.length === 0) {
    const provider = persistentConfig.getPreference('currentProvider');
    if (!provider) {
      console.log('\n✗ No provider set. Use "provider <name>" to select one first.\n');
      return;
    }
    const apiKey = persistentConfig.getApiKey(provider);
    if (!apiKey) {
      console.log(`\n✗ No API key for ${provider}. Set with: config set ${provider} <api_key>\n`);
      return;
    }
    // Only add provider if not already connected
    const existingProvider = sessionManager.getProvider(provider);
    if (!existingProvider || !existingProvider.connected) {
      try {
        await sessionManager.addProvider(provider, apiKey);
      } catch (e) {
        // Provider may already exist, try to continue
      }
    }
    const model = persistentConfig.getPreference('currentModel');
    try {
      const session = await sessionManager.createSession(provider, model);
    } catch (e) {
      console.log(`\n✗ Failed to create session: ${e.message}\n`);
      return;
    }
  }

  console.log('\n  → AI...\n');
  await commands.c([message]);
}

export async function executeCommand(input) {
  // Silent NLP processing - never print [NL Parser] messages
  const processed = processInput(input);
  if (processed && processed !== input) {
    input = processed;
  }

  const parsed = parseCommand(input);
  if (!parsed) return;

  const { cmd, args } = parsed;

  // Flat command dispatcher - no nested switches
  switch (cmd) {
    // ── Core: AI Chat ──────────────────────────────────────────────
    case 'chat':
    case 'send':
      await commands.chat(args);
      break;

    // ── Core: Model ────────────────────────────────────────────────
    case 'model':
    case 'models':
    case 'm':
      await commands.model(args);
      break;

    // ── Core: Provider ─────────────────────────────────────────────
    case 'provider':
    case 'providers':
    case 'p':
      await commands.provider(args);
      break;

    // ── Core: Connect ─────────────────────────────────────────────
    case 'connect':
    case 'conn':
      await commands.connect(args);
      break;

    // ── Core: Agent ───────────────────────────────────────────────
    case 'agent':
    case 'agents':
    case 'a':
      await commands.agentCmd(args);
      break;

    // ── Core: Memory ───────────────────────────────────────────────
    case 'mem':
    case 'memory':
      await commands.memCmd(args);
      break;

    // ── Core: Status ───────────────────────────────────────────────
    case 'status':
    case 'stat':
    case 's':
      commands.status();
      break;

    // ── Core: Help ─────────────────────────────────────────────────
    case 'help':
    case '?':
      commands.help();
      break;

    // ── Expert: Config ─────────────────────────────────────────────
    case 'config':
    case 'cfg':
      commands.config(args);
      break;

    // ── Expert: Upgrade ───────────────────────────────────────────
    case 'upgrade':
      await commands.provider(['--sync-all']);
      break;

    // ── Expert: Vector (RAG) ──────────────────────────────────────
    case 'vector':
    case 'vec':
      await commands.vector(args);
      break;

    // ── Expert: Evolution ─────────────────────────────────────────
    case 'evolution':
    case 'evolve':
      await commands.evolution(args);
      break;

    // ── Expert: Security ───────────────────────────────────────────
    case 'security':
    case 'secure':
      await commands.security(args);
      break;

    // ── Expert: Social ─────────────────────────────────────────────
    case 'social':
    case 'socialize':
      await commands.social(args);
      break;

    // ── Utility ────────────────────────────────────────────────────
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

    // ── Shortcuts ──────────────────────────────────────────────────
    case 'c':
      // 'c' is a shortcut for direct chat (same as typing message)
      if (args.length > 0) {
        await commands.c(args);
      } else {
        // No message provided - prompt user
        console.log('\n  Type: c <message>\n');
      }
      break;

    case 'new':
      await commands.sessionCreate(args);
      break;

    // ── Unknown → Auto AI Chat ─────────────────────────────────────
    default:
      // Check if it's a number (provider selection shortcut)
      const num = parseInt(cmd);
      if (!isNaN(num) && num >= 1 && num <= 99) {
        await commands.model([cmd]);
        return;
      }
      // Check if it's a prefixed multi-word command that was split
      if (cmd.startsWith('provider ') || cmd.startsWith('session ') || cmd.startsWith('chat ')) {
        const subParts = cmd.split(' ');
        const subCmd = subParts[0];
        const combinedArgs = [...subParts.slice(1), ...args];
        await executeCommand(`${subCmd} ${combinedArgs.join(' ')}`);
      } else {
        await routeToAI(cmd, args);
      }
  }
}
