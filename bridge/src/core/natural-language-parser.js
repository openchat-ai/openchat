const COMMAND_ALIASES = {
  'status': { action: 'status' },
  'help': { action: 'help' },
  'exit': { action: 'exit' },
  'quit': { action: 'exit' },
  'clear': { action: 'clear' },

  'providers': { action: 'provider_list' },
  'ls providers': { action: 'provider_list' },

  'models': { action: 'model_list' },
  'ls models': { action: 'model_list' },

  'use': { action: 'provider_add' },
  'use siliconflow': { action: 'provider_add', provider: 'siliconflow' },
  'use deepseek': { action: 'provider_add', provider: 'deepseek' },
  'use openai': { action: 'provider_add', provider: 'openai' },
  'use groq': { action: 'provider_add', provider: 'groq' },

  'switch': { action: 'model_switch' },

  'new': { action: 'session_create' },
  'sessions': { action: 'session_list' },

  'spawn': { action: 'agent_spawn' },
  'agents': { action: 'agent_list' },
  'parallel': { action: 'parallel_mode' },
  'do': { action: 'agent_task' },

  'config': { action: 'config' },
  'upgrade': { action: 'upgrade' },
};

const PROVIDER_ALIASES = {
  'sf': 'siliconflow',
  'siliconflow': 'siliconflow',
  'ds': 'deepseek',
  'deepseek': 'deepseek',
  'openai': 'openai',
  'groq': 'groq',
  'ollama': 'ollama',
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
    const directCommands = ['help', 'status', 'clear', 'exit', 'quit', 'q', 'c ', 'chat ', 'provider ', 'session ', 'agent ', 'config ', 'models', 'upgrade', 'switch '];
    return directCommands.some(cmd => input.toLowerCase().startsWith(cmd));
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
      case 'provider_add':
        if (config.provider) {
          result.provider = config.provider;
        } else if (remainder) {
          result.provider = this.detectProvider(remainder);
          const apiKeyMatch = remainder.match(/sk-[a-zA-Z0-9-]{20,}/);
          if (apiKeyMatch) result.apiKey = apiKeyMatch[0];
        }
        break;
      case 'session_create':
        result.provider = remainder || null;
        break;
      case 'agent_task':
        result.task = remainder;
        break;
      case 'agent_spawn':
        result.name = remainder || null;
        break;
      case 'model_switch':
        if (remainder) {
          const parts = remainder.split(/\s+/);
          result.provider = this.detectProvider(parts[0]);
          result.model = parts.slice(1).join(' ') || null;
        }
        break;
    }

    return result;
  }

  toCommandString(parsed) {
    if (parsed.type === 'direct') {
      return parsed.original;
    }

    switch (parsed.action) {
      case 'status':
        return 'status';
      case 'help':
        return 'help';
      case 'exit':
        return 'exit';
      case 'clear':
        return 'clear';
      case 'provider_list':
        return 'providers';
      case 'provider_add':
        if (parsed.apiKey) {
          return `provider add ${parsed.provider} ${parsed.apiKey}`;
        }
        return `use ${parsed.provider}`;
      case 'session_create':
        return parsed.provider ? `new ${parsed.provider}` : 'new';
      case 'session_list':
        return 'sessions';
      case 'agent_spawn':
        return parsed.name ? `spawn ${parsed.name}` : 'spawn';
      case 'agent_list':
        return 'agents';
      case 'agent_task':
      case 'parallel_mode':
        return `parallel ${parsed.task || parsed.original}`;
      case 'model_list':
        return parsed.provider ? `models ${parsed.provider}` : 'models';
      case 'model_switch':
        if (parsed.provider && parsed.model) {
          return `switch ${parsed.provider} ${parsed.model}`;
        }
        return 'switch';
      case 'config':
        return parsed.original ? `config ${parsed.original}` : 'config';
      case 'upgrade':
        return 'upgrade';
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