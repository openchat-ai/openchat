import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_PATH = path.join(__dirname, '..', 'src', 'memory', 'provider-models.json');
const CACHE_PATH = path.join(__dirname, '..', 'src', 'memory', 'models-dev-cache.json');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL = 60 * 60 * 1000;

const KNOWN_MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini', 'o3', 'o3-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro', 'gemini-pro-vision'],
  'meta-llama': ['llama-3.1-70b-instruct', 'llama-3.1-8b-instruct', 'llama-3-70b-instruct', 'llama-3-8b-instruct', 'llama-2-70b-chat'],
  mistralai: ['mistral-large-latest', 'mistral-7b-instruct', 'mixtral-8x7b-instruct', 'codestral-latest'],
  deepseek: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  xai: ['xai/grok-2', 'xai/grok-2-mini', 'xai/grok-beta'],
  zai: ['z-ai/zephyr-7b-beta', 'z-ai/plus'],
  kimi: ['kimi-k2-thinking', 'kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-32k'],
  huggingface: ['huggingfaceH4/zephyr-7b-beta', 'meta-llama/Llama-3.1-70B-Instruct'],
  github: ['github/copilot-chat', 'github/copilot'],
  vercel: ['vercel/ai', 'vercel/claude-3-opus'],
  siliconflow: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-Coder-V2', 'internlm/internlm2_5-20b-chat'],
  alibaba: ['qwen-plus', 'qwen-plus-latest', 'qwen-max', 'qwen-turbo', 'qwen-long'],
  opencode: ['glm-5.1', 'glm-5', 'kimi-k2.5', 'mimo-v2-pro', 'mimo-v2-omni', 'minimax-m2.7', 'minimax-m2.5'],
  'opencodego': ['opencode/big-pickle', 'opencode/minimax-free', 'opencode/glm-4.7-free', 'opencode/trinity-large-preview', 'opencode/gpt-5-nano'],
  kilo: ['kilo/code-8b', 'kilo/code-34b'],
  xiaomi: ['xiaomi/mimo-7b', 'xiaomi/mimo-3b'],
  arcee: ['arcee/coveron-7b', 'arcee/coveron-34b'],
  iflow: ['kimi-k2', 'qwen-plus', 'qwen-max', 'deepseek-chat', 'moonshot-v1-8k'],
  'minimax-cn': ['MiniMax-M2.7', 'MiniMax-M2.5', 'MiniMax-M1', 'abab6.5s-chat', 'abab6.5-chat'],
  'minimax-coding-plan': ['MiniMax-M2.7', 'MiniMax-M2.5', 'abab6.5s-chat', 'abab6.5-chat', 'kimi-k2'],
  'baidu-qianfan': [
    'ernie-4.0-8k-latest', 
    'ernie-4.0-128k', 
    'ernie-4.0-8k', 
    'ernie-3.5-8k', 
    'ernie-speed-pro-128k',
    'ernie-speed-128k',
    'ernie-lite-8k',
    'ernie-tiny-8k',
    'ernie-char-8k',
    'ernie-bot-8k',
    'ernie-bot-4.5',
    'ernie-bot-3.5',
    'qwen1.5-7b-chat',
    'qwen2.5-7b-instruct',
    'qwen3-7b-instruct',
    'qwen3.5-7b-instruct',
    'qwen-max',
    'qwen-plus',
    'qwen-turbo',
    'glm-3-6b-chat',
    'glm-4', 
    'glm-4-plus', 
    'glm-4-air', 
    'glm-4-airx', 
    'glm-4-flash',
    'glm-5', 
    'glm-5-plus', 
    'glm-5-air', 
    'glm-5-airx', 
    'glm-5-flash',
    'deepseek-chat',
    'deepseek-coder',
    'deepseek-r1'
  ],
  modal: ['zai-org/GLM-5-FP8', 'zai-org/GLM-5-FP8-2', 'zai-org/GLM-5.1-FP8']
};

const BLUEPRINTS = {
  openrouter: {
    name: 'OpenRouter',
    nameCn: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'openrouter/auto',
    description: '200+ 模型聚合，支持 OpenAI 兼容格式'
  },
  siliconflow: {
    name: '硅基流动',
    nameCn: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    description: '中国镜像源，高速稳定'
  },
  deepseek: {
    name: 'DeepSeek',
    nameCn: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek 官方 API'
  }
};

function loadProviders() {
  try {
    if (fs.existsSync(MODELS_PATH)) {
      return JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveProviders(data) {
  try {
    fs.writeFileSync(MODELS_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('保存失败:', e.message);
    return false;
  }
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
  } catch (e) {}
  return { data: null, timestamp: 0 };
}

async function fetchOpenRouterModels(apiKey) {
  console.log('[OpenRouter] 正在从远程获取模型目录...');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
      signal: AbortSignal.timeout(30000)
    });
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const json = await resp.json();
    const models = (json.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      context_length: m.context_length,
      price: m.pricing ? `${m.pricing.prompt}/${m.pricing.completion}` : null,
      description: (m.description || '').substring(0, 100),
      provider: m.id.split('/')[0] || 'unknown'
    }));

    const providers = {};
    for (const m of models) {
      const p = m.provider;
      if (!providers[p]) {
        providers[p] = {
          name: p, nameCn: p, baseUrl: 'https://openrouter.ai/api/v1',
          chatEndpoint: '/chat/completions', defaultModel: m.id,
          description: `OpenRouter: ${p}`, models: []
        };
      }
      providers[p].models.push(m.id);
    }

    return { success: true, models, providers, providerCount: Object.keys(providers).length, modelCount: models.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function fetchOllamaCloudModels() {
  console.log('[Ollama Cloud] 正在从 https://ollama.com 获取模型目录...');
  try {
    const resp = await fetch('https://ollama.com/api/tags', {
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const models = (json.models || []).map(m => ({
      id: m.name,
      name: m.name,
      description: m.details?.family || m.model || '',
      modifiedAt: m.modified_at
    }));
    return { success: true, models, count: models.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function fetchModelsFromApi(providerKey, apiKey) {
  const info = BLUEPRINTS[providerKey];
  if (!info || !apiKey) return { success: false, error: '参数错误' };

  // Special handling for Baidu Qianfan which requires access token
  if (providerKey === 'baidu-qianfan-coding-plan') {
    try {
      // First, get access token using the API key
      const tokenResp = await fetch(`https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!tokenResp.ok) {
        return { success: false, error: `获取access token失败: HTTP ${tokenResp.status}` };
      }
      
      const tokenData = await tokenResp.json();
      const accessToken = tokenData.access_token;
      
      if (!accessToken) {
        return { success: false, error: `获取access token失败: ${tokenData.error_description || '未知错误'}` };
      }
      
      // Now use the access token to fetch models
      // Note: Baidu Qianfan might not have a direct models endpoint for the /v2/coding path
      // For now, return a success with the extended model list
      return { 
        success: true, 
        models: [
          'ernie-4.0-8k-latest', 
          'ernie-4.0-128k', 
          'ernie-4.0-8k', 
          'ernie-3.5-8k', 
          'ernie-speed-pro-128k',
          'ernie-speed-128k',
          'ernie-lite-8k',
          'ernie-tiny-8k',
          'ernie-char-8k',
          'ernie-bot-8k',
          'ernie-bot-4.5',
          'ernie-bot-3.5',
          'qwen1.5-7b-chat',
          'qwen2.5-7b-instruct',
          'qwen3-7b-instruct',
          'qwen3.5-7b-instruct',
          'qwen-max',
          'qwen-plus',
          'qwen-turbo',
          'glm-3-6b-chat',
          'glm-4', 
          'glm-4-plus', 
          'glm-4-air', 
          'glm-4-airx', 
          'glm-4-flash',
          'glm-5', 
          'glm-5-plus', 
          'glm-5-air', 
          'glm-5-airx', 
          'glm-5-flash',
          'deepseek-chat',
          'deepseek-coder',
          'deepseek-r1'
        ], 
        count: 33 
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  try {
    const resp = await fetch(`${info.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    });
    if (resp.ok) {
      const json = await resp.json();
      const models = (json.data || [])
        .filter(m => m.id && !m.id.includes('deprecated'))
        .map(m => m.id)
        .slice(0, 100);
      return { success: true, models, count: models.length };
    }
    return { success: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function syncOpenRouter(apiKey) {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          OpenRouter - 动态发现模型 & 服务商             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const result = await fetchOpenRouterModels(apiKey);
  
  if (!result.success) {
    console.log('✗ 获取失败: ' + result.error);
    return { success: false, error: result.error };
  }

  console.log(`✓ 成功获取 ${result.modelCount} 个模型，来自 ${result.providerCount} 个服务商`);
  console.log('');

  console.log('【发现的服务商 (前 10)】');
  const sorted = Object.entries(result.providers)
    .sort((a, b) => b[1].models.length - a[1].models.length)
    .slice(0, 10);
  
  for (const [pName, pInfo] of sorted) {
    console.log(`  ${pName.padEnd(20)} ${pInfo.models.length} 个模型`);
  }

  const all = loadProviders();
  all['openrouter'] = {
    name: 'OpenRouter',
    nameCn: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatEndpoint: '/chat/completions',
    defaultModel: 'openrouter/auto',
    models: result.models.map(m => m.id),
    modelMeta: result.models,
    updatedAt: new Date().toISOString(),
    description: `200+ 模型聚合 | ${result.providerCount} 个服务商 | ${result.modelCount} 个模型`,
    isAggregator: true
  };

  if (saveProviders(all)) {
    console.log('\n✓ OpenRouter 模型目录已保存');
  }

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  下一步:');
  console.log('║    model openrouter           # 查看所有模型');
  console.log('║    model openrouter gpt-4      # 搜索特定模型');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  return { success: true, ...result };
}

async function syncBlueprints() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          Provider 配置                               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const all = loadProviders();
  let changed = false;

  for (const [key, info] of Object.entries(BLUEPRINTS)) {
    if (!all[key]) {
      console.log(`[+] 新增: ${info.nameCn} (${key})`);
      all[key] = {
        name: info.name, nameCn: info.nameCn, baseUrl: info.baseUrl,
        chatEndpoint: info.chatEndpoint, defaultModel: info.defaultModel,
        models: [], updatedAt: null, description: info.description
      };
      changed = true;
    }
  }

  if (changed) {
    saveProviders(all);
    console.log('\n✓ 基线 Provider 已同步');
  } else {
    console.log('✓ 基线配置已是最新');
  }

  console.log('\n【本地基线 Provider】');
  for (const [key, info] of Object.entries(BLUEPRINTS)) {
    const hasModels = (all[key]?.models?.length || 0) > 0;
    const status = hasModels ? `✓ ${all[key].models.length} 模型` : '○ 未同步';
    console.log(`  ${info.nameCn.padEnd(12)} [${status}]  ${info.description}`);
  }

  console.log('\n【推荐操作】');
  console.log('  connect openrouter         # 连接 OpenRouter，自动发现所有服务商和模型');
  console.log('  upgrade --sync openrouter   # 直接同步 OpenRouter 模型目录');
  console.log('  upgrade --models-dev       # 从 models.dev 同步全部 109+ 服务商\n');
}

async function syncModelsDev() {
  const { syncFromModelsDev } = await import('./models-dev.js');
  return syncFromModelsDev(null);
}

export async function syncModelsForProvider(providerKey, apiKey) {
  if (providerKey === 'openrouter') {
    return syncOpenRouter(apiKey);
  }
  if (providerKey === 'ollama-cloud' || providerKey === 'ollamacloud') {
    const result = await fetchOllamaCloudModels();
    if (!result.success) {
      console.log('✗ 获取失败: ' + result.error);
      return { success: false, error: result.error };
    }
    console.log(`✓ 获取成功: ${result.count} 个模型`);
    const all = loadProviders();
    all['ollama-cloud'] = {
      name: 'Ollama Cloud',
      nameCn: 'Ollama Cloud',
      baseUrl: 'https://api.ollama.ai/v1',
      chatEndpoint: '/chat/completions',
      defaultModel: result.models[0]?.id || 'llama3.1:70b',
      models: result.models.map(m => m.id),
      modelMeta: result.models,
      updatedAt: new Date().toISOString(),
      description: `Ollama Cloud | ${result.count} 个模型`,
      transport: 'openai_chat',
      isAggregator: false,
      envVars: ['OLLAMA_API_KEY']
    };
    if (saveProviders(all)) {
      console.log('✓ Ollama Cloud 模型目录已保存');
    }
    return { success: true, count: result.count };
  }
  if (providerKey === 'baidu-qianfan-coding-plan') {
    if (apiKey && apiKey !== 'your-baidu-api-key-here' && apiKey !== 'placeholder') {
      // Try to fetch models via API if we have a valid API key
      const result = await fetchModelsFromApi(providerKey, apiKey);
      if (result.success && result.models.length > 0) {
        console.log(`  ✓ 获取成功: ${result.count} 个模型`);
        const all = loadProviders();
        all['baidu-qianfan-coding-plan'] = {
          name: 'Baidu Qianfan Coding Plan',
          nameCn: '百度千帆 Coding Plan',
          baseUrl: 'https://qianfan.baidubce.com',
          chatEndpoint: '/v2/coding/chat/completions',
          defaultModel: result.models[0] || 'ernie-4.0-8k-latest',
          models: result.models,
          updatedAt: new Date().toISOString(),
          description: `百度千帆 Coding Plan | ${result.count} 个模型`,
          transport: 'openai_chat',
          authType: 'api_key',
          envVars: ['BAIDU_API_KEY']
        };
        if (saveProviders(all)) {
          console.log('  ✓ 百度千帆 Coding Plan 模型已保存');
        }
        return { success: true, count: result.count };
      } else {
        console.log('  ○ API获取失败，使用预设模型');
      }
    }
    
    // Fallback to known models if no API key or API call failed
    const result = KNOWN_MODELS['baidu-qianfan'] || [
      'ernie-4.0-8k-latest',
      'ernie-4.0-128k',
      'ernie-4.0-8k',
      'ernie-3.5-8k',
      'ernie-speed-pro-128k',
      'ernie-speed-128k',
      'ernie-lite-8k',
      'ernie-tiny-8k',
      'ernie-char-8k',
      'qwen1.5-7b-chat',
      'glm-3-6b-chat'
    ];
    const all = loadProviders();
    all['baidu-qianfan-coding-plan'] = {
      name: 'Baidu Qianfan Coding Plan',
      nameCn: '百度千帆 Coding Plan',
      baseUrl: 'https://qianfan.baidubce.com',
      chatEndpoint: '/v2/coding/chat/completions',
      defaultModel: 'ernie-4.0-8k-latest',
      models: result,
      updatedAt: new Date().toISOString(),
      description: `百度千帆 Coding Plan | ${result.length} 个模型`,
      transport: 'openai_chat',
      authType: 'api_key',
      envVars: ['BAIDU_API_KEY']
    };
    if (saveProviders(all)) {
      console.log('  ✓ 百度千帆 Coding Plan 预设模型已保存');
    }
    return { success: true, count: result.length };
  }
  if (providerKey === 'opencode-zen' || providerKey === 'opencodego' || providerKey === 'zen') {
    const result = KNOWN_MODELS['opencodego'] || [];
    const all = loadProviders();
    all['opencode-zen'] = {
      name: 'OpenCode Zen',
      nameCn: 'OpenCode Zen',
      baseUrl: 'https://opencode.ai/zen/v1',
      chatEndpoint: '/chat/completions',
      defaultModel: 'opencode/big-pickle',
      models: result,
      updatedAt: new Date().toISOString(),
      description: `OpenCode Zen 付费模型 | ${result.length} 个模型`,
      transport: 'openai_chat',
      isAggregator: false,
      authType: 'api_key',
      envVars: ['OPENCODE_API_KEY']
    };
    if (saveProviders(all)) {
      console.log('✓ OpenCode Zen 模型已保存');
    }
    return { success: true, count: result.length };
  }
  if (providerKey === 'opencode' || providerKey === 'opencode-go') {
    const result = KNOWN_MODELS['opencode'] || [];
    const all = loadProviders();
    all['opencode'] = {
      name: 'OpenCode Go',
      nameCn: 'OpenCode Go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      chatEndpoint: '/chat/completions',
      defaultModel: 'glm-5.1',
      models: result,
      updatedAt: new Date().toISOString(),
      description: `OpenCode Go 免费模型 | ${result.length} 个模型`,
      transport: 'openai_chat',
      isAggregator: false,
      authType: 'api_key',
      envVars: ['OPENCODE_API_KEY']
    };
    if (saveProviders(all)) {
      console.log('✓ OpenCode Go 模型已保存');
    }
    return { success: true, count: result.length };
  }
  if (providerKey === 'models.dev' || providerKey === 'modelsdev') {
    return syncModelsDev();
  }

  // Resolve ALIASES (e.g., 'qwen' -> 'alibaba')
  const { HERMES_STYLE_OVERLAYS } = await import('../src/memory/provider-manager.js');
  const ALIASES = { 'qwen': 'alibaba', 'claude': 'anthropic', 'openai': 'openai', 'ollama': 'ollama-cloud', 'minimax': 'minimax-coding-plan', 'bailian': 'bailian', '百炼': 'bailian', 'zhipu': 'zhipu', '智谱': 'zhipu', 'glm': 'zhipu', 'volc-engine': 'volc-engine', '火山引擎': 'volc-engine', 'doubao': 'volc-engine', 'baidu-qianfan': 'baidu-qianfan', 'qianfan': 'baidu-qianfan', '百度千帆': 'baidu-qianfan', 'opencodego': 'opencode-zen', 'opencode': 'opencode', 'opencode-go': 'opencode', 'zen': 'opencode-zen', 'opencode-zen': 'opencode-zen' };
  const resolvedKey = ALIASES[providerKey] || providerKey;

  // Check BLUEPRINTS first, then HERMES_STYLE_OVERLAYS
  const info = BLUEPRINTS[providerKey] || null;
  const overlay = HERMES_STYLE_OVERLAYS[resolvedKey] || null;
  
  if (!info && !overlay) {
    return { success: false, error: '未知 Provider: ' + providerKey };
  }

  const nameCn = (info || overlay).nameCn || providerKey;
  console.log(`[${nameCn}] 正在同步模型...`);

  // Try to fetch from API if we have an API key
  if (apiKey && info) {
    const result = await fetchModelsFromApi(providerKey, apiKey);
    if (result.success && result.models.length > 0) {
      console.log(`  ✓ 获取成功: ${result.count} 个模型`);
      const all = loadProviders();
      all[providerKey] = {
        name: info.name, nameCn: info.nameCn, baseUrl: info.baseUrl,
        chatEndpoint: info.chatEndpoint, defaultModel: info.defaultModel,
        models: result.models, updatedAt: new Date().toISOString(),
        description: info.description
      };
      if (saveProviders(all)) {
        console.log(`  ✓ ${nameCn} 模型已保存`);
      }
      return { success: true, count: result.count };
    }
  }

  // If no API key or fetch failed, use KNOWN_MODELS or save with empty models
  const knownModels = KNOWN_MODELS[resolvedKey] || [];
  if (overlay) {
    const all = loadProviders();
    all[providerKey] = {
      name: overlay.name || overlay.nameCn || providerKey,
      nameCn: overlay.nameCn || overlay.name || providerKey,
      baseUrl: overlay.baseUrl || '',
      chatEndpoint: overlay.chatEndpoint || '/chat/completions',
      defaultModel: overlay.defaultModel || 'default',
      models: knownModels,
      updatedAt: new Date().toISOString(),
      description: overlay.description || (knownModels.length > 0 ? `热门模型: ${knownModels.length} 个` : ''),
      transport: overlay.transport || 'openai_chat',
      isAggregator: overlay.isAggregator || false,
      envVars: overlay.envVars || []
    };
    if (saveProviders(all)) {
      console.log(`  ✓ ${nameCn} 配置已保存`);
    }
    if (knownModels.length > 0) {
      console.log(`  ✓ 热门模型: ${knownModels.length} 个`);
    } else {
      console.log(`  ○ 无 API Key，无已知模型`);
    }
    return { success: true, count: knownModels.length, noApiKey: knownModels.length === 0 };
  } else if (info) {
    const all = loadProviders();
    all[providerKey] = {
      name: info.name, nameCn: info.nameCn, baseUrl: info.baseUrl,
      chatEndpoint: info.chatEndpoint, defaultModel: info.defaultModel,
      models: knownModels,
      updatedAt: new Date().toISOString(),
      description: info.description || (knownModels.length > 0 ? `热门模型: ${knownModels.length} 个` : '')
    };
    if (saveProviders(all)) {
      console.log(`  ✓ ${nameCn} 配置已保存`);
    }
    if (knownModels.length > 0) {
      console.log(`  ✓ 热门模型: ${knownModels.length} 个`);
    } else {
      console.log(`  ○ 无 API Key，无已知模型`);
    }
    return { success: true, count: knownModels.length };
  }

  return { success: false, error: '获取失败且无配置信息' };
}

const args = process.argv.slice(2);

export async function syncAll() {
  const { HERMES_STYLE_OVERLAYS } = await import('../src/memory/provider-manager.js');
  const localProviders = ['ollama', 'lmstudio'];
  const allKeys = [...new Set([...Object.keys(BLUEPRINTS), ...Object.keys(HERMES_STYLE_OVERLAYS)])];
  
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║          同步全部 ${allKeys.length} 个 Provider                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

  for (const key of allKeys) {
    const isLocal = localProviders.includes(key);
    process.stdout.write(`[${key.padEnd(16)}] `);
    try {
      if (key === 'openrouter') {
        await syncOpenRouter(process.env.OPENROUTER_API_KEY || '');
      } else if (key === 'ollama-cloud' || key === 'ollamacloud') {
        const result = await fetchOllamaCloudModels();
        if (result.success) {
          const all = loadProviders();
          all['ollama-cloud'] = {
            name: 'Ollama Cloud', nameCn: 'Ollama Cloud',
            baseUrl: 'https://api.ollama.ai/v1', chatEndpoint: '/chat/completions',
            defaultModel: result.models[0]?.id || 'llama3.1:70b',
            models: result.models.map(m => m.id), modelMeta: result.models,
            updatedAt: new Date().toISOString(),
            description: `Ollama Cloud | ${result.count} 个模型`,
            transport: 'openai_chat', isAggregator: false, envVars: ['OLLAMA_API_KEY']
          };
          saveProviders(all);
          console.log(`✓ ${result.count} 模型`);
        } else {
          console.log(`✗ ${result.error}`);
        }
      } else if (isLocal) {
        const all = loadProviders();
        if (!all[key]) {
          all[key] = { ...HERMES_STYLE_OVERLAYS[key], models: [] };
          saveProviders(all);
        }
        console.log(`✓ 本地 Provider`);
      } else {
        await syncModelsForProvider(key, process.env.OPENROUTER_API_KEY || '');
      }
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
  console.log('\n✓ 全部同步完成\n');
}

if (args.length > 0 && args[0] === '--sync-all') {
  syncAll().catch(console.error);
} else if (args.length > 0 && args[0] === '--sync') {
  const providerKey = args[1] || 'openrouter';
  const apiKey = args[2] || process.env.OPENROUTER_API_KEY || '';
  syncModelsForProvider(providerKey, apiKey).catch(console.error);
} else if (args.length > 0 && (args[0] === '--models-dev' || args[0] === '-m')) {
  syncModelsDev().catch(console.error);
} else {
  syncBlueprints().catch(console.error);
}
