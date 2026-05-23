import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, '..', 'src', 'memory', 'models-dev-cache.json');
const MODELS_PATH = path.join(__dirname, '..', 'src', 'memory', 'provider-models.json');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL = 60 * 60 * 1000;

let cache = { data: null, timestamp: 0 };

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const raw = fs.readFileSync(CACHE_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {}
  return { data: null, timestamp: 0 };
}

function saveCache(data) {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Cache save failed:', e.message);
  }
}

async function fetchModelsDev() {
  const cached = loadCache();
  const now = Date.now();
  
  if (cached.data && (now - cached.timestamp) < CACHE_TTL) {
    console.log('[models.dev] Using cache (fresh)');
    return cached.data;
  }
  
  console.log('[models.dev] Fetching from remote...');
  try {
    const resp = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const data = await resp.json();
    const cacheData = { data, timestamp: now };
    saveCache(cacheData);
    console.log('[models.dev] Fetched and cached');
    return data;
  } catch (e) {
    console.log('[models.dev] Fetch failed: ' + e.message);
    if (cached.data) {
      console.log('[models.dev] Falling back to stale cache');
      return cached.data;
    }
    return null;
  }
}

function loadLocalProviders() {
  try {
    if (fs.existsSync(MODELS_PATH)) {
      return JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveLocalProviders(data) {
  try {
    fs.writeFileSync(MODELS_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Save failed:', e.message);
  }
}

export async function syncFromModelsDev(apiKey) {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║          models.dev - 动态发现服务商 & 模型             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  const catalog = await fetchModelsDev();
  
  if (!catalog) {
    console.log('✗ 无法获取 models.dev 目录');
    return { success: false, error: 'network' };
  }

  const providerEntries = Object.entries(catalog);
  console.log(`✓ 发现 ${providerEntries.length} 个服务商`);
  console.log('');

  const local = loadLocalProviders();
  
  const PROVIDER_OVERRIDES = {
    openrouter: { isAggregator: true },
    siliconflow: { isAggregator: true },
    huggingface: { isAggregator: true },
    vercel: { isAggregator: true }
  };

  let totalModels = 0;
  const discovered = {};

  for (const [providerId, providerData] of providerEntries) {
    const models = Object.values(providerData.models || {});
    const modelIds = models.map(m => m.id || m.name).filter(Boolean).slice(0, 50);
    const override = PROVIDER_OVERRIDES[providerId] || {};
    
    discovered[providerId] = {
      name: providerData.name || providerId,
      nameCn: providerData.name || providerId,
      baseUrl: providerData.api || '',
      chatEndpoint: '/chat/completions',
      defaultModel: modelIds[0] || 'default',
      models: modelIds,
      modelMeta: models.slice(0, 50).map(m => ({
        id: m.id || m.name,
        name: m.name || m.id,
        context_length: m.limit?.context || 0,
        price: m.cost ? `${m.cost.input}/${m.cost.output}` : null,
        description: (m.description || '').substring(0, 80),
        tool_call: m.tool_call || false,
        vision: (m.modalities?.input || []).includes('image') || false,
        reasoning: m.reasoning || false
      })),
      updatedAt: new Date().toISOString(),
      description: providerData.doc || '',
      envVars: providerData.env || [],
      isAggregator: override.isAggregator || false,
      transport: 'openai_chat',
      ...override
    };
    totalModels += modelIds.length;
  }

  Object.assign(local, discovered);
  saveLocalProviders(local);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  发现的服务商 (前 20):');
  console.log('═══════════════════════════════════════════════════════════');
  
  const sorted = Object.entries(discovered)
    .sort((a, b) => b[1].models.length - a[1].models.length)
    .slice(0, 20);
  
  sorted.forEach(([id, info]) => {
    const agg = info.isAggregator ? ' [聚合]' : '';
    console.log(`  ${(info.nameCn || id).padEnd(20)} ${String(info.models.length).padStart(4)} 模型${agg}`);
  });
  
  if (Object.keys(discovered).length > 20) {
    console.log(`  ... 还有 ${Object.keys(discovered).length - 20} 个服务商`);
  }
  
  console.log('');
  console.log(`总计: ${Object.keys(discovered).length} 服务商, ${totalModels} 模型`);
  console.log('');

  if (apiKey) {
    console.log('[OpenRouter] 正在同步 OpenRouter 专属模型...');
    const { syncOpenRouter } = await import('./upgrade-providers.js');
    await syncOpenRouter(apiKey);
  }

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  下一步:');
  console.log('║    connect                 # 交互式连接配置');
  console.log('║    model <provider> <query>  # 搜索模型');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  return { 
    success: true, 
    providerCount: Object.keys(discovered).length, 
    modelCount: totalModels 
  };
}

export async function getProviderModels(providerId) {
  const catalog = await fetchModelsDev();
  if (!catalog || !catalog[providerId]) return null;
  return catalog[providerId];
}

export { fetchModelsDev };
