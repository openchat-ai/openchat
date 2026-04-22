import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_PATH = path.join(__dirname, '../config/provider-models.json');

// 服务商配置
export let PRESET_PROVIDERS = {};
let _defaultProvider = 'openrouter';

function loadProviders() {
  try {
    if (fs.existsSync(PROVIDERS_PATH)) {
      const data = fs.readFileSync(PROVIDERS_PATH, 'utf8');
      const loaded = JSON.parse(data);

      _defaultProvider = loaded._defaultProvider || 'openrouter';
      delete loaded._defaultProvider;

      Object.assign(PRESET_PROVIDERS, loaded);
    }
  } catch (e) {
    console.error('Failed to load providers:', e.message);
  }
}

// 自动从 nameCn 生成别名
function buildAliases() {
  const aliases = {};
  for (const [key, config] of Object.entries(PRESET_PROVIDERS)) {
    if (config.nameCn) {
      aliases[config.nameCn] = key;
    }
  }
  // 添加常用别名
  Object.assign(aliases, {
    'kimi': 'kimi-for-coding',
    'moonshot': 'kimi-for-coding',
    'ollama': 'ollama-cloud',
    'claude': 'anthropic',
    'qwen': 'alibaba',
    'doubao': 'volc-engine'
  });
  return aliases;
}

loadProviders();

export const DEFAULT_PROVIDER = _defaultProvider;

export const PROVIDER_ALIASES = buildAliases();

export function saveProviders() {
  try {
    const data = {
      _defaultProvider,
      ...PRESET_PROVIDERS
    };
    fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save providers:', e.message);
    return false;
  }
}

export function updateProviderModels(providerKey, models) {
  if (PRESET_PROVIDERS[providerKey]) {
    PRESET_PROVIDERS[providerKey].models = models;
    PRESET_PROVIDERS[providerKey].updatedAt = new Date().toISOString();
    return saveProviders();
  }
  return false;
}

export function addProviderEntry(providerKey, config) {
  PRESET_PROVIDERS[providerKey] = config;
  return saveProviders();
}

function normalizeProvider(name) {
  if (!name) return name;
  const lower = name.toLowerCase();
  if (PROVIDER_ALIASES[lower]) return PROVIDER_ALIASES[lower];
  if (PROVIDER_ALIASES[name]) return PROVIDER_ALIASES[name];
  return name;
}

export const HERMES_STYLE_OVERLAYS = {
  openrouter: {
    name: 'OpenRouter',
    nameCn: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'openrouter/auto',
    transport: 'openai_chat',
    isAggregator: true,
    authType: 'api_key',
    envVars: ['OPENAI_API_KEY'],
    description: '200+ 模型聚合，支持 OpenAI 兼容格式'
  },
  anthropic: {
    name: 'Anthropic',
    nameCn: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    chatEndpoint: '/messages',
    defaultModel: 'claude-3-5-sonnet-20241022',
    transport: 'anthropic_messages',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['ANTHROPIC_API_KEY'],
    description: 'Anthropic Claude 系列模型'
  },
  openai: {
    name: 'OpenAI',
    nameCn: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'gpt-4o-mini',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['OPENAI_API_KEY'],
    description: 'OpenAI GPT 系列模型'
  },
  deepseek: {
    name: 'DeepSeek',
    nameCn: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'deepseek-chat',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['DEEPSEEK_API_KEY'],
    description: 'DeepSeek 官方 API'
  },
  groq: {
    name: 'Groq',
    nameCn: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'llama-3.1-70b-versatile',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['GROQ_API_KEY'],
    description: '超低延迟推理'
  },
  zai: {
    name: 'ZAI',
    nameCn: 'ZAI',
    baseUrl: 'https://api.z-ai.cn/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'z-ai/zephyr-7b-beta',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['ZAI_API_KEY'],
    description: 'ZAI 平台'
  },
  'kimi-for-coding': {
    name: 'Kimi',
    nameCn: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['MOONSHOT_API_KEY'],
    description: 'Kimi Moonshot AI'
  },
  xai: {
    name: 'xAI',
    nameCn: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'xai/grok-2',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['XAI_API_KEY'],
    description: 'xAI Grok 系列'
  },
  huggingface: {
    name: 'HuggingFace',
    nameCn: 'HuggingFace',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'meta-llama/Llama-3.1-70B-Instruct',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['HF_API_KEY'],
    description: 'HuggingFace 推理端点'
  },
  vercel: {
    name: 'Vercel',
    nameCn: 'Vercel AI',
    baseUrl: 'https://api.vercel.com/v1',
    chatEndpoint: '/ai/create',
    defaultModel: 'ai',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['VERCEL_API_KEY'],
    description: 'Vercel AI SDK'
  },
  'github-copilot': {
    name: 'GitHub Copilot',
    nameCn: 'GitHub Copilot',
    baseUrl: 'https://api.githubcopilot.com/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'gpt-4',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'github_token',
    envVars: ['GITHUB_TOKEN'],
    description: 'GitHub Copilot'
  },
  siliconflow: {
    name: 'SiliconFlow',
    nameCn: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['SILICONFLOW_API_KEY'],
    description: '硅基流动 API'
  },
  alibaba: {
    name: 'Alibaba Qwen',
    nameCn: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'qwen-plus',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['DASHSCOPE_API_KEY'],
    description: '阿里云通义千问'
  },
  opencode: {
    name: 'OpenCode Go',
    nameCn: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'glm-5.1',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['OPENCODE_API_KEY'],
    description: 'OpenCode Go 免费模型'
  },
  'opencode-zen': {
    name: 'OpenCode Zen',
    nameCn: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'opencode/big-pickle',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['OPENCODE_API_KEY'],
    description: 'OpenCode Zen 付费模型（需充值）'
  },
  kilo: {
    name: 'KiloCode',
    nameCn: 'KiloCode',
    baseUrl: 'https://api.kilocode.ai/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'kilo/code-8b',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['KILO_API_KEY'],
    description: 'KiloCode 代码模型'
  },
  xiaomi: {
    name: 'Xiaomi MiMo',
    nameCn: '小米 MiMo',
    baseUrl: 'https://api.xiaomi.cn/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'xiaomi/mimo-7b',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['XIAOMI_API_KEY'],
    description: '小米 MiMo'
  },
  modal: {
    name: 'Modal',
    nameCn: 'Modal',
    baseUrl: 'https://api.us-west-2.modal.direct/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V3-2503',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['MODAL_API_KEY'],
    description: 'Modal Labs'
  },
  arcee: {
    name: 'Arcee',
    nameCn: 'Arcee',
    baseUrl: 'https://api.arcee.ai/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'arcee/coveron-7b',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['ARCEE_API_KEY'],
    description: 'Arcee AI'
  },
  lmstudio: {
    name: 'LM Studio',
    nameCn: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'local',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'none',
    envVars: [],
    description: '本地 LM Studio'
  },
  'ollama-cloud': {
    name: 'Ollama Cloud',
    nameCn: 'Ollama Cloud',
    baseUrl: 'https://api.ollama.ai/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'llama3.1:70b',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['OLLAMA_API_KEY'],
    description: 'Ollama Cloud'
  },
  iflow: {
    name: 'iFlow',
    nameCn: '心流',
    baseUrl: 'https://apis.iflow.cn/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'kimi-k2',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['IFLOW_API_KEY'],
    description: '阿里开源 AI 平台，支持多种国产模型'
  },
  'minimax-coding-plan': {
    name: 'MiniMax Coding Plan',
    nameCn: 'MiniMax Coding Plan',
    baseUrl: 'https://api.minimaxi.com/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'MiniMax-M2.7',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['MINIMAX_CODING_PLAN_KEY'],
    description: 'MiniMax Coding Plan 订阅套餐'
  },
  bailian: {
    name: 'Bailian',
    nameCn: '阿里云百炼',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'qwen3-coder-plus',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['DASHSCOPE_API_KEY'],
    description: '阿里云百炼 Coding Plan'
  },
  zhipu: {
    name: 'ZhipuAI',
    nameCn: '智谱GLM',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    chatEndpoint: '/chat/completions',
    defaultModel: 'glm-4',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['ZHIPU_API_KEY'],
    description: '智谱 GLM Coding Plan'
  },
  'volc-engine': {
    name: 'VolcEngine',
    nameCn: '火山引擎方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    chatEndpoint: '/chat/completions',
    defaultModel: 'doubao-seed-2.0-code',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['VOLC_API_KEY'],
    description: '字节跳动火山引擎方舟 Coding Plan'
  },
  'baidu-qianfan-coding-plan': {
    name: 'Baidu Qianfan Coding Plan',
    nameCn: '百度千帆 Coding Plan',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    chatEndpoint: '/coding/chat/completions',
    defaultModel: 'qianfan-code-latest',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['BAIDU_API_KEY'],
    description: '百度千帆大模型平台 Coding Plan'
  },
  'baidu-qianfan': {
    name: 'BaiduQianfan',
    nameCn: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'ernie-4.0-8k-latest',
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['QIANFAN_API_KEY'],
    description: '百度千帆 Coding Plan'
  },
  'sanhuang': {
    name: 'Sanhuang',
    nameCn: '三皇',
    baseUrl: 'http://101.133.166.236:21223',
    chatEndpoint: '/v1/chat/completions',
    defaultModel: 'glm-4.5-air',
    models: [
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.4',
      'gpt-5.4-2026-03-05',
      'gpt-5.4-mini',
      'MiniMax-M2',
      'MiniMax-M2.1',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.7',
      'glm-4.5-air'
    ],
    transport: 'openai_chat',
    isAggregator: false,
    authType: 'api_key',
    envVars: ['SANHUANG_API_KEY'],
    description: '三皇 AI 服务'
  }
};

export class ProviderManager {
  constructor() {
    this.customProviders = new Map();
  }

  getProviderConfig(name) {
    const canonical = normalizeProvider(name);
    // 从 PRESET_PROVIDERS (config/providers.json) 获取
    if (PRESET_PROVIDERS[canonical]) {
      return PRESET_PROVIDERS[canonical];
    }
    // 检查自定义服务商
    if (this.customProviders.has(canonical)) {
      return this.customProviders.get(canonical);
    }
    // 兼容旧的 HERMES_STYLE_OVERLAYS
    if (HERMES_STYLE_OVERLAYS[canonical]) {
      return HERMES_STYLE_OVERLAYS[canonical];
    }
    return null;
  }

  getProvider(name) {
    return this.getProviderConfig(name);
  }

  listProviders() {
    const result = [];
    const seen = new Set();

    // 从 PRESET_PROVIDERS (config/providers.json) 加载
    for (const [name, config] of Object.entries(PRESET_PROVIDERS)) {
      if (seen.has(name)) continue;
      seen.add(name);
      result.push({
        name,
        nameCn: config.nameCn || name,
        baseUrl: config.baseUrl || '',
        defaultModel: config.defaultModel || 'default',
        models: config.models || [],
        modelMeta: config.modelMeta || [],
        connected: !!(config.models && config.models.length > 0),
        transport: config.transport || 'openai_chat',
        isAggregator: config.isAggregator || false,
        description: config.description || '',
        envVars: config.envVars || []
      });
    }

    // 兼容旧的 HERMES_STYLE_OVERLAYS
    for (const [name, config] of Object.entries(HERMES_STYLE_OVERLAYS)) {
      if (seen.has(name)) continue;
      seen.add(name);
      result.push({
        name,
        nameCn: config.nameCn || config.name,
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel,
        models: [],
        modelMeta: [],
        connected: false,
        transport: config.transport || 'openai_chat',
        isAggregator: config.isAggregator || false,
        description: config.description || '',
        envVars: config.envVars || []
      });
    }

    // 添加自定义服务商
    for (const [name, config] of this.customProviders) {
      if (seen.has(name)) continue;
      seen.add(name);
      result.push({
        name,
        nameCn: config.nameCn || name,
        baseUrl: config.baseUrl,
        defaultModel: config.defaultModel || 'default',
        models: config.models || [],
        modelMeta: [],
        connected: false,
        transport: config.transport || 'openai_chat',
        isAggregator: false,
        description: config.description || '',
        envVars: []
      });
    }

    return result;
  }

  _mergeProvider(name, overlay) {
    const saved = PRESET_PROVIDERS[name] || {};
    return {
      ...overlay,
      nameCn: saved.nameCn || overlay.nameCn || overlay.name,
      name: overlay.name,
      baseUrl: saved.baseUrl || overlay.baseUrl,
      defaultModel: saved.defaultModel || overlay.defaultModel,
      description: saved.description || overlay.description
    };
  }

  listModels(providerName) {
    const config = this.getProviderConfig(providerName);
    if (!config) return [];
    return config.models && config.models.length > 0
      ? config.models
      : [config.defaultModel].filter(Boolean);
  }

  addCustomProvider(name, baseUrl, apiKey, model = null) {
    this.customProviders.set(name, {
      nameCn: name,
      baseUrl,
      chatEndpoint: '/chat/completions',
      defaultModel: model,
      models: model ? [model] : [],
      apiKey
    });
  }

  getDefaultModel(providerName) {
    const config = this.getProviderConfig(providerName);
    if (!config) return 'default';
    return config.defaultModel || 'default';
  }

  getBaseUrl(providerName) {
    const config = this.getProviderConfig(providerName);
    if (!config) return null;
    return config.baseUrl;
  }

  getTransport(providerName) {
    const config = this.getProviderConfig(providerName);
    return config?.transport || 'openai_chat';
  }

  getApiMode(providerName) {
    const transport = this.getTransport(providerName);
    const map = {
      'openai_chat': 'chat_completions',
      'anthropic_messages': 'anthropic_messages',
      'codex_responses': 'codex_responses'
    };
    return map[transport] || 'chat_completions';
  }

  isAggregator(providerName) {
    const config = this.getProviderConfig(providerName);
    return config?.isAggregator || false;
  }

  getEnvVars(providerName) {
    const config = this.getProviderConfig(providerName);
    return config?.envVars || [];
  }

  reloadProviders() {
    Object.keys(PRESET_PROVIDERS).forEach(k => delete PRESET_PROVIDERS[k]);
    loadProviders();
  }
}

export const providerManager = new ProviderManager();
export default providerManager;
