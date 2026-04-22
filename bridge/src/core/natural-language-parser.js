const COMMAND_ALIASES = {
  // Navigation
  'help': { action: 'help' },
  '?': { action: 'help' },
  'status': { action: 'status' },
  's': { action: 'status' },
  'exit': { action: 'exit' },
  'quit': { action: 'exit' },
  'q': { action: 'exit' },
  'clear': { action: 'clear' },
  'cls': { action: 'clear' },

  // Core commands
  'm': { action: 'model' },
  'model': { action: 'model' },
  'models': { action: 'model' },
  'p': { action: 'provider' },
  'provider': { action: 'provider' },
  'providers': { action: 'provider' },
  'connect': { action: 'connect' },
  'conn': { action: 'connect' },
  'a': { action: 'agent' },
  'agent': { action: 'agent' },
  'agents': { action: 'agent' },
  'mem': { action: 'mem' },
  'memory': { action: 'mem' },

  // Expert commands
  'cfg': { action: 'config' },
  'cfg set': { action: 'config_set' },
  'cfg get': { action: 'config_get' },
  'cfg list': { action: 'config_list' },
  'upgrade': { action: 'upgrade' },
  'vector': { action: 'vector' },
  'vec': { action: 'vector' },
  'security': { action: 'security' },
  'secure': { action: 'security' },
  'social': { action: 'social' },
  'evolution': { action: 'evolution' },
  'evolve': { action: 'evolution' },

  // Shortcuts
  'new': { action: 'new' },
  'c ': { action: 'chat' },
  'chat ': { action: 'chat' },
  'send ': { action: 'chat' },
};

const PROVIDER_ALIASES = {
  // Common short aliases
  'sf': 'siliconflow', 'siliconflow': 'siliconflow',
  'ds': 'deepseek', 'deepseek': 'deepseek',
  'openai': 'openai', 'openai': 'openai',
  'anthropic': 'anthropic', 'claude': 'anthropic',
  'groq': 'groq',
  'ollama': 'ollama',
  'lmstudio': 'lmstudio',
  'mistral': 'mistral',
  'xai': 'xai',
  'cohere': 'cohere',
  'replicate': 'replicate',
  'together': 'together',
  'fireworks': 'fireworks',
  'perplexity': 'perplexity',
  'gemini': 'google',
  'google': 'google',
  'azure': 'azure',
  'openrouter': 'openrouter',
  'minimax': 'minimax',
  'baidu': 'baidu',
  'zhipu': 'zhipu',
  'alibaba': 'alibaba',
  'moonshot': 'moonshot',
};

export class NaturalLanguageParser {
  constructor() {
    this.providers = [];
  }

  parse(input) {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const lower = trimmed.toLowerCase();

    if (COMMAND_ALIASES[trimmed] || COMMAND_ALIASES[lower]) {
      const config = COMMAND_ALIASES[trimmed] || COMMAND_ALIASES[lower];
      return this.buildCommand(config);
    }

    for (const [alias, config] of Object.entries(COMMAND_ALIASES)) {
      if (lower.startsWith(alias.toLowerCase())) {
        const remainder = trimmed.slice(alias.length).trim();
        return this.buildCommand(config, remainder);
      }
    }

    if (this.isDirectCommand(trimmed)) {
      return { type: 'direct', original: trimmed };
    }

    return { type: 'direct', original: trimmed };
  }

  isDirectCommand(input) {
    // Commands that should be treated as direct (passthrough)
    const directCommands = [
      'help', '?', 'status', 's', 'exit', 'quit', 'q', 'clear', 'cls',
      'm', 'model', 'models', 'p', 'provider', 'providers',
      'connect', 'conn', 'a', 'agent', 'agents',
      'mem', 'memory', 'cfg', 'config',
      'upgrade', 'vector', 'vec', 'security', 'social', 'evolution', 'evolve',
      'new', 'c', 'chat', 'send'
    ];
    const lower = input.toLowerCase();
    // Check exact match or prefix (e.g. "m" matches, "model foo" matches via prefix)
    return directCommands.some(cmd =>
      lower === cmd || lower.startsWith(cmd + ' ')
    );
  }

  detectProvider(input) {
    const lower = input.toLowerCase();
    for (const [pattern, provider] of Object.entries(PROVIDER_ALIASES)) {
      if (lower.includes(pattern)) {
        return provider;
      }
    }
    return input.split(/\s+/)[0].toLowerCase();
  }

  buildCommand(config, remainder = '') {
    const result = { type: 'command', action: config.action, original: remainder };

    switch (config.action) {
      case 'provider':
        if (remainder) {
          result.provider = this.detectProvider(remainder);
          const apiKeyMatch = remainder.match(/sk-[a-zA-Z0-9-]{20,}/);
          if (apiKeyMatch) result.apiKey = apiKeyMatch[0];
        }
        break;
      case 'model':
        if (remainder) {
          const parts = remainder.split(/\s+/);
          if (parts.length >= 1) result.provider = this.detectProvider(parts[0]);
          if (parts.length >= 2) result.model = parts.slice(1).join(' ') || null;
        }
        break;
      case 'connect':
        if (remainder) {
          const parts = remainder.split(/\s+/);
          result.provider = this.detectProvider(parts[0]);
          if (parts.length >= 2) result.apiKey = parts[1];
        }
        break;
      case 'agent':
        result.task = remainder;
        break;
      case 'new':
        result.provider = remainder || null;
        break;
      case 'config_set':
        const setParts = remainder.split(/\s+/);
        if (setParts.length >= 2) {
          result.key = setParts[0];
          result.value = setParts.slice(1).join(' ');
        }
        break;
      case 'config_get':
        result.key = remainder;
        break;
    }

    return result;
  }

  toCommandString(parsed) {
    if (parsed.type === 'direct') {
      return parsed.original;
    }

    switch (parsed.action) {
      case 'help':
      case 'status':
      case 'exit':
      case 'clear':
      case 'upgrade':
        return parsed.action;
      case 'model':
        return parsed.model ? `m ${parsed.provider} ${parsed.model}` : 'm';
      case 'provider':
        return parsed.provider ? `p ${parsed.provider}` : 'p';
      case 'connect':
        return parsed.apiKey ? `connect ${parsed.provider} ${parsed.apiKey}` : `connect ${parsed.provider}`;
      case 'agent':
        return `a ${parsed.task}`;
      case 'new':
        return parsed.provider ? `new ${parsed.provider}` : 'new';
      case 'mem':
        return 'mem';
      case 'config':
        return parsed.original ? `cfg ${parsed.original}` : 'cfg';
      case 'config_set':
        return `cfg set ${parsed.key} ${parsed.value}`;
      case 'config_get':
        return `cfg get ${parsed.key}`;
      case 'config_list':
        return 'cfg list';
      case 'vector':
      case 'security':
      case 'social':
      case 'evolution':
        return parsed.original || parsed.action;
      default:
        return parsed.original;
    }
  }
}

export const naturalLanguageParser = new NaturalLanguageParser();

export function parseNaturalLanguage(input) {
  return naturalLanguageParser.parse(input);
}

export function toCommandString(parsed) {
  return naturalLanguageParser.toCommandString(parsed);
}

export function processInput(input) {
  const parsed = parseNaturalLanguage(input);
  if (!parsed) return null;
  if (parsed.type === 'direct') return parsed.original;
  return toCommandString(parsed);
}